"""Sync new posts from Konami's official Yu-Gi-Oh OCG Instagram
(@yugioh_cardgame_official_jpn) via Apify, importing them into
CustomIllust so the admin icon-creation page sees them.

Idempotent — uses ``source_tweet_id = 'ig:<shortcode>[:N]'`` for dedup,
so re-running only fetches/adds posts that aren't already imported.

Run via cron, e.g.:
    0 4 * * * cd /home/elyss/ygo_decks/backend && APIFY_TOKEN=$(cat ~/.apify_token) /home/elyss/ygo_decks/backend/venv/bin/python manage.py sync_yugioh_ig
"""
import json
import os
import re
import time
import urllib.request
from urllib.error import URLError

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from avatar.models import CustomIllust

APIFY_ACTOR = "apify~instagram-scraper"
APIFY_BASE = "https://api.apify.com/v2"
TARGET_USERNAME = "yugioh_cardgame_official_jpn"
TARGET_URL = f"https://www.instagram.com/{TARGET_USERNAME}/"


def _http(method, url, token=None, data=None, raw=False):
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
        req.data = body
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    return body if raw else json.loads(body.decode("utf-8"))


def _start_run(token, max_posts):
    payload = {
        "directUrls": [TARGET_URL],
        "resultsType": "posts",
        "resultsLimit": max_posts,
        "addParentData": False,
        "searchType": "user",
        "searchLimit": 1,
    }
    r = _http("POST", f"{APIFY_BASE}/acts/{APIFY_ACTOR}/runs", token, payload)
    return r["data"]["id"], r["data"]["defaultDatasetId"]


def _wait_run(token, run_id, timeout_secs=900):
    """Poll until the run finishes (or timeout). Returns final status."""
    deadline = time.time() + timeout_secs
    while time.time() < deadline:
        r = _http("GET", f"{APIFY_BASE}/actor-runs/{run_id}", token)
        status = r["data"]["status"]
        if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            return status
        time.sleep(15)
    return "TIMED-OUT-LOCAL"


def _fetch_dataset(token, dataset_id):
    return _http(
        "GET",
        f"{APIFY_BASE}/datasets/{dataset_id}/items?clean=true&format=json",
        token,
    )


def _parse_caption(caption):
    """Extract Japanese card name from caption. Returns ('jp_name', is_setting)."""
    if not caption:
        return "", False
    m = re.search(r"「([^」]+)」", caption)
    name = m.group(1).strip() if m else ""
    if " / " in name:
        name = name.split(" / ", 1)[0].strip()
    is_setting = "設定資料" in caption or "設定画" in caption
    return name, is_setting


def _post_image_urls(post):
    """Return list of image URLs for a post (handles single + carousel)."""
    if post.get("childPosts"):
        urls = []
        for c in post["childPosts"]:
            if c.get("displayUrl"):
                urls.append(c["displayUrl"])
            elif c.get("images"):
                urls.extend(c["images"])
        return urls
    if post.get("images"):
        return list(post["images"])
    if post.get("displayUrl"):
        return [post["displayUrl"]]
    return []


def _download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


class Command(BaseCommand):
    help = "Sync Konami OCG Instagram posts into CustomIllust (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--max-posts",
            type=int,
            default=200,
            help="Max posts to scrape per run. Daily sync only needs ~5-10 newest; 200 is a safe upper bound.",
        )
        parser.add_argument(
            "--token",
            help="Apify API token. If omitted, reads APIFY_TOKEN env var.",
        )

    def handle(self, *args, **opts):
        token = opts.get("token") or os.environ.get("APIFY_TOKEN")
        if not token:
            self.stderr.write("APIFY_TOKEN env var or --token flag required.")
            return
        max_posts = opts["max_posts"]

        self.stdout.write(f"Starting Apify run (limit={max_posts})...")
        run_id, dataset_id = _start_run(token, max_posts)
        self.stdout.write(f"  run_id={run_id}")

        status = _wait_run(token, run_id)
        if status != "SUCCEEDED":
            self.stderr.write(f"Apify run finished with status={status}")
            return

        items = _fetch_dataset(token, dataset_id)
        self.stdout.write(f"Got {len(items)} posts from dataset")

        # Collect already-imported source IDs (dedup)
        existing = set(
            CustomIllust.objects
            .filter(source_tweet_id__startswith="ig:")
            .values_list("source_tweet_id", flat=True)
        )

        created = skipped = failed = 0
        for post in items:
            shortcode = post.get("shortCode")
            if not shortcode:
                continue
            urls = _post_image_urls(post)
            if not urls:
                continue

            jp_name, _is_setting = _parse_caption(post.get("caption") or "")
            base_name = (jp_name or "Untitled")[:100]
            timestamp = (post.get("timestamp") or "")[:10]

            for i, url in enumerate(urls):
                source_id = f"ig:{shortcode}" if len(urls) == 1 else f"ig:{shortcode}:{i + 1}"
                if source_id in existing:
                    skipped += 1
                    continue

                try:
                    blob = _download(url)
                except (URLError, TimeoutError) as e:
                    failed += 1
                    self.stderr.write(f"  download failed for {source_id}: {e}")
                    continue

                suffix = f"_{i + 1}" if len(urls) > 1 else ""
                fname = f"{timestamp}_{shortcode}{suffix}.jpg"
                ci = CustomIllust(name=base_name, source_tweet_id=source_id)
                ci.image.save(fname, ContentFile(blob), save=True)
                created += 1
                existing.add(source_id)

        self.stdout.write(
            self.style.SUCCESS(
                f"sync_yugioh_ig done: created={created} skipped={skipped} failed={failed}"
            )
        )
