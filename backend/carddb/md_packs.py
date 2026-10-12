"""Master Duel's packs and what is in them, from masterduelmeta.com's public API (엘리스 2026-10-12, the pack
simulator): its set list, and each card's "obtain" (the sets it comes in). A card's gameId is our print id; an other
art is listed under its base print's id and is matched to our other-art print by date."""
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests
from django.db import transaction

from .models import MdPack, MdPackCard, MdPrint

MDM = "https://www.masterduelmeta.com/api/v1"
HEADERS = {"User-Agent": "YGODecks card book (+https://ygodecks.com)"}
KST = timezone(timedelta(hours=9))
PAGE = 500
KINDS = {"Normal Pack": MdPack.Kind.NORMAL, "Secret Pack": MdPack.Kind.SECRET, "Selection Pack": MdPack.Kind.SELECTION,
         "Bonus Pack": MdPack.Kind.BONUS, "Structure Deck": MdPack.Kind.STRUCTURE}
SLACK = timedelta(days=3)   # a print first seen a little before its bundle's listed day is still that bundle's


def fetch_sets(get=None):
    get = get or requests.get
    r = get(f"{MDM}/sets", params={"limit": 5000}, timeout=60, headers=HEADERS)
    r.raise_for_status()
    return r.json()


def fetch_cards(get=None, pause=1.0):
    """Every card MDM lists, with the sets it comes in, a page at a time."""
    get = get or requests.get
    out, page = [], 1
    while True:
        r = get(f"{MDM}/cards", params={"limit": PAGE, "page": page, "fields": "gameId,rarity,obtain,alternateArt"},
                timeout=60, headers=HEADERS)
        r.raise_for_status()
        rows = r.json()
        out += rows
        if len(rows) < PAGE:
            return out
        page += 1
        time.sleep(pause)


def _day(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(KST).date() if text else None


def _other_art(prints, day):
    """Of a card's other-art prints (oldest first), the one a bundle of that day brought: the first seen on or after
    it, else the latest before."""
    if day:
        for p in prints:
            if p.first_seen and p.first_seen >= day - SLACK:
                return p
    return prints[-1]


def sync(sets, cards):
    """Store MDM's packs and their cards; a pack's cards follow the source each time. A summary to report."""
    out = {"packs": 0, "cards": 0, "added": 0, "removed": 0, "changed": 0, "unknown_prints": [], "unknown_kinds": []}
    packs = {}
    for s in sets:
        kind = KINDS.get(s.get("type"))
        if not kind:
            out["unknown_kinds"].append(s.get("type"))
            continue
        packs[s["_id"]] = (s, kind)
    prints = {p.md_id: p for p in MdPrint.objects.all()}
    others = defaultdict(list)
    for p in MdPrint.objects.filter(is_alt_art=True).order_by("first_seen", "md_id"):
        others[p.card_id].append(p)
    wanted = defaultdict(dict)   # set id → {print id: (rarity, amount)}
    unknown = set()
    for c in cards:
        gid = str(c.get("gameId") or "")
        base = prints.get(int(gid)) if gid.isdigit() else None
        for o in c.get("obtain") or []:
            sid = (o.get("source") or {}).get("_id")
            if o.get("type") != "sets" or sid not in packs:
                continue
            if not base:
                unknown.add(int(gid) if gid.isdigit() else gid)
                continue
            p = base
            if c.get("alternateArt") and others.get(base.card_id):
                p = _other_art(others[base.card_id], _day(packs[sid][0].get("release")))
            wanted[sid][p.md_id] = (c.get("rarity") or p.rarity, o.get("amount") or 1)
    with transaction.atomic():
        for sid, (s, kind) in packs.items():
            pack, _ = MdPack.objects.update_or_create(
                mdm_id=sid, defaults={"kind": kind, "name_en": s.get("name", ""), "released": _day(s.get("release"))})
            have = {e.md_print_id: e for e in pack.cards.all()}
            want = wanted.get(sid, {})
            stale = [pid for pid in have if pid not in want]
            MdPackCard.objects.filter(pack=pack, md_print_id__in=stale).delete()
            new, changed = [], []
            for pid, (rarity, amount) in want.items():
                e = have.get(pid)
                if not e:
                    new.append(MdPackCard(pack=pack, md_print_id=pid, rarity=rarity, amount=amount))
                elif (e.rarity, e.amount) != (rarity, amount):
                    e.rarity, e.amount = rarity, amount
                    changed.append(e)
            MdPackCard.objects.bulk_create(new, batch_size=1000)
            MdPackCard.objects.bulk_update(changed, ["rarity", "amount"], batch_size=1000)
            out["packs"] += 1
            out["cards"] += len(want)
            out["added"] += len(new) if have else 0
            out["removed"] += len(stale)
            out["changed"] += len(changed)
    out["unknown_prints"] = sorted(unknown, key=str)
    out["unknown_kinds"] = sorted(set(out["unknown_kinds"]), key=str)
    return out
