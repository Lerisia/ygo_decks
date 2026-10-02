"""혈자리 아카이브 (https://mdarchive.pages.dev/#hyeol, by Hort) → per-deck summary for the deck page.

The archive publishes its data as `window.HYEOL_V2 = {...};` (hyeol-v2.js). Its deck keys are our own deck ids
(`ygo-<id>`), so no name matching is needed.

Brief only (the archive's maker asked on 2026-10-02 that the details stay on mdarchive so people visit and send
feedback there): how much the draw/search hand traps (드롤, 증식의 G, 마루챠미) hurt the deck — nothing else.
Which card to hit with each hand trap, priorities, timing and reasons are left to the archive, which the deck page links to."""
import json
import re
import urllib.request

ARCHIVE_URL = "https://mdarchive.pages.dev/"
DECK_URL = "https://mdarchive.pages.dev/#hyeol/ygo-{id}"
SHORT_NAMES = {"maxxc": "증식의 G"}


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
    ids = {int(k[4:]): v for k, v in raw.get("decks", {}).items() if k.startswith("ygo-") and k[4:].isdigit()}
    ours = set(Deck.objects.filter(id__in=ids).values_list("id", flat=True))

    out = {}
    for deck_id, d in ids.items():
        if deck_id not in ours:
            continue
        view = d.get("legacy_view") or {}
        overview = [{
            "t": o.get("t"),
            "short": SHORT_NAMES.get(o.get("t")) or traps.get(o.get("t"), {}).get("short", o.get("t")),
            "level": o.get("level") or "unknown",
            "label": o.get("label") or "미분류",
        } for o in view.get("overview", [])]
        if not overview:
            continue
        out[deck_id] = {
            "overview": overview,
            "updated_at": d.get("admin_saved_at") or d.get("curated_at") or "",
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
