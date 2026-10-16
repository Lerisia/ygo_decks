import json

from django.contrib.admin.models import ADDITION, CHANGE, LogEntry
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tool.models import SiteConfig
from tool.season import KEY, KST, STAGES, cup_stage, cup_stages, parse_moment
from user.models import User

NAMES = {1: "1st Stage", 2: "2nd Stage"}


def shown(at):
    return at.astimezone(KST).isoformat(timespec="minutes")


class Command(BaseCommand):
    help = ("The Duelist Cup's stage dates the home page's 메타 통계 tile reads (참혈 2026-10-16). With no action, what is "
            "stored; 'stage N START END --by USER' sets stage N (times without an offset are Korean, END is the first minute "
            "after it: Konami's '~ 10/26 12:59' is 2026-10-26T13:00; stages may overlap, the later one shows); "
            "'clear --by USER' empties it. Changes go to the admin log.")

    def add_arguments(self, parser):
        actions = parser.add_subparsers(dest="action")
        stage = actions.add_parser("stage")
        stage.add_argument("stage", type=int)
        stage.add_argument("start")
        stage.add_argument("end")
        stage.add_argument("--by", required=True)
        clear = actions.add_parser("clear")
        clear.add_argument("--by", required=True)

    def handle(self, *args, **opts):
        if opts["action"] == "stage":
            self.set_stage(opts)
        elif opts["action"] == "clear":
            self.save([], self.operator(opts["by"]), "듀얼리스트 컵 일정 비움")
        self.show()

    def operator(self, username):
        user = User.objects.filter(username=username, is_staff=True).first()
        if not user:
            raise CommandError(f"운영진 계정이 아닙니다: {username}")
        return user

    def set_stage(self, opts):
        n = opts["stage"]
        if n not in STAGES:
            raise CommandError(f"단계는 {', '.join(map(str, STAGES))} 중 하나입니다.")
        try:
            start, end = parse_moment(opts["start"]), parse_moment(opts["end"])
        except ValueError as e:
            raise CommandError(f"시각을 읽을 수 없습니다: {e}")
        if start >= end:
            raise CommandError("끝이 시작보다 뒤여야 합니다.")
        user = self.operator(opts["by"])
        others = [s for s in cup_stages() if s[0] != n]
        self.save(sorted(others + [(n, start, end)], key=lambda s: s[1]), user,
                  f"듀얼리스트 컵 {NAMES[n]} 일정: {shown(start)} ~ {shown(end)} (manage.py cup_schedule)")

    def save(self, stages, user, message):
        value = {"stages": [{"stage": n, "start": shown(s), "end": shown(e)} for n, s, e in stages]}
        _, created = SiteConfig.objects.update_or_create(key=KEY, defaults={"value": json.dumps(value)})
        LogEntry.objects.log_actions(
            user_id=user.id,
            queryset=SiteConfig.objects.filter(key=KEY),
            action_flag=ADDITION if created else CHANGE,
            change_message=message,
        )

    def show(self):
        stages = cup_stages()
        if not stages:
            self.stdout.write("저장된 듀얼리스트 컵 일정 없음")
        for n, s, e in stages:
            self.stdout.write(f"{NAMES[n]}: {shown(s)} ~ {shown(e)}")
        now = cup_stage(timezone.now())
        self.stdout.write(f"지금: {NAMES[now] if now else '컵 기간 아님'}")
