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

    async def send(self, text):
        self.sent.append(text)
        return FakeStatus()


class FakeMessage:
    def __init__(self, channel, content, type=discord.MessageType.default, reply_fails=False):
        self.channel, self.content, self.type = channel, content, type
        self.author = SimpleNamespace(id=7, bot=False, name="chamhyul", display_name="참혈", mention="<@7>")
        self.replies, self.reply_fails = [], reply_fails

    async def reply(self, text):
        if self.reply_fails:
            raise discord.HTTPException(SimpleNamespace(status=400, reason="Bad Request"), "Cannot reply to a system message")
        self.replies.append(text)
        return FakeStatus()


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
        self.runs = []   # (resume_id, first line of the prompt's request)
        self.gate = None

        async def fake_claude(user_msg, on_update, resume_id=None):
            n = len(self.runs) + 1
            self.runs.append(resume_id)
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

    async def test_a_thread_keeps_its_own_session_apart_from_the_channel(self):
        channel, thread = FakeChannel(COOP), FakeChannel(501, parent_id=COOP)
        await main.on_message(FakeMessage(channel, "채널 요청"))
        await main.on_message(FakeMessage(thread, "스레드 첫 요청"))
        await main.on_message(FakeMessage(thread, "스레드 둘째 요청"))
        await main.on_message(FakeMessage(channel, "채널 둘째 요청"))
        # channel: new, then its own; thread: new, then its own
        self.assertEqual(self.runs, [None, None, "session-2", "session-1"])
        self.assertEqual(await main.get_resume_id("thread-501"), "session-3")
        self.assertEqual(await main.get_resume_id(str(COOP)), "session-4")

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

    async def test_answers_in_the_channel_when_a_reply_is_refused(self):
        m = FakeMessage(FakeChannel(COOP), "요청", reply_fails=True)
        await main.on_message(m)
        self.assertEqual(len(self.runs), 1)
        self.assertTrue(m.channel.sent and m.channel.sent[0].startswith("🤔"))

    async def test_reset_in_a_thread_clears_only_that_thread(self):
        channel, thread = FakeChannel(COOP), FakeChannel(501, parent_id=COOP)
        await main.on_message(FakeMessage(channel, "채널 요청"))
        await main.on_message(FakeMessage(thread, "스레드 요청"))
        await main.on_message(FakeMessage(thread, "!reset"))
        self.assertIsNone(await main.get_resume_id("thread-501"))
        self.assertEqual(await main.get_resume_id(str(COOP)), "session-1")


if __name__ == "__main__":
    unittest.main()
