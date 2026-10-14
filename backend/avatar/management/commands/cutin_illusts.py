import json
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand

from avatar.cutin_illusts import PoseRenderer, index, make, save_illust
from carddb.models import MdPrint


class Command(BaseCommand):
    help = ("Make icon-pool illustrations from the summon cut-ins: each figure at rest, drawn large, laid on its card's "
            "art. Pictures and report.json go to --out; --save puts the clean ones in the pool (avatar.CustomIllust).")

    def add_arguments(self, parser):
        parser.add_argument("cards", nargs="*", type=int, help="print ids to do (every cut-in when none)")
        parser.add_argument("--out", default=str(Path.home() / ".cache/cutin_illusts"))
        parser.add_argument("--save", action="store_true", help="put the clean ones in the icon pool")
        parser.add_argument("--accept", action="store_true", help="with --save: the ones waiting for a look go in too (엘리스 10/15: 걍 다 넣어요)")
        parser.add_argument("--replace", action="store_true", help="with --save: make the pool's picture again")
        parser.add_argument("--redo", action="store_true", help="do prints the report already has")

    def handle(self, *args, **options):
        out = Path(options["out"])
        out.mkdir(parents=True, exist_ok=True)
        report = out / "report.json"
        rows = json.loads(report.read_text()) if report.exists() else {}
        entries = index()
        ids = options["cards"] or sorted(entries, key=int)
        wanted = ("clean", "check") if options["accept"] else ("clean",)
        with PoseRenderer(out) as renderer:
            for md_id in ids:
                md_id = int(md_id)
                row = rows.get(str(md_id))
                made = row is None or options["redo"]
                if made:
                    entry = entries[str(md_id)]
                    try:
                        row = make(md_id, lambda size, look=None: renderer.render(md_id, entry["v"], size, None if look is None else (entry["anim"], look)), out)
                    except Exception as e:   # noqa: BLE001 — one print's trouble must not end the night's run
                        row = {"md_id": md_id, "name": "", "verdict": "error", "error": f"{type(e).__name__}: {e}"[:300]}
                saved = options["save"] and row["verdict"] in wanted and ("illust" not in row or options["replace"])
                if saved:
                    obj, _ = save_illust(MdPrint.objects.select_related("card").get(md_id=md_id), Path(row["file"]).read_bytes(), options["replace"])
                    row["illust"] = obj.id
                if not (made or saved):
                    continue
                rows[str(md_id)] = row
                report.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
                if options["verbosity"]:
                    detail = " ".join(f"{k}={row[k]}" for k in ("inliers", "error", "scale", "covered", "look", "gap") if k in row)
                    self.stdout.write(f"{md_id} {row['name']}: {row['verdict']}{' saved' if saved else ''} {detail}")
        if options["verbosity"]:
            counts = Counter(r["verdict"] for r in rows.values())
            self.stdout.write(", ".join(f"{v} {n}" for v, n in sorted(counts.items())))
