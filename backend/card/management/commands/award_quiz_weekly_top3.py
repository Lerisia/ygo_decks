"""Weekly payout for the solo Card Quiz leaderboard (Mon-Sun KST).

Awards 500 / 300 / 200 points to the top 3 weekly best scores. Idempotent
per `week_start_date` (the Monday of the paid-out week) via
QuizWeeklyAward records — re-running for the same week is a no-op.

Run via system cron at 00:01 KST every Monday:

    1 0 * * 1  /path/to/manage.py award_quiz_weekly_top3 --previous-week

The default targets the CURRENT week (week of "today"). `--previous-week`
shifts back 7 days so the cron above pays out the prior Mon-Sun week.
"""
from datetime import date, datetime, time, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone


PRIZES = [500, 300, 200]


def _today_kst() -> date:
    return timezone.localtime(timezone.now()).date()


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


class Command(BaseCommand):
    help = "Award 500/300/200 points to the top 3 weekly Card Quiz scorers (Mon-Sun KST)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--previous-week",
            action="store_true",
            help="Target the previous Mon-Sun week (typical cron usage on Monday).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List winners + prizes without crediting points.",
        )
        parser.add_argument(
            "--week-start",
            help="Override week start date (YYYY-MM-DD, must be a Monday).",
        )

    def handle(self, *args, **opts):
        from card.models import QuizHighScore, QuizWeeklyAward
        from user.points import award_points
        from django.db import transaction

        if opts.get("week_start"):
            week_start = datetime.strptime(opts["week_start"], "%Y-%m-%d").date()
            if week_start.weekday() != 0:
                self.stdout.write(self.style.ERROR("--week-start must be a Monday."))
                return
        else:
            today = _today_kst()
            if opts["previous_week"]:
                week_start = _monday_of(today) - timedelta(days=7)
            else:
                week_start = _monday_of(today)

        week_end_exclusive = week_start + timedelta(days=7)
        period_label = f"{week_start.isoformat()} ~ {(week_end_exclusive - timedelta(days=1)).isoformat()}"
        self.stdout.write(f"Target week: {period_label}")

        existing = QuizWeeklyAward.objects.filter(week_start_date=week_start).count()
        if existing and not opts["dry_run"]:
            self.stdout.write(self.style.WARNING(
                f"Already awarded for week {week_start.isoformat()} ({existing} rows). Skipping."
            ))
            return

        # Window: Monday 00:00 KST inclusive → next Monday 00:00 KST exclusive.
        tz = timezone.get_current_timezone()
        window_start = timezone.make_aware(datetime.combine(week_start, time.min), tz)
        window_end = timezone.make_aware(datetime.combine(week_end_exclusive, time.min), tz)

        qs = (
            QuizHighScore.objects
            .filter(created_at__gte=window_start, created_at__lt=window_end)
            .select_related("user")
            .order_by("-score")[:3]
        )
        winners = list(qs)

        if not winners:
            self.stdout.write(self.style.WARNING(f"No scores for {period_label}. Nothing to award."))
            return

        for rank, record in enumerate(winners, start=1):
            prize = PRIZES[rank - 1]
            user = record.user
            if opts["dry_run"]:
                self.stdout.write(f"  [{rank}] {user.username}: {record.score}점 → +{prize}P (dry-run)")
                continue
            with transaction.atomic():
                award_points(
                    user, prize,
                    kind="quiz_weekly",
                    note=f"화질구지 주간 정산 {week_start.isoformat()} #{rank} ({record.score}점)",
                )
                QuizWeeklyAward.objects.create(
                    user=user,
                    week_start_date=week_start,
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
            self.stdout.write(self.style.SUCCESS(f"Done. {len(winners)} winners credited for week {week_start.isoformat()}."))
