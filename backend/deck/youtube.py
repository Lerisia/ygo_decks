"""Cache of 김빠방's YouTube uploads and deck ↔ video title matching."""
import logging
import re
from datetime import datetime, timezone as dt_timezone

from django.utils import timezone

logger = logging.getLogger(__name__)

CHANNEL_ID = "UCVy5Oz8Peh78G6zcl5942oQ"
CHANNEL_NAME = "김빠방"
CHANNEL_URL = "https://www.youtube.com/@%EA%B9%80%EB%B9%A0%EB%B0%A9"
CHANNEL_VIDEOS_URL = f"https://www.youtube.com/channel/{CHANNEL_ID}/videos"

_HASHTAG_RE = re.compile(r"#(\S+)")
_HASHTAG_SUFFIX_RE = re.compile(r"덱$")


def normalize(text):
    """Lower-case and keep only letters/digits/hangul: 'F.A.' → 'fa', 'R-ACE' → 'race', '@이그니스터' → '이그니스터'."""
    return re.sub(r"[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]", "", (text or "").lower())


def hashtag_tokens(title):
    """Normalized '#xxx' tokens with a trailing '덱' stripped ('#낙인상검 덱' → '낙인상검')."""
    tokens = []
    for raw in _HASHTAG_RE.findall(title or ""):
        token = _HASHTAG_SUFFIX_RE.sub("", normalize(raw))
        if token:
            tokens.append(token)
    return tokens


def deck_keys(deck):
    """Normalized deck name + aliases, ignoring one-character keys."""
    keys = {normalize(deck.name)}
    keys.update(normalize(a.name) for a in deck.aliases.all())
    return {k for k in keys if len(k) >= 2}


# Generic words that may appear inside a hybrid hashtag ('#60낙인', '#식물링크')
# without naming a deck; they let the rest of the token be recognized.
GENERIC_PIECES = {"60", "40", "gs", "ftk", "otk", "링크", "싱크론", "융합", "원석", "비트", "순수",
                  "엔진", "컨트롤", "메타", "카오스", "펜듈럼", "엑시즈", "의식"}


def build_index(decks):
    """Matching dictionary for a set of decks.

    keys:     normalized name/alias → deck ids
    prefixes: 2–3 char abbreviations that identify exactly one deck
              ('섬도' → 섬도희); ambiguous ones ('드래' → 드래곤테일/드래곤메이드…) are dropped
    """
    keys, prefixes = {}, {}
    for deck in decks:
        for key in deck_keys(deck):
            keys.setdefault(key, set()).add(deck.id)
            for n in (2, 3):
                if len(key) > n:
                    prefixes.setdefault(key[:n], set()).add(deck.id)
    prefixes = {p: ids for p, ids in prefixes.items() if len(ids) == 1 and p not in keys}
    return {"keys": keys, "prefixes": prefixes}


def _segment(token, pieces):
    """Split token into dictionary pieces covering it entirely (longest-first); None if impossible."""
    memo = {}

    def solve(i):
        if i == len(token):
            return []
        if i in memo:
            return memo[i]
        for j in range(len(token), i, -1):
            piece = token[i:j]
            if piece in pieces:
                rest = solve(j)
                if rest is not None:
                    memo[i] = [piece] + rest
                    return memo[i]
        memo[i] = None
        return None

    return solve(0)


def decks_for_title(title, index):
    """Deck ids a video title refers to. The hashtag is the classifier:

    1. hashtag contains a deck key ('#낙인상검' → 낙인, 상검) or is contained in one ('#엑조디아' → 천년 엑조디아)
    2. hashtag decomposes into abbreviations/keys/generic words ('#섬도천배' → 섬도희 + 천배룡)
    3. only titles with no hashtag at all fall back to a 3+ char key anywhere in the title

    Deck names mentioned in prose next to another deck's hashtag ('맬리스를 잡는 #제외사이킥 덱')
    deliberately do not count — the video is about the hashtagged deck.
    """
    keys, prefixes = index["keys"], index["prefixes"]
    found = set()
    tokens = hashtag_tokens(title)
    if not tokens:
        body = normalize(title)
        for key, ids in keys.items():
            if len(key) >= 3 and key in body:
                found |= ids
        return found
    pieces = {**prefixes, **keys, **{g: set() for g in GENERIC_PIECES}}
    for token in tokens:
        for key, ids in keys.items():
            if key in token or token in key:
                found |= ids
        for piece in _segment(token, pieces) or []:
            found |= pieces[piece]
    return found


