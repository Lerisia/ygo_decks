import json
from datetime import datetime
from io import StringIO
from zoneinfo import ZoneInfo

from django.contrib.admin.models import LogEntry
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient

from user.models import User
from .models import SiteConfig
from .season import KEY, cup_stage, cup_stages, md_season

KST = ZoneInfo("Asia/Seoul")


def kst(*args):
    return datetime(*args, tzinfo=KST)


def store(stages):
    SiteConfig.objects.update_or_create(key=KEY, defaults={"value": json.dumps({"stages": stages})})


OCTOBER = [
    {"stage": 1, "start": "2026-10-14T15:00:00+09:00", "end": "2026-10-17T15:00:00+09:00"},
    {"stage": 2, "start": "2026-10-17T15:00:00+09:00", "end": "2026-10-20T15:00:00+09:00"},
]


class MdSeasonTest(TestCase):
    def test_october_2026_is_season_58(self):
        self.assertEqual(md_season(kst(2026, 10, 16, 18)), 58)

    def test_the_month_turns_at_midnight_in_korea(self):
        self.assertEqual(md_season(kst(2026, 10, 31, 23, 59)), 58)
        self.assertEqual(md_season(kst(2026, 11, 1, 0, 0)), 59)
        # 15:30 UTC on the 31st is already November in Korea
        self.assertEqual(md_season(datetime(2026, 10, 31, 15, 30, tzinfo=ZoneInfo("UTC"))), 59)

    def test_years_carry_on(self):
        self.assertEqual(md_season(kst(2027, 1, 5)), 61)
        self.assertEqual(md_season(kst(2026, 9, 30)), 57)


class CupStageTest(TestCase):
    def test_no_schedule_means_no_stage(self):
        self.assertEqual(cup_stages(), [])
        self.assertIsNone(cup_stage(kst(2026, 10, 15)))

    def test_inside_each_stage(self):
        store(OCTOBER)
        self.assertEqual(cup_stage(kst(2026, 10, 15, 12)), 1)
        self.assertEqual(cup_stage(kst(2026, 10, 18, 12)), 2)

    def test_a_stage_runs_from_its_start_up_to_its_end(self):
        store(OCTOBER)
        self.assertEqual(cup_stage(kst(2026, 10, 14, 15)), 1)
        self.assertEqual(cup_stage(kst(2026, 10, 17, 15)), 2)
        self.assertIsNone(cup_stage(kst(2026, 10, 20, 15)))

    def test_outside_the_cup(self):
        store(OCTOBER)
        self.assertIsNone(cup_stage(kst(2026, 10, 14, 14, 59)))
        self.assertIsNone(cup_stage(kst(2026, 11, 1)))

    def test_a_gap_between_stages(self):
        store([{**OCTOBER[0]}, {**OCTOBER[1], "start": "2026-10-18T15:00:00+09:00"}])
        self.assertIsNone(cup_stage(kst(2026, 10, 18, 9)))

    def test_overlapping_stages_name_the_later_one(self):
        # October 2026 as Konami posted it: 1st 10/14 13:00 ~ 10/26 12:59, 2nd 10/23 13:00 ~ 10/26 12:59
        store([
            {"stage": 1, "start": "2026-10-14T13:00+09:00", "end": "2026-10-26T13:00+09:00"},
            {"stage": 2, "start": "2026-10-23T13:00+09:00", "end": "2026-10-26T13:00+09:00"},
        ])
        self.assertEqual(cup_stage(kst(2026, 10, 23, 12, 59)), 1)
        self.assertEqual(cup_stage(kst(2026, 10, 23, 13)), 2)
        self.assertEqual(cup_stage(kst(2026, 10, 26, 12, 59)), 2)
        self.assertIsNone(cup_stage(kst(2026, 10, 26, 13)))

    def test_times_without_an_offset_are_korean(self):
        store([{"stage": 1, "start": "2026-10-14T15:00", "end": "2026-10-17T15:00"}])
        self.assertEqual(cup_stage(kst(2026, 10, 14, 15)), 1)
        self.assertIsNone(cup_stage(kst(2026, 10, 14, 14, 59)))

    def test_utc_z_times_read(self):
        store([{"stage": 2, "start": "2026-10-17T06:00:00Z", "end": "2026-10-20T06:00:00Z"}])
        self.assertEqual(cup_stage(kst(2026, 10, 17, 15)), 2)

    def test_a_broken_schedule_is_no_schedule(self):
        SiteConfig.objects.create(key=KEY, value="not json")
        self.assertIsNone(cup_stage(kst(2026, 10, 15)))

    def test_broken_rows_are_skipped(self):
        store([
            {"stage": 3, "start": "2026-10-14T15:00", "end": "2026-10-17T15:00"},
            {"stage": 1, "start": "soon", "end": "2026-10-17T15:00"},
            {"stage": 1, "start": "2026-10-17T15:00", "end": "2026-10-14T15:00"},
            "nothing",
            OCTOBER[1],
        ])
        self.assertIsNone(cup_stage(kst(2026, 10, 15)))
        self.assertEqual(cup_stage(kst(2026, 10, 18)), 2)


class HomeSeasonApiTest(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def get(self):
        return APIClient().get("/api/home/season/")

    def test_open_to_anyone_and_names_the_season(self):
        r = self.get()
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsInstance(body["season"], int)
        self.assertIsNone(body["cup_stage"])

    def test_names_the_stage_while_the_cup_runs(self):
        store([{"stage": 2, "start": "2020-01-01T00:00", "end": "2099-01-01T00:00"}])
        self.assertEqual(self.get().json()["cup_stage"], 2)

    def test_kept_a_minute(self):
        r = self.get()
        self.assertIn("max-age=60", r["Cache-Control"])
        store([{"stage": 1, "start": "2020-01-01T00:00", "end": "2099-01-01T00:00"}])
        self.assertIsNone(self.get().json()["cup_stage"])
        cache.clear()
        self.assertEqual(self.get().json()["cup_stage"], 1)


class CupScheduleCommandTest(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(email="s@test.com", username="staff1", password="pass1234", is_staff=True)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("cup_schedule", *args, stdout=out)
        return out.getvalue()

    def test_shows_nothing_stored(self):
        self.assertIn("없음", self.run_cmd())

    def test_sets_a_stage_and_logs_it(self):
        self.run_cmd("stage", "1", "2026-10-14T15:00", "2026-10-17T15:00", "--by", "staff1")
        self.assertEqual(cup_stage(kst(2026, 10, 15)), 1)
        entry = LogEntry.objects.get()
        self.assertEqual(entry.user, self.staff)
        self.assertIn("1st Stage", entry.change_message)
        self.assertIn("2026-10-14T15:00", self.run_cmd())

    def test_setting_a_stage_again_replaces_it(self):
        self.run_cmd("stage", "1", "2026-10-14T15:00", "2026-10-17T15:00", "--by", "staff1")
        self.run_cmd("stage", "2", "2026-10-17T15:00", "2026-10-20T15:00", "--by", "staff1")
        self.run_cmd("stage", "1", "2026-10-13T15:00", "2026-10-17T15:00", "--by", "staff1")
        self.assertEqual(cup_stage(kst(2026, 10, 13, 16)), 1)
        self.assertEqual(cup_stage(kst(2026, 10, 18)), 2)
        self.assertEqual(len(cup_stages()), 2)
        self.assertEqual(LogEntry.objects.count(), 3)

    def test_refuses_bad_input(self):
        for args in (
            ("stage", "3", "2026-10-14T15:00", "2026-10-17T15:00", "--by", "staff1"),
            ("stage", "1", "2026-10-17T15:00", "2026-10-14T15:00", "--by", "staff1"),
            ("stage", "1", "tomorrow", "2026-10-17T15:00", "--by", "staff1"),
            ("stage", "1", "2026-10-14T15:00", "2026-10-17T15:00", "--by", "nobody"),
            ("stage", "1", "2026-10-14T15:00", "2026-10-17T15:00"),
        ):
            with self.subTest(args=args), self.assertRaises((CommandError, SystemExit)):
                self.run_cmd(*args)
        self.assertFalse(SiteConfig.objects.filter(key=KEY).exists())

    def test_stages_may_overlap(self):
        self.run_cmd("stage", "1", "2026-10-14T13:00", "2026-10-26T13:00", "--by", "staff1")
        self.run_cmd("stage", "2", "2026-10-23T13:00", "2026-10-26T13:00", "--by", "staff1")
        self.assertEqual(cup_stage(kst(2026, 10, 20)), 1)
        self.assertEqual(cup_stage(kst(2026, 10, 24)), 2)

    def test_clear(self):
        self.run_cmd("stage", "1", "2026-10-14T15:00", "2026-10-17T15:00", "--by", "staff1")
        self.run_cmd("clear", "--by", "staff1")
        self.assertIsNone(cup_stage(kst(2026, 10, 15)))
        self.assertEqual(LogEntry.objects.count(), 2)
