"""Which messages the bot answers, and which conversation each belongs to.

Run: DISCORD_BOT_TOKEN=x venv/bin/python -m unittest test_main -v
"""
import asyncio
import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("DISCORD_BOT_TOKEN", "test-token")   # main.py reads it at import; nothing here connects

import discord  # noqa: E402

import main  # noqa: E402

COOP = 111


def msg(channel, author_id=7, type=discord.MessageType.default, content="요청"):
    return SimpleNamespace(channel=channel, author=SimpleNamespace(id=author_id, bot=False), type=type, content=content)


def dm_channel():
    return object.__new__(discord.DMChannel)


class SessionKeyTest(unittest.TestCase):
    def setUp(self):
        self._saved = (main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS)
        main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS = COOP, set()

    def tearDown(self):
        main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS = self._saved

    def test_the_channel_is_one_conversation(self):
        self.assertEqual(main.session_key_for(msg(SimpleNamespace(id=COOP))), str(COOP))

    def test_each_thread_under_the_channel_is_its_own_conversation(self):
        a = main.session_key_for(msg(SimpleNamespace(id=501, parent_id=COOP)))
        b = main.session_key_for(msg(SimpleNamespace(id=502, parent_id=COOP)))
        self.assertEqual((a, b), ("thread-501", "thread-502"))
        self.assertNotEqual(a, str(COOP))

    def test_everyone_in_a_thread_shares_its_conversation(self):
        thread = SimpleNamespace(id=501, parent_id=COOP)
        self.assertEqual(main.session_key_for(msg(thread, author_id=1)), main.session_key_for(msg(thread, author_id=2)))

    def test_other_channels_and_their_threads_are_ignored(self):
        self.assertIsNone(main.session_key_for(msg(SimpleNamespace(id=222))))
        self.assertIsNone(main.session_key_for(msg(SimpleNamespace(id=503, parent_id=222))))

    def test_a_whitelist_applies_to_the_channel_and_its_threads(self):
        main.ALLOWED_USER_IDS = {7}
        thread = SimpleNamespace(id=501, parent_id=COOP)
        self.assertEqual(main.session_key_for(msg(thread, author_id=7)), "thread-501")
        self.assertIsNone(main.session_key_for(msg(thread, author_id=8)))
        self.assertIsNone(main.session_key_for(msg(SimpleNamespace(id=COOP), author_id=8)))

    def test_dms_are_for_whitelisted_users_one_conversation_each(self):
        self.assertIsNone(main.session_key_for(msg(dm_channel(), author_id=7)))
        main.ALLOWED_USER_IDS = {7}
        self.assertEqual(main.session_key_for(msg(dm_channel(), author_id=7)), "dm-7")

    def test_no_channel_configured_means_no_guild_messages(self):
        main.COOP_CHANNEL_ID = None
        self.assertIsNone(main.session_key_for(msg(SimpleNamespace(id=COOP))))
        self.assertIsNone(main.session_key_for(msg(SimpleNamespace(id=501, parent_id=None))))


class RequestFilterTest(unittest.TestCase):
    def test_only_what_a_person_typed_is_a_request(self):
        self.assertTrue(main.is_request(msg(None)))
        self.assertTrue(main.is_request(msg(None, type=discord.MessageType.reply)))

    def test_system_notices_are_not_requests(self):
        # "X started a thread: <name>" carries the thread's name as its content and cannot be replied to
        for t in (discord.MessageType.thread_created, discord.MessageType.thread_starter_message,
                  discord.MessageType.pins_add, discord.MessageType.new_member):
            self.assertFalse(main.is_request(msg(None, type=t)), t)

    def test_bots_and_blank_messages_are_not_requests(self):
        m = msg(None); m.author.bot = True
        self.assertFalse(main.is_request(m))
        self.assertFalse(main.is_request(msg(None, content="   ")))


class ThreadQueueTest(unittest.IsolatedAsyncioTestCase):
    async def test_requests_in_one_thread_run_one_at_a_time(self):
        running, peak, order = 0, 0, []

        async def work(name):
            nonlocal running, peak
            async with main.conversation_turn("thread-501"):
                running += 1; peak = max(peak, running); order.append(name)
                await asyncio.sleep(0.01)
                running -= 1

        await asyncio.gather(work("a"), work("b"), work("c"))
        self.assertEqual((peak, order), (1, ["a", "b", "c"]))

    async def test_different_threads_do_not_wait_for_each_other(self):
        running, peak = 0, 0

        async def work(key):
            nonlocal running, peak
            async with main.conversation_turn(key):
                running += 1; peak = max(peak, running)
                await asyncio.sleep(0.01)
                running -= 1

        await asyncio.gather(work("thread-1"), work("thread-2"))
        self.assertEqual(peak, 2)

    async def test_the_channel_itself_is_not_queued(self):
        running, peak = 0, 0

        async def work():
            nonlocal running, peak
            async with main.conversation_turn(str(COOP)):
                running += 1; peak = max(peak, running)
                await asyncio.sleep(0.01)
                running -= 1

        await asyncio.gather(work(), work())
        self.assertEqual(peak, 2)
        self.assertFalse(main.is_busy(str(COOP)))

    async def test_busy_tells_a_waiting_request_apart(self):
        self.assertFalse(main.is_busy("thread-9"))
        async with main.conversation_turn("thread-9"):
            self.assertTrue(main.is_busy("thread-9"))
        self.assertFalse(main.is_busy("thread-9"))


class FakeStatus:
    def __init__(self):
        self.edits = []

    async def edit(self, content):
        self.edits.append(content)


class FakeChannel:
    def __init__(self, id, parent_id=None):
        self.id = id
        if parent_id is not None:
            self.parent_id = parent_id
        self.sent = []
        self.threads = {}      # the channel's threads by id (a thread made from a message has the message's id)

    async def send(self, text):
        self.sent.append(text)
        return FakeStatus()

    def get_thread(self, id):
        return self.threads.get(id)


class FakeMessage:
    _ids = iter(range(1000, 10**6))

    def __init__(self, channel, content, type=discord.MessageType.default, reply_fails=False, author=None,
                 reply_to=None, threads_forbidden=False):
        self.id = next(FakeMessage._ids)   # every Discord message has one
        self.channel, self.content, self.type = channel, content, type
        self.author = author or SimpleNamespace(id=7, bot=False, name="chamhyul", display_name="참혈", mention="<@7>")
        self.replies, self.reply_fails = [], reply_fails
        self.reference = SimpleNamespace(message_id=reply_to) if reply_to else None
        self.threads_forbidden = threads_forbidden
        self.thread = None     # the thread made from this message, once the bot makes one

    async def reply(self, text):
        if self.reply_fails:
            raise discord.HTTPException(SimpleNamespace(status=400, reason="Bad Request"), "Cannot reply to a system message")
        self.replies.append(text)
        return FakeStatus()

    async def create_thread(self, name, auto_archive_duration):
        if self.threads_forbidden:
            raise discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "Missing Permissions")
        self.thread = FakeChannel(self.id, parent_id=self.channel.id)
        self.thread.name, self.thread.auto_archive_duration = name, auto_archive_duration
        self.channel.threads[self.id] = self.thread
        return self.thread


SINGULARITY = SimpleNamespace(id=8, bot=False, name="singularity71", display_name="특이점", mention="<@8>")


class OnMessageTest(unittest.IsolatedAsyncioTestCase):
    """The whole path from a Discord message to a Claude run, with Claude and the bot's files stood in for."""

    async def asyncSetUp(self):
        import tempfile
        from pathlib import Path
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = (main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS, main.SESSIONS_FILE, main.HISTORY_FILE, main.run_claude_streaming)
        main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS = COOP, set()
        main.SESSIONS_FILE = Path(self.tmp.name) / "sessions.json"     # never the bot's real files
        main.HISTORY_FILE = Path(self.tmp.name) / "history.json"
        main._thread_locks.clear()
        main._thread_permission_warned = False
        self.runs = []     # resume_id of each Claude run, in order
        self.prompts = []  # what each run was asked
        self.gate = None

        async def fake_claude(user_msg, on_update, resume_id=None):
            n = len(self.runs) + 1
            self.runs.append(resume_id)
            self.prompts.append(user_msg)
            if self.gate is not None:
                await self.gate.wait()
            t = main.ProgressTracker()
            t.session_id = f"session-{n}"
            t.set_final(f"답 {n}")
            return 0, t

        main.run_claude_streaming = fake_claude

    async def asyncTearDown(self):
        main.COOP_CHANNEL_ID, main.ALLOWED_USER_IDS, main.SESSIONS_FILE, main.HISTORY_FILE, main.run_claude_streaming = self._saved
        self.tmp.cleanup()

    async def test_a_request_in_the_channel_opens_a_thread_and_is_answered_there(self):
        channel = FakeChannel(COOP)
        m = FakeMessage(channel, "이모지 선택 페이지 갱신 좀 하자.\n그리고 -line 말고")
        await main.on_message(m)
        self.assertEqual(m.thread.name, "참혈: 이모지 선택 페이지 갱신 좀 하자. 그리고 -line 말고")
        self.assertTrue(m.thread.sent and m.thread.sent[0].startswith("🤔"))     # progress goes in the thread
        self.assertEqual((m.replies, channel.sent), ([], []))                       # nothing in the channel itself
        self.assertEqual(await main.get_resume_id(f"thread-{m.id}"), "session-1")  # the thread is the conversation
        self.assertIsNone(await main.get_resume_id(str(COOP)))
        self.assertIn(f"[작업 워크트리: thread-{m.id}]", self.prompts[0])          # and keeps one worktree

    async def test_follow_ups_in_that_thread_continue_its_conversation(self):
        channel = FakeChannel(COOP)
        m = FakeMessage(channel, "요청")
        await main.on_message(m)
        await main.on_message(FakeMessage(m.thread, "이어서"))
        self.assertEqual(self.runs, [None, "session-1"])

    async def test_a_reply_to_a_request_continues_in_its_thread(self):
        channel = FakeChannel(COOP)
        m = FakeMessage(channel, "요청")
        await main.on_message(m)
        follow = FakeMessage(channel, "그거 색만 바꿔줘", reply_to=m.id)
        await main.on_message(follow)
        self.assertIsNone(follow.thread)                                  # no second thread
        self.assertEqual(self.runs, [None, "session-1"])
        self.assertEqual(len(m.thread.sent), 2)                           # answered in the first thread

    async def test_two_people_in_the_channel_get_their_own_threads_and_run_side_by_side(self):
        channel = FakeChannel(COOP)
        self.gate = asyncio.Event()
        a, b = FakeMessage(channel, "참혈 요청"), FakeMessage(channel, "특이점 요청", author=SINGULARITY)
        ta = asyncio.create_task(main.on_message(a))
        await asyncio.sleep(0.01)
        tb = asyncio.create_task(main.on_message(b))
        await asyncio.sleep(0.01)
        self.assertEqual(self.runs, [None, None])                         # both started, neither waited
        self.gate.set()
        await asyncio.gather(ta, tb)
        self.assertEqual((a.thread.name, b.thread.name), ("참혈: 참혈 요청", "특이점: 특이점 요청"))
        self.assertNotEqual(await main.get_resume_id(f"thread-{a.id}"), await main.get_resume_id(f"thread-{b.id}"))
        self.assertIn(f"thread-{a.id}", self.prompts[0]); self.assertIn(f"thread-{b.id}", self.prompts[1])

    async def test_without_permission_to_make_threads_the_channel_works_as_before(self):
        channel = FakeChannel(COOP)
        first, second = FakeMessage(channel, "하나", threads_forbidden=True), FakeMessage(channel, "둘", threads_forbidden=True)
        await main.on_message(first)
        await main.on_message(second)
        self.assertEqual(self.runs, [None, "session-1"])                  # one shared channel session, as it was
        self.assertTrue(first.replies and first.replies[0].startswith("🤔"))
        self.assertEqual([s for s in channel.sent if "공개 스레드 만들기" in s].__len__(), 1)   # told once

    async def test_reset_in_the_channel_says_where_conversations_live(self):
        channel = FakeChannel(COOP)
        m = FakeMessage(channel, "!reset")
        await main.on_message(m)
        self.assertIsNone(m.thread)
        self.assertIn("스레드", m.replies[0])

    async def test_requests_sent_together_in_a_thread_follow_one_session(self):
        thread = FakeChannel(501, parent_id=COOP)
        self.gate = asyncio.Event()
        first, second = FakeMessage(thread, "하나"), FakeMessage(thread, "둘")
        t1 = asyncio.create_task(main.on_message(first))
        await asyncio.sleep(0.01)
        t2 = asyncio.create_task(main.on_message(second))
        await asyncio.sleep(0.01)
        self.assertEqual(self.runs, [None])                       # the second has not started
        self.assertTrue(second.replies and second.replies[0].startswith("⏳"))
        self.gate.set()
        await asyncio.gather(t1, t2)
        self.assertEqual(self.runs, [None, "session-1"])          # and picks up where the first left off

    async def test_the_thread_started_notice_is_left_alone(self):
        notice = FakeMessage(FakeChannel(COOP), "아이콘 샵의 테마별 모드 필터링 UX 개선",
                             type=discord.MessageType.thread_created, reply_fails=True)
        await main.on_message(notice)
        self.assertEqual((self.runs, notice.replies, notice.channel.sent), ([], [], []))

    async def test_answers_in_the_thread_when_a_reply_is_refused(self):
        m = FakeMessage(FakeChannel(501, parent_id=COOP), "요청", reply_fails=True)
        await main.on_message(m)
        self.assertEqual(len(self.runs), 1)
        self.assertTrue(m.channel.sent and m.channel.sent[0].startswith("🤔"))

    async def test_reset_in_a_thread_clears_only_that_thread(self):
        a, b = FakeChannel(501, parent_id=COOP), FakeChannel(502, parent_id=COOP)
        await main.on_message(FakeMessage(a, "첫 스레드 요청"))
        await main.on_message(FakeMessage(b, "둘째 스레드 요청"))
        await main.on_message(FakeMessage(b, "!reset"))
        self.assertIsNone(await main.get_resume_id("thread-502"))
        self.assertEqual(await main.get_resume_id("thread-501"), "session-1")


if __name__ == "__main__":
    unittest.main()


class ThreadNameTest(unittest.TestCase):
    def test_who_asked_and_what_on_one_line_within_discords_limit(self):
        m = SimpleNamespace(author=SimpleNamespace(name="chamhyul", display_name="참혈"), content="  이모지 선택 페이지\n갱신   좀 하자  ")
        self.assertEqual(main.thread_name_for(m), "참혈: 이모지 선택 페이지 갱신 좀 하자")
        m.content = "가" * 300
        self.assertEqual(len(main.thread_name_for(m)), 100)
        m.author.display_name = ""
        self.assertTrue(main.thread_name_for(m).startswith("chamhyul: "))


class WorktreeTest(unittest.TestCase):
    """Each request's worktree (2026-10-12): a thread keeps one across its requests (they run one at a time); the
    channel's requests run side by side, so each gets its own; a DM is one conversation, one at a time like a thread
    is not, so each of its requests gets its own too."""

    def test_names(self):
        thread = SimpleNamespace(id=555, parent_id=COOP)
        self.assertEqual(main.worktree_for(SimpleNamespace(id=1, channel=thread), "thread-555"), "thread-555")
        self.assertEqual(main.worktree_for(SimpleNamespace(id=42, channel=None), str(COOP)), "req-42")
        self.assertEqual(main.worktree_for(SimpleNamespace(id=43, channel=None), "dm-7"), "req-43")

    def test_the_request_names_its_worktree(self):
        text = main.build_user_message("엘리스", 7, "오너", "고쳐 주세요", worktree="thread-555")
        self.assertIn("[작업 워크트리: thread-555]", text)
        self.assertTrue(text.endswith("고쳐 주세요"))

    def test_the_rules_send_work_to_worktrees(self):
        self.assertIn("tools/wt new", main.BOT_SYSTEM_PROMPT)
        self.assertIn("tools/ship", main.BOT_SYSTEM_PROMPT)
        self.assertNotIn("bash /home/elyss/ygo_decks/deploy.sh", main.BOT_SYSTEM_PROMPT)
