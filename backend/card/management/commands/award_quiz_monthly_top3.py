"""End-of-month payout for the solo Card Quiz leaderboard.

Awards 500 / 300 / 100 points to the top 3 monthly best scores. Idempotent
per (year, month) via QuizMonthlyAward records — re-running the command
within the same period is a no-op.

Run via system cron at the END of each month (or first day of next month):

    0 0 1 * *  /path/to/manage.py award_quiz_monthly_top3 --previous-month

The default targets the CURRENT month — useful for manual testing or for
running on the very last minute of the month. `--previous-month` shifts
back one month so the cron above pays out April scores when it fires on
May 1, etc.
"""
from datetime import date

from django.core.management.base import BaseCommand
from django.utils import timezone


DEFAULT_PRIZES = [500, 300, 100]
# One-off bonus for the final month of the monthly cadence — announced cap
# before the switch to weekly payouts on 2026-06-01.
SPECIAL_PRIZES = {(2026, 5): [1000, 500, 300]}


def prizes_for(year: int, month: int) -> list[int]:
    return SPECIAL_PRIZES.get((year, month), DEFAULT_PRIZES)


class Command(BaseCommand):
    help = "Award 500/300/100 points to the top 3 monthly Card Quiz scorers."

    def add_arguments(self, parser):
        parser.add_argument(
            "--previous-month",
            action="store_true",
            help="Target last month instead of the current month (typical cron usage on the 1st).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List winners + prizes without crediting points.",
        )
        parser.add_argument(
            "--year",
            type=int,
            help="Override target year (use with --month).",
        )
        parser.add_argument(
            "--month",
            type=int,
            help="Override target month (use with --year).",
        )

    def handle(self, *args, **opts):
        from card.models import QuizHighScore, QuizMonthlyAward
        from user.points import award_points
        from django.db import transaction

        # KST-local — the cron fires at 00:01 KST on the 1st of each month,
        # which is 15:01 UTC of the previous day. Without converting to local
        # time, `--previous-month` would compute "previous month" off-by-one
        # (e.g. on 2026-06-01 KST → 2026-05-31 UTC → "previous month" = April).
        now = timezone.localtime(timezone.now())
        if opts.get("year") and opts.get("month"):
            target_year = opts["year"]
            target_month = opts["month"]
        elif opts["previous_month"]:
            first_of_this_month = now.replace(day=1)
            prev = first_of_this_month - timezone.timedelta(days=1)
            target_year, target_month = prev.year, prev.month
        else:
            target_year, target_month = now.year, now.month

        period_label = f"{target_year}.{target_month:02d}"
        self.stdout.write(f"Target period: {period_label}")

        # Monthly cadence retired after 2026-05. From 2026-06 onward, payouts
        # are handled by `award_quiz_weekly_top3`. Cron may keep firing this
        # command; refuse to run so the weekly cadence is the single source.
        if (target_year, target_month) > (2026, 5):
            self.stdout.write(self.style.WARNING(
                f"Monthly payout retired after 2026.05. Skipping {period_label}."
            ))
            return

        # Idempotency: skip if any award rows already exist for this period.
        existing = QuizMonthlyAward.objects.filter(year=target_year, month=target_month).count()
        if existing and not opts["dry_run"]:
            self.stdout.write(self.style.WARNING(
                f"Already awarded for {period_label} ({existing} rows). Skipping."
            ))
            return

        # Top-3 from this month's QuizHighScore (monthly resets are baked into
        # QuizHighScore.score by submit-score; we just pick the 3 highest).
        qs = QuizHighScore.objects.filter(
            created_at__year=target_year,
            created_at__month=target_month,
        ).select_related("user").order_by("-score")[:3]
        winners = list(qs)

        if not winners:
            self.stdout.write(self.style.WARNING(f"No scores for {period_label}. Nothing to award."))
            return

        prizes = prizes_for(target_year, target_month)
        for rank, record in enumerate(winners, start=1):
            prize = prizes[rank - 1]
            user = record.user
            if opts["dry_run"]:
                self.stdout.write(f"  [{rank}] {user.username}: {record.score}점 → +{prize}P (dry-run)")
                continue
            with transaction.atomic():
                award_points(
                    user, prize,
                    kind="quiz_monthly",
                    note=f"{target_year}년 {target_month}월 #{rank} ({record.score}점)",
                )
                QuizMonthlyAward.objects.create(
                    user=user,
                    year=target_year,
                    month=target_month,
                    rank=rank,
                    score=record.score,
                    points_awarded=prize,
                )
            self.stdout.write(self.style.SUCCESS(
                f"  [{rank}] {user.username}: {record.score}점 → +{prize}P"
            ))

        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry-run complete (no points credited)."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Done. {len(winners)} winners credited for {period_label}."))
