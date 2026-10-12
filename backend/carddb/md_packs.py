"""Master Duel's packs and what is in them, from masterduelmeta.com's public API (엘리스 2026-10-12, the pack
simulator): its set list, and each card's "obtain" (the sets it comes in). A card's gameId is our print id; an other
art is listed under its base print's id and is matched to our other-art print by order.

What the game itself says of a pack comes from its client (storage/md/packs/pack_map.json, settings.MD_PACK_MAP): its
number, Korean name and covers. A pack whose cover shows an other art — an 오버프레임 or new-art campaign, which MDM
leaves out — takes that cover, and the card comes in it as that art (엘리스 2026-10-13).

When the campaigns ran comes from Yugipedia (each Master Duel card page's alternate_art / extended_art): an art that
came for a while in every pack holding the card makes, for each selection or secret pack on sale then, a version of
that pack (MdPackVersion) beside its usual one; the master pack keeps its usual arts (엘리스 2026-10-13)."""
import html
import json
import os
import re
import time
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import requests
from django.db import transaction

from .models import Card, MdPack, MdPackCard, MdPackVersion, MdPrint

MDM = "https://www.masterduelmeta.com/api/v1"
YUGIPEDIA = "https://yugipedia.com/api.php"
ART_CATEGORIES = ("Category:Yu-Gi-Oh! Master Duel cards with alternate artworks",
                  "Category:Yu-Gi-Oh! Master Duel cards with extended artworks")
LAUNCH = date(2022, 1, 19)
APPMEDIA_MASTER = "https://appmedia.jp/master_duel/75590617"   # AppMedia's list of the master pack
MASTER_LIST_DAYS = 6
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


def _wiki_day(text):
    return datetime.strptime(text.strip(), "%B %d, %Y").date().isoformat()


def parse_campaigns(title, wikitext):
    """A Master Duel card page's other arts as Yugipedia records them (`alternate_art` / `extended_art`, an art a line:
    its number; the spans it came, ` * ` between; and where from, when not from the packs): [{card, ja, overframe,
    art, spans, source}]."""
    name = title.removesuffix(" (Master Duel)")
    ja = re.search(r"\|\s*ja_name\s*=\s*([^\n]*)", wikitext)
    ja = ja and re.sub(r"\{\{.*?\}\}|<[^>]+>", "", re.sub(r"\{\{Ruby\|([^|}]*)\|[^}]*\}\}", r"\1", ja.group(1))).strip()
    out = []
    for key in ("alternate_art", "extended_art"):
        m = re.search(r"\|\s*" + key + r"\s*=(.*?)(?=\n\s*\||\n\}\})", wikitext, re.S)
        for line in (m.group(1).strip().splitlines() if m else []):
            parts = [x.strip() for x in line.split(";")]
            if len(parts) < 2 or not parts[0].isdigit():
                continue
            spans = []
            for span in parts[1].split("*"):
                start, _, end = span.partition(" - ")
                try:
                    spans.append((_wiki_day(start), _wiki_day(end or start)))
                except ValueError:
                    continue
            out.append({"card": name, "ja": ja or "", "overframe": key == "extended_art",
                        "art": int(parts[0]), "spans": spans, "source": parts[2] if len(parts) > 2 else ""})
    return out


