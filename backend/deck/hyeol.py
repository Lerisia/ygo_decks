"""혈자리 아카이브 (https://mdarchive.pages.dev/#hyeol, by Hort) → per-deck summary for the deck page.

The archive publishes its data as `window.HYEOL_V2 = {...};` (hyeol-v2.js). Its deck keys are our own deck ids
(`ygo-<id>`), so no name matching is needed. We keep only what the deck page shows and link back for the rest."""
import json
import re
import urllib.request

ARCHIVE_URL = "https://mdarchive.pages.dev/"
DECK_URL = "https://mdarchive.pages.dev/#hyeol/ygo-{id}"
SEV_ORDER = {"R": 0, "Y": 1, "G": 2, "N": 3}
# Left out of the deck page: cards few people run (특이점, 2026-10-02).
HIDDEN_HANDTRAPS = {"crow_bystial", "special_meta", "gamma"}
SHORT_NAMES = {"ogre": "유령토끼"}


def fetch_archive_text(timeout=60):
    """The current hyeol-v2.js, found through the page's own script tag so its cache-busting version is followed."""
    ua = {"User-Agent": "YGODecks/1.0 (+https://ygodecks.com; hyeol summary, with permission)"}
    page = urllib.request.urlopen(urllib.request.Request(ARCHIVE_URL, headers=ua), timeout=timeout).read().decode("utf-8")
    m = re.search(r'src="(hyeol-v2\.js[^"]*)"', page)
    if not m:
        raise ValueError("hyeol-v2.js not found on the archive page")
    return urllib.request.urlopen(urllib.request.Request(ARCHIVE_URL + m.group(1), headers=ua), timeout=timeout).read().decode("utf-8")


def parse_archive(text):
    """{our deck id: summary} for the archive's decks that exist on our site."""
    from .models import Deck

    body = text.strip()
    body = body[body.index("=") + 1:].strip().rstrip(";").strip()
    raw = json.loads(body)
    traps = {t["id"]: t for t in raw.get("handtraps", [])}
    cards = raw.get("cards", {})
    ids = {int(k[4:]): v for k, v in raw.get("decks", {}).items() if k.startswith("ygo-") and k[4:].isdigit()}
    ours = set(Deck.objects.filter(id__in=ids).values_list("id", flat=True))

    out = {}
    for deck_id, d in ids.items():
        if deck_id not in ours:
            continue
        view = d.get("legacy_view") or {}
        overview = [{
            "t": o.get("t"),
            "name": traps.get(o.get("t"), {}).get("name", o.get("t")),
            "short": traps.get(o.get("t"), {}).get("short", o.get("t")),
            "level": o.get("level") or "unknown",
            "label": o.get("label") or "미분류",
            "note": o.get("note") or "",
        } for o in view.get("overview", [])]
        sections = []
        for s in view.get("sections", []):
            if s.get("handtrap") in HIDDEN_HANDTRAPS:
                continue
            rows = []
            for c in s.get("cards", []):
                cid = c.get("card")
                info = cards.get(str(cid), {}) if cid is not None else {}
                rows.append({
                    "cid": cid,
                    "name": c.get("label") or info.get("n") or "",
                    "desc": info.get("desc", ""),
                    "sev": c.get("sev") if c.get("sev") in SEV_ORDER else "N",
                    "timing": c.get("timing") or "",
                    "text": c.get("text") or "",
                    "basis": c.get("basis") or "",
                })
            rows.sort(key=lambda r: SEV_ORDER[r["sev"]])
            if not rows:
                continue
            t = traps.get(s.get("handtrap"), {})
            sections.append({
                "id": s.get("handtrap"),
                "name": s.get("name") or t.get("name", ""),
                "short": SHORT_NAMES.get(s.get("handtrap")) or t.get("short") or s.get("name", ""),
                "hint": s.get("hint") or "",
                "note": s.get("note") or "",
                "cards": rows,
            })
        if not overview and not sections:
            continue
        out[deck_id] = {
            "overview": overview,
            "sections": sections,
            "updated_at": d.get("admin_saved_at") or d.get("curated_at") or "",
            "stale": bool(d.get("stale")),
            "source_url": DECK_URL.format(id=deck_id),
        }
    return out


def store_archive(parsed):
    """Replace the stored summaries; decks the archive dropped lose theirs. Returns how many decks have one."""
    from .models import DeckHyeol

    for deck_id, data in parsed.items():
        DeckHyeol.objects.update_or_create(deck_id=deck_id, defaults={"data": data, "source_updated_at": data["updated_at"]})
    DeckHyeol.objects.exclude(deck_id__in=parsed.keys()).delete()
    return len(parsed)
