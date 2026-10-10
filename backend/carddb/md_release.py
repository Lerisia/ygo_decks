"""When each card came to Master Duel, from masterduelmeta.com's public card API (its gameId is our print id).
Our own import records the day a new print first shows up; MDM's date, when it has one, is taken over it."""
import time
from datetime import datetime, timedelta, timezone

import requests

MDM_CARDS = "https://www.masterduelmeta.com/api/v1/cards"
KST = timezone(timedelta(hours=9))
PAGE = 500


def fetch_releases(pause=1.0, get=None):
    """{print id: release date in KST} for every card MDM lists, a page at a time. MDM lists a card's alternate arts
    under the same gameId with their own (later) days, so those are skipped and the earliest day kept."""
    get = get or requests.get
    out, page = {}, 1
    while True:
        r = get(MDM_CARDS, params={"limit": PAGE, "page": page, "fields": "gameId,release,alternateArt"}, timeout=30,
                headers={"User-Agent": "YGODecks card book (+https://ygodecks.com)"})
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return out
        for row in rows:
            gid, release = str(row.get("gameId") or ""), row.get("release")
            if gid.isdigit() and release and not row.get("alternateArt"):
                day = datetime.fromisoformat(release.replace("Z", "+00:00")).astimezone(KST).date()
                out[int(gid)] = min(day, out.get(int(gid), day))
        if len(rows) < PAGE:
            return out
        page += 1
        time.sleep(pause)