def fetch_campaigns(get=None, pause=1.0):
    """Every Master Duel other art Yugipedia records (its card pages in the two categories), as parse_campaigns reads
    them."""
    get = get or requests.get

    def api(**params):
        r = get(YUGIPEDIA, params={**params, "format": "json"}, timeout=60, headers=HEADERS)
        r.raise_for_status()
        return r.json()

    titles = []
    for category in ART_CATEGORIES:
        more = {}
        while True:
            d = api(action="query", list="categorymembers", cmtitle=category, cmlimit=500, **more)
            titles += [m["title"] for m in d["query"]["categorymembers"]]
            if "continue" not in d:
                break
            more = {"cmcontinue": d["continue"]["cmcontinue"]}
            time.sleep(pause)
    def pages(names):
        for i in range(0, len(names), 50):
            d = api(action="query", prop="revisions", rvprop="content", titles="|".join(names[i:i + 50]))
            for page in d["query"]["pages"].values():
                rev = (page.get("revisions") or [{}])[0]
                yield page["title"], rev.get("*") or rev.get("slots", {}).get("main", {}).get("*", "")
            time.sleep(pause)

    out = []
    for title, text in pages(titles):
        out += parse_campaigns(title, text)
    # a Master Duel page may leave out the Japanese name (the card book matches by it when it has no English one):
    # the card's own page has it
    missing = sorted({e["card"] for e in out if not e["ja"]})
    ja = {}
    for title, text in pages(missing):
        m = re.search(r"\|\s*ja_name\s*=\s*([^\n]*)", text)
        if m:
            ja[title] = re.sub(r"\{\{.*?\}\}|<[^>]+>", "", re.sub(r"\{\{Ruby\|([^|}]*)\|[^}]*\}\}", r"\1", m.group(1))).strip()
    for e in out:
        e["ja"] = e["ja"] or ja.get(e["card"], "")
    return out


def load_campaigns(path, get=None):
    """Yugipedia's campaigns, fetched and kept at path; the kept copy when Yugipedia cannot be reached, [] when there
    is none."""
    try:
        entries = fetch_campaigns(get=get)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(entries, f, ensure_ascii=False)
        return entries
    except (requests.RequestException, ValueError, KeyError):
        if not os.path.exists(path):
            return []
        with open(path) as f:
            return json.load(f)


def campaign_prints(entries, overframe=None):
    """{other-art print: {spans, source}} for Yugipedia's entries: the card by its English (else Japanese) name, the
    art by its number among the card's other-art prints in print order — an 오버프레임 among the 오버프레임 ones, which
    count from 1, a new art among the rest, which count from 2."""
    if overframe is None:
        from .dex import _overframe as overframe
    def key(name):
        return re.sub(r"\s", "", unicodedata.normalize("NFKC", name or ""))

    en = {c.name_en: c.id for c in Card.objects.exclude(name_en="").only("id", "name_en")}
    ja = {key(c.name_ja): c.id for c in Card.objects.exclude(name_ja="").only("id", "name_ja")}
    others = defaultdict(list)
    for p in MdPrint.objects.filter(is_alt_art=True).order_by("md_id"):
        others[p.card_id].append(p.md_id)
    out = {}
    for e in entries:
        cid = en.get(e["card"]) or (ja.get(key(e.get("ja"))) if e.get("ja") else None)
        pool = [md for md in others.get(cid, []) if bool(overframe(md)) == e["overframe"]]
        i = e["art"] - (1 if e["overframe"] else 2)
        if 0 <= i < len(pool):
            out[pool[i]] = {"spans": [tuple(s) for s in e["spans"]], "source": e["source"]}
    return out


def parse_master_list(page):
    """{Japanese name: rarity} from AppMedia's list of the master pack (a row a card: its name, then its rarity's
    icon)."""
    out = {}
    for name, rarity in re.findall(r"<td data-val1='([^']*)'.*?yugioh_md_img/(ur|sr|r|n)\.png", page, re.S):
        out.setdefault(html.unescape(name), rarity.upper())
    return out


def fetch_master_list(get=None):
    get = get or requests.get
    r = get(APPMEDIA_MASTER, timeout=120, headers=HEADERS)
    r.raise_for_status()
    return parse_master_list(r.text)


def load_master_list(path, get=None):
    """AppMedia's master pack list, kept at path and fetched again when the kept one is older than MASTER_LIST_DAYS;
    the kept one when AppMedia cannot be reached or its page no longer reads as a list, {} when there is none."""
    kept = None
    if os.path.exists(path):
        with open(path) as f:
            kept = json.load(f)
        if time.time() - os.path.getmtime(path) < MASTER_LIST_DAYS * 86400:
            return kept
    try:
        names = fetch_master_list(get=get)
    except requests.RequestException:
        names = {}
    if len(names) < 1000:   # a page that did not read as the list
        return kept or {}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(names, f, ensure_ascii=False)
    return names


def master_list_prints(names):
    """{print: rarity} for the master pack list's cards, by their Japanese names: each card's usual print."""
    def key(name):
        return re.sub(r"\s", "", unicodedata.normalize("NFKC", name or ""))

    cards = {}
    for cid, name in Card.objects.exclude(name_ja="").values_list("id", "name_ja"):
        cards.setdefault(key(name), cid)
    prints = {p.card_id: p for p in MdPrint.objects.filter(is_alt_art=False, card_id__in=set(cards.values()))}
    out = {}
    for name, rarity in names.items():
        p = prints.get(cards.get(key(name)))
        if p:
            out[p.md_id] = p.rarity or rarity
    return out


def load_pack_map(source):
    """{MDM set id: {game_id, name_ko, cover, arts}} from the game's pack map (a dict or a file; {} when there is
    none): cover is its usual one (the first not showing an other art), arts its covers showing an other art,
    [(cover, print id)]."""
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
        covers = row.pop("covers")
        row["cover"] = next((k for k in covers if not images.get(k, {}).get("alt_art")), row["cover"])
        row["arts"] = [(k, images[k]["file_card_id"]) for k in covers
                       if images.get(k, {}).get("alt_art") and images[k].get("file_card_id")]
    return out


def sync(sets, cards, pack_map=None, campaigns=None, master=None):
    """Store MDM's packs and their cards, with what the game says of them (load_pack_map), the versions campaigns
    made of them (campaign_prints) and the master pack's cards MDM leaves out (master_list_prints); a pack's cards
    follow the sources each time. A summary to report."""
    pack_map = pack_map or {}
    campaigns = campaigns or {}
    out = {"packs": 0, "cards": 0, "added": 0, "removed": 0, "changed": 0, "versions": 0, "unknown_prints": [],
           "unknown_kinds": []}
    packs = {}
    for s in sets:
        kind = KINDS.get(s.get("type"))
        if not kind:
            out["unknown_kinds"].append(s.get("type"))
            continue
        if 1000 < (pack_map.get(s["_id"], {}).get("game_id") or 0) < 2000:
            kind = MdPack.Kind.SELECTION   # the game numbers it a selection pack (MDM: Mighty Contenders, a normal pack)
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
    for sid, (s, kind) in packs.items():   # the master pack as AppMedia lists it, besides what MDM lists
        if kind == MdPack.Kind.NORMAL and s.get("name") == "Master Pack":
            for pid, rarity in (master or {}).items():
                wanted[sid].setdefault(pid, (rarity, 1))

    sale = {}   # the days each pack was sold: a selection pack until it ended, the others ever since
    for sid, (s, kind) in packs.items():
        sale[sid] = (_day(s.get("release")) or LAUNCH, _day(s.get("expires")) if kind == MdPack.Kind.SELECTION else None)

    def sold(sid, start, end):
        """The days a pack was sold in a campaign's span, or None: a pack out on its last day, or gone on its first,
        was not sold with its arts (엘리스 10/13: 챌린저즈 컬렉션, out on 4/9, had no 4th-anniversary version)."""
        on, off = sale[sid]
        if on >= end or (off and off <= start):
            return None
        return max(start, on), min(end, off) if off else end

    def spans(camp):
        return [(date.fromisoformat(a), date.fromisoformat(b)) for a, b in camp["spans"]]

    # an art MDM lists as a pack's own though Yugipedia says it came only for a while: the usual art in the usual pack,
    # and that art in the version for those days (도미나스 임펄스's 오버프레임 in 챌린저즈 컬렉션 from 6/4)
    usual = {}
    for p in prints.values():
        if not p.is_alt_art:
            usual.setdefault(p.card_id, p.md_id)
    for sid, (s, kind) in packs.items():
        if kind not in (MdPack.Kind.SECRET, MdPack.Kind.SELECTION):
            continue
        for pid in list(wanted.get(sid, {})):
            camp = campaigns.get(pid)
            base = usual.get(prints[pid].card_id)
            if camp and not camp["source"] and base and base not in wanted[sid] and any(
                    sold(sid, a, b) for a, b in spans(camp)):
                wanted[sid][base] = wanted[sid].pop(pid)

    def base_of(sid, art):
        return next((pid for pid in wanted.get(sid, {}) if prints[pid].card_id == art.card_id and not prints[pid].is_alt_art),
                    None)

    def in_packs(art_id):   # an art Yugipedia says came for a while from the packs: it goes into versions instead
        return art_id in campaigns and not campaigns[art_id]["source"]

    art_covers, pending = {}, []
    for sid, game in pack_map.items():
        for cover, art_id in game["arts"]:
            art = prints.get(art_id)
            art_covers[(sid, art_id)] = cover
            base = art and art.is_alt_art and base_of(sid, art)
            if base and not in_packs(art_id):   # the campaign's art in place of the usual one
                rarity, amount = wanted[sid].pop(base)
                wanted[sid][art_id] = (art.rarity or rarity, amount)
            elif base:
                pending.append((sid, art_id))

    # campaigns: one from a set named for it comes in that set; one from the packs makes a version of each selection
    # or secret pack on sale then that holds the card
    by_name = {s.get("name"): sid for sid, (s, _) in packs.items()}
    versions = defaultdict(dict)   # (set id, start, end) → {base print: art print}
    for art_id, camp in campaigns.items():
        art = prints.get(art_id)
        if not art:
            continue
        if camp["source"]:
            sid = by_name.get(camp["source"])
            base = sid and base_of(sid, art)
            if base:
                rarity, amount = wanted[sid].pop(base)
                wanted[sid][art_id] = (art.rarity or rarity, amount)
            continue
        for start, end in spans(camp):
            for sid, (s, kind) in packs.items():
                days = kind in (MdPack.Kind.SECRET, MdPack.Kind.SELECTION) and sold(sid, start, end)
                base = days and base_of(sid, art)
                if base:
                    versions[(sid, *days)][base] = art_id
    # a pack whose cover shows such an art though it was not on sale while the art came (it came out with it later):
    # the usual pack has it, as the cover says
    for sid, art_id in pending:
        if not any(art_id in swaps.values() for (vsid, _, _), swaps in versions.items() if vsid == sid):
            art = prints[art_id]
            base = base_of(sid, art)
            if base:
                rarity, amount = wanted[sid].pop(base)
                wanted[sid][art_id] = (art.rarity or rarity, amount)
    # the usual pack's cover: the latest campaign's when its art is in the usual pack, else the usual one
    covers = {}
    for sid, game in pack_map.items():
        held = [(art_id, cover) for cover, art_id in game["arts"] if art_id in wanted.get(sid, {})]
        covers[sid] = max(held)[1] if held else game["cover"]
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
            mine = {(start, end): swaps for (vsid, start, end), swaps in versions.items() if vsid == sid}
            pack.versions.exclude(pk__in=[v.pk for v in pack.versions.all() if (v.start, v.end) in mine]).delete()
            for (start, end), swaps in mine.items():
                cover = max(((art, art_covers[(sid, art)]) for art in swaps.values() if (sid, art) in art_covers), default=(0, ""))[1]
                MdPackVersion.objects.update_or_create(pack=pack, start=start, end=end, defaults={
                    "swaps": {str(base): art for base, art in sorted(swaps.items())}, "cover": cover})
            out["versions"] += len(mine)
            out["packs"] += 1
            out["cards"] += len(want)
            out["added"] += len(new) if have else 0
            out["removed"] += len(stale)
            out["changed"] += len(changed)
    out["unknown_prints"] = sorted(unknown, key=str)
    out["unknown_kinds"] = sorted(set(out["unknown_kinds"]), key=str)
    return out
