"""Fetch Yugipedia SMW properties (Archseries + effect tags) for cards.

Default mode picks only cards where every yp_* field is empty — i.e.
newly-imported rows that have never been touched. Use --all to re-fetch
the whole table.

  python manage.py fetch_yugipedia_data              # new cards only
  python manage.py fetch_yugipedia_data --all        # re-fetch everything
  python manage.py fetch_yugipedia_data --limit 200  # cap target count
  python manage.py fetch_yugipedia_data --dry-run    # print, don't save

One SMW `ask` call returns all six properties at once, batching 10
passcodes per query (Yugipedia's rate-limit-friendly maximum) with a
1.2s sleep between calls and exponential backoff on transient errors.
"""

import time
import urllib.parse

import requests
from django.core.management.base import BaseCommand
from django.db import OperationalError, transaction
from django.db.models import Q

from card.models import Card

API = "https://yugipedia.com/api.php"
UA = "ygodecks-admin/1.0"
BATCH = 10
SLEEP = 1.2
RETRIES = 5

# (Yugipedia SMW property name, Card field name)
PROPS = [
    ("Archseries", "yugipedia_archseries"),
    ("Actions", "yugipedia_actions"),
    ("Summoning", "yugipedia_summoning"),
    ("Misc", "yugipedia_misc"),
    ("MonsterSpellTrap", "yugipedia_monster_spell_trap"),
    ("Banishing", "yugipedia_banishing"),
]


def _extract(printouts: dict, key: str) -> list[str]:
    """SMW returns either {'fulltext': ..., 'fullurl': ...} dicts OR raw
    strings depending on the property type. Normalize to a flat list of
    non-empty strings."""
    out = []
    for item in printouts.get(key, []):
        if isinstance(item, dict):
            v = item.get("fulltext") or item.get("text") or ""
        else:
            v = item if isinstance(item, str) else ""
        v = v.strip()
        if v:
            out.append(v)
    return out


class Command(BaseCommand):
    help = "Fetch Yugipedia archseries + effect-tag properties for cards."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Re-fetch every card, not just empty ones")
        parser.add_argument("--limit", type=int, default=None, help="Cap the number of cards processed")
        parser.add_argument("--dry-run", action="store_true", help="Print what would change without saving")

    def handle(self, *args, **opts):
        qs = Card.objects.all()
        if not opts["all"]:
            # "Never fetched" = all six yp_* fields are empty lists.
            empty_filter = Q()
            for _, field in PROPS:
                empty_filter &= Q(**{field: []})
            qs = qs.filter(empty_filter)
        qs = qs.exclude(card_id__isnull=True).exclude(card_id="")
        qs = qs.order_by("pk")
        if opts["limit"]:
            qs = qs[: opts["limit"]]

        targets = list(qs.values_list("pk", "card_id", "name"))
        total = len(targets)
        self.stdout.write(f"Targets: {total} cards (mode={'all' if opts['all'] else 'empty-only'})")
        if total == 0:
            return

        # Group passcode → pk. Drop rows without a parseable passcode.
        # card_id is passcode * 100 + alt-art index; divide for passcode.
        pc_to_pk: dict[int, int] = {}
        pc_to_name: dict[int, str] = {}
        for pk, card_id, name in targets:
            if not card_id or not card_id.isdigit():
                continue
            pc = int(card_id) // 100
            pc_to_pk[pc] = pk
            pc_to_name[pc] = name

        passcodes = list(pc_to_pk.keys())
        self.stdout.write(f"  {len(passcodes)} unique passcodes after dedup")

        updated = 0
        empty_pages = 0
        failed_batches = 0

        for i in range(0, len(passcodes), BATCH):
            batch = passcodes[i : i + BATCH]
            res = self._fetch_batch(batch)
            if res is None:
                failed_batches += 1
                time.sleep(SLEEP)
                continue

            # Multiple pages can share a passcode (canonical + variants);
            # pick whichever page has the richest Archseries data.
            per_pc: dict[int, dict] = {}
            for page_title, page in res.items():
                printouts = page.get("printouts", {})
                pw_list = printouts.get("Password", [])
                if not pw_list:
                    continue
                try:
                    pc = int(pw_list[0])
                except (ValueError, TypeError):
                    continue
                values = {field: _extract(printouts, prop) for prop, field in PROPS}
                # Prefer the entry with non-empty archseries; otherwise the first hit.
                if pc not in per_pc or values["yugipedia_archseries"]:
                    per_pc[pc] = values

            for pc in batch:
                pk = pc_to_pk.get(pc)
                if pk is None:
                    continue
                values = per_pc.get(pc)
                if values is None:
                    empty_pages += 1
                    continue
                if opts["dry_run"]:
                    self.stdout.write(f"  [dry] {pc_to_name.get(pc, '?')} (pc={pc}) → {values}")
                else:
                    self._save(pk, values)
                updated += 1

            done = i + len(batch)
            if (i // BATCH + 1) % 50 == 0:
                self.stdout.write(
                    f"  progress: {done}/{len(passcodes)}  updated={updated}  empty={empty_pages}  failed={failed_batches}"
                )
            time.sleep(SLEEP)

        self.stdout.write(self.style.SUCCESS(
            f"Done. updated={updated}, empty_pages={empty_pages}, failed_batches={failed_batches}"
        ))

    def _fetch_batch(self, passcodes: list[int]) -> dict | None:
        pc_or = "||".join(str(p) for p in passcodes)
        prop_q = "".join(f"|?{p}" for p, _ in PROPS) + "|?Password"
        query = (
            f"[[Password::{pc_or}]]"
            f"[[Page type::Card page]][[Medium::OCG]]"
            f"{prop_q}|limit=50"
        )
        url = f"{API}?action=ask&format=json&query=" + urllib.parse.quote(query)
        for attempt in range(RETRIES):
            try:
                r = requests.get(url, timeout=30, headers={"User-Agent": UA})
                j = r.json()
                if "error" in j:
                    wait = 5 * (attempt + 1)
                    self.stderr.write(f"  yp error {j['error'].get('code')}, sleep {wait}s")
                    time.sleep(wait)
                    continue
                res = j.get("query", {}).get("results", {})
                # SMW returns {} for empty matches but [] in some edge cases.
                return res if isinstance(res, dict) else {}
            except Exception as e:
                self.stderr.write(f"  exception: {e!r} (attempt {attempt+1})")
                time.sleep(5)
        return None

    def _save(self, pk: int, values: dict) -> None:
        """Persist with retry on SQLite write lock."""
        for attempt in range(8):
            try:
                with transaction.atomic():
                    Card.objects.filter(pk=pk).update(**values)
                return
            except OperationalError as e:
                if "locked" in str(e).lower():
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise
