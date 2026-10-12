"""Master Duel's packs and what is in them, from masterduelmeta.com's public API (엘리스 2026-10-12, the pack
simulator): its set list, and each card's "obtain" (the sets it comes in). A card's gameId is our print id; an other
art is listed under its base print's id and is matched to our other-art print by order.

What the game itself says of a pack comes from its client (storage/md/packs/pack_map.json, settings.MD_PACK_MAP): its
number, Korean name and covers. A pack whose cover shows an other art — an 오버프레임 or new-art campaign, which MDM
leaves out — takes that cover, and the card comes in it as that art (엘리스 2026-10-13)."""
import json
import os
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
        r = get(f"{MDM}/cards", params={"limit": PAGE, "page": page, "fields": "gameId,rarity,obtain,alternateArt,release"},
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


def _other_arts(cards, prints, others):
    """{MDM other-art entry: our print}. The game numbers a print as it adds it, so a card's other arts in print order
    came in that order; MDM's entries for them, by their days, are matched to them, the latest to the latest (MDM
    lists only the arts that come in packs: 블랙 매지션 has three other arts and one such entry, WCS 2026's)."""
    by_base = defaultdict(list)
    for c in cards:
        gid = str(c.get("gameId") or "")
        if c.get("alternateArt") and gid.isdigit() and int(gid) in prints and any(
                o.get("type") == "sets" for o in c.get("obtain") or []):
            by_base[int(gid)].append(c)
    out = {}
    for gid, entries in by_base.items():
        mine = others.get(prints[gid].card_id)
        if not mine:
            continue
        entries.sort(key=lambda e: (not e.get("release"), e.get("release") or ""))
        start = max(0, len(mine) - len(entries))
        for i, e in enumerate(entries):
            out[id(e)] = mine[min(start + i, len(mine) - 1)]
    return out


def load_pack_map(source):
    """{MDM set id: {game_id, name_ko, cover, arts}} from the game's pack map (a dict or a file; {} when there is
    none): arts are its covers showing an other art, [(cover, print id)]."""
    if isinstance(source, str):
        if not os.path.exists(source):
            return {}
        with open(source) as f:
            source = json.load(f)
    images = source.get("images") or {}
    images = dict(images) if isinstance(images, list) else images
    out, by_pack_id = {}, {}
    for p in source.get("packs", []):
        if not p.get("mdm_set_id"):
            continue
        covers = [p.get("image")] + [o.get("image") for o in p.get("other_images") or []]
        out[p["mdm_set_id"]] = {"game_id": int(p["pack_id"]), "name_ko": p.get("ko_name") or "",
                                "cover": p.get("image") or "", "arts": [], "covers": [c for c in covers if c]}
        by_pack_id[p["pack_id"]] = p["mdm_set_id"]
    for key, v in images.items():
        for pid in v.get("pack_ids") or []:
            if by_pack_id.get(pid) and key not in out[by_pack_id[pid]]["covers"]:
                out[by_pack_id[pid]]["covers"].append(key)
    for row in out.values():
        row["arts"] = [(k, images[k]["file_card_id"]) for k in row.pop("covers")
                       if images.get(k, {}).get("alt_art") and images[k].get("file_card_id")]
    return out


def sync(sets, cards, pack_map=None):
    """Store MDM's packs and their cards, with what the game says of them (load_pack_map); a pack's cards follow the
    sources each time. A summary to report."""
    pack_map = pack_map or {}
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
    for p in MdPrint.objects.filter(is_alt_art=True).order_by("md_id"):
        others[p.card_id].append(p)
    arts = _other_arts(cards, prints, others)
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
            p = arts.get(id(c), base)
            wanted[sid][p.md_id] = (c.get("rarity") or p.rarity, o.get("amount") or 1)
    covers = {}
    for sid, game in pack_map.items():
        covers[sid] = game["cover"]
        shown = []
        for cover, art_id in game["arts"]:
            art = prints.get(art_id)
            base = art and art.is_alt_art and next(
                (pid for pid in wanted.get(sid, {}) if prints[pid].card_id == art.card_id and not prints[pid].is_alt_art), None)
            if base:   # the campaign's art in place of the usual one
                rarity, amount = wanted[sid].pop(base)
                wanted[sid][art_id] = (art.rarity or rarity, amount)
            if art_id in wanted.get(sid, {}):
                shown.append((art_id, cover))
        if shown:
            covers[sid] = max(shown)[1]   # the latest campaign's cover
    with transaction.atomic():
        for sid, (s, kind) in packs.items():
            game = pack_map.get(sid, {})
            pack, _ = MdPack.objects.update_or_create(
                mdm_id=sid, defaults={"kind": kind, "name_en": s.get("name", ""), "released": _day(s.get("release")),
                                      "game_id": game.get("game_id"), "name_ko": game.get("name_ko", ""),
                                      "cover": covers.get(sid, "")})
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