def title_matches(title, keys):
    """Single-deck check used by tests/debugging; `keys` are that deck's normalized keys."""
    index = {"keys": {k: {0} for k in keys}, "prefixes": {}}
    return 0 in decks_for_title(title, index)


def videos_for_deck(deck, queryset=None):
    """This deck's videos, matched against every deck so hybrid hashtags resolve properly."""
    from .models import ChannelVideo, Deck

    if not deck_keys(deck):
        return []
    index = build_index(Deck.objects.prefetch_related("aliases"))
    qs = queryset if queryset is not None else ChannelVideo.objects.all()
    return [v for v in qs if deck.id in decks_for_title(v.title, index)]


def serialize_video(video):
    return {
        "video_id": video.video_id,
        "title": video.title,
        "url": video.url,
        "thumbnail_url": video.thumbnail_url,
        "published_at": video.published_at.isoformat() if video.published_at else None,
        "duration": video.duration,
        "view_count": video.view_count,
    }


# --- fetching (yt-dlp) -----------------------------------------------------

def _ydl(extra=None):
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    if extra:
        opts.update(extra)
    return yt_dlp.YoutubeDL(opts)


def fetch_channel_listing():
    """Flat listing of the channel's videos tab, newest first: [{id, title, duration}]."""
    with _ydl({"extract_flat": True, "playlistend": 5000}) as ydl:
        info = ydl.extract_info(CHANNEL_VIDEOS_URL, download=False)
    entries = []
    for e in info.get("entries") or []:
        if not e or not e.get("id"):
            continue
        entries.append({"id": e["id"], "title": e.get("title") or "", "duration": e.get("duration")})
    return entries


def fetch_video_details(video_id):
    """Full metadata for one video: {published_at, view_count, duration, thumbnail_url}."""
    with _ydl() as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    ts = info.get("timestamp") or info.get("release_timestamp")
    published = None
    if ts:
        published = datetime.fromtimestamp(ts, tz=dt_timezone.utc)
    elif info.get("upload_date"):
        published = datetime.strptime(info["upload_date"], "%Y%m%d").replace(tzinfo=dt_timezone.utc)
    return {
        "published_at": published,
        "view_count": info.get("view_count"),
        "duration": info.get("duration"),
        "thumbnail_url": info.get("thumbnail") or "",
    }


def default_thumbnail(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def sync_channel_videos(fetch_listing=fetch_channel_listing, fetch_details=fetch_video_details, log=None):
    """Refresh the ChannelVideo cache.

    New videos get one detail fetch (publish date / views); existing rows only
    refresh title/position; rows missing from the listing are removed.
    Deliberately not wrapped in one transaction: the initial run makes hundreds
    of network calls and must not hold the SQLite write lock meanwhile.
    Returns (created, updated, removed)."""
    from .models import ChannelVideo

    listing = fetch_listing()
    if not listing:
        raise RuntimeError("channel listing came back empty; leaving cache untouched")

    existing = {v.video_id: v for v in ChannelVideo.objects.all()}
    seen = set()
    created = updated = 0
    now = timezone.now()
    for position, entry in enumerate(listing):
        vid = entry["id"]
        seen.add(vid)
        row = existing.get(vid)
        if row is None:
            try:
                details = fetch_details(vid)
            except Exception as exc:  # keep going; the row gets details next run
                logger.warning("detail fetch failed for %s: %s", vid, exc)
                if log:
                    log(f"  ! {vid}: {exc}")
                details = {}
            ChannelVideo.objects.create(
                video_id=vid,
                title=entry["title"],
                position=position,
                duration=details.get("duration") or entry.get("duration"),
                view_count=details.get("view_count"),
                thumbnail_url=details.get("thumbnail_url") or default_thumbnail(vid),
                published_at=details.get("published_at"),
                fetched_at=now,
            )
            created += 1
        else:
            changed = False
            if row.title != entry["title"]:
                row.title = entry["title"]; changed = True
            if row.position != position:
                row.position = position; changed = True
            if row.duration is None and entry.get("duration"):
                row.duration = entry["duration"]; changed = True
            if row.published_at is None:
                try:
                    details = fetch_details(vid)
                    row.published_at = details.get("published_at")
                    row.view_count = details.get("view_count")
                    if details.get("thumbnail_url"):
                        row.thumbnail_url = details["thumbnail_url"]
                    changed = True
                except Exception as exc:
                    logger.warning("detail refetch failed for %s: %s", vid, exc)
            if changed:
                row.fetched_at = now
                row.save()
                updated += 1
    removed, _ = ChannelVideo.objects.exclude(video_id__in=seen).delete()
    return created, updated, removed
