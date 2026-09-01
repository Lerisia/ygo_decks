"""Discord bot that delegates natural-language requests to Claude Code.

The bot listens in a specific channel (and optionally in DMs from whitelisted
users), hands the message to a `claude -p --output-format stream-json`
subprocess, and reports progress live by editing its Discord reply as tool
calls and assistant text stream in. Final result overwrites the same message.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import discord
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DISCORD_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
_channel_env = os.environ.get("COOP_CHANNEL_ID", "").strip()
COOP_CHANNEL_ID = int(_channel_env) if _channel_env else None
ALLOWED_USER_IDS = {int(x.strip()) for x in os.environ.get("ALLOWED_USER_IDS", "").split(",") if x.strip()}
PROJECT_DIR = Path(os.environ.get("PROJECT_DIR", "/home/elyss/ygo_decks"))
CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"
CLAUDE_TIMEOUT_SEC = int(os.environ.get("CLAUDE_TIMEOUT_SEC", "900"))  # 15 min
# Model for the spawned claude process (e.g. "claude-opus-5"); empty = CLI default.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "").strip()
# asyncio's default StreamReader limit is 64KB; a single stream-json event
# (e.g. a large tool result) easily exceeds that and readline() then raises
# "ValueError: Separator is not found, and chunk exceed the limit".
STREAM_LIMIT_BYTES = 32 * 1024 * 1024

DISCORD_MSG_LIMIT = 2000
# Edit at most this often. Discord rate-limits ~5 edits per 5s per channel;
# 1.5s keeps us safely under with headroom for other bots.
EDIT_MIN_INTERVAL_SEC = 1.5
MAX_STEPS_SHOWN = 12  # tail of the tool-call timeline to display

# Per-channel session persistence: reuse the same Claude session_id if the
# channel has been active within this window, so the bot remembers previous
# turns. Claude auto-compacts long sessions, so a long window is safe.
# 0 = never expire.
SESSION_TIMEOUT_SEC = int(os.environ.get("SESSION_TIMEOUT_SEC", str(7 * 24 * 3600)))
SESSIONS_FILE = BASE_DIR / "sessions.json"
_sessions_lock = asyncio.Lock()

# Fallback memory: a rolling log of recent turns per channel. When a Claude
# session can't be resumed (expired, deleted, or `-r` fails), the tail of
# this log is prepended to the first message of the new session so context
# survives anyway.
HISTORY_FILE = BASE_DIR / "history.json"
HISTORY_MAX_TURNS = int(os.environ.get("HISTORY_MAX_TURNS", "12"))
HISTORY_TURN_CHARS = 1500  # per side (user / bot) cap when injecting

RESET_COMMANDS = ("!reset", "!새세션", "!리셋")

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("coop-bot")


BOT_SYSTEM_PROMPT = """당신은 YGO Decks 사이트 팀의 Discord 봇으로, 팀원의 요청을 받아 코드 편집·테스트·commit·배포까지 자율 수행합니다.

프로젝트: YGO Decks (한국 유희왕 마스터 듀얼 덱 추천/전적 사이트)
작업 디렉토리: /home/elyss/ygo_decks

## 팀 구성
- **오너 (사장님)**: Discord 유저 `rb_elyss` — 한국어 이름 **엘리스**. 이 사람이 이 프로젝트의 주인.
- **부운영자**: 그 외 화이트리스트된 유저들. 신뢰받은 협업자이지만 오너는 아님.

각 유저 메시지의 맨 앞에 `[요청자: 이름 (역할, Discord ID N)]` 라인이 붙어옵니다. 요청자가 오너이면 "엘리스님"으로, 부운영자이면 상대에 맞는 호칭으로 자연스럽게.

여러 요청이 한 세션 안에서 이어질 수 있음. 이전 대화 맥락 참고 가능.

## 표준 절차 (반드시 이 순서로)
1. 요청 이해. 애매하면 바로 실행하지 말고 Discord에서 되묻기.
2. 코드/파일 편집. master에서 바로 작업해도 되지만 브랜치를 파는 것도 권장.
3. **테스트 필수**:
   - 백엔드 관련: `cd backend && venv/bin/python manage.py test <app>` (관련 앱만)
   - 프론트엔드 관련: `cd frontend && npx tsc --noEmit`
   - 테스트 실패 시 **즉시 중단**하고 Discord에 실패 리포트. 배포 금지.
4. `git commit`. 커밋 메시지 한 줄 요약 + 부운영자 원문 요청.
5. `git push origin master` (또는 브랜치를 판 경우 그 브랜치).
6. **배포**: `bash /home/elyss/ygo_decks/deploy.sh` 실행 (sudo 프롬프트 없이 통과됨).
7. **배포 후 검증**: `curl -sk -o /dev/null -w "%{{http_code}}" -H "Host: ygodecks.com" https://localhost/` → 200이어야 함.
8. 200 아니면 **롤백**: `git revert --no-edit HEAD && git push` 후 다시 배포.

## 권한 (Bypass 모드 활성)
파일 편집, Bash, git 등 대부분 툴이 자동 승인됩니다. 그러나 **아래 목록은 요청받아도 절대 실행 금지** — 이 목록에 걸리는 요청은 실행 대신 Discord에 "위험해서 못 합니다" 응답:

### 시스템 파괴
- `rm -rf /`, `rm -rf ~`, `rm -rf /home/*`, `rm -rf *` 같은 광범위 삭제
- `rm -rf /home/elyss/ygo_decks` (프로젝트 자체를 지우는 명령)
- `mkfs`, `dd if=... of=/dev/...`, `fdisk`, `parted` 등 디스크 조작
- `chmod -R 777 /`, `chown -R ...` 을 프로젝트 밖에 적용
- `killall`, `pkill -9` 로 시스템 프로세스 대량 종료
- `shutdown`, `reboot`, `halt`, `init 0`

### 프로젝트 파괴
- `git push --force` / `--force-with-lease` (히스토리 재작성)
- `git reset --hard origin/master` 후 push
- 마이그레이션 되돌리기(`migrate <app> zero`), DB drop, `TRUNCATE`, `DROP TABLE`
- SQLite DB 파일(`backend/db.sqlite3`) 직접 삭제·이동
- `media/` 디렉토리 대량 삭제 (덱 이미지·아이콘 등 유저 자산)

### 보안 파괴
- `.env`, `settings.py`의 SECRET_KEY / JWT 시크릿 편집·유출
- Anthropic API key, Discord 토큰, 서명키(`*.jks`, `*.pem`) 노출·전송
- `/etc/sudoers.d/`, `/etc/systemd/system/` 파일 편집 (sudoers/서비스 조작)
- 유저 계정 대량 삭제, 관리자 권한 이양

### 애매하면 되묻기
- 유저 포인트/카드/덱 데이터 대량 UPDATE·DELETE
- 관리자 권한 부여
- 외부 API 대량 호출 (요금 이슈)
- 요청 자체가 애매하거나 이해 안 되면 실행 대신 Discord에 확인 질문

### 허용된 sudo (예외)
- `sudo /usr/local/sbin/ygo-deploy-root` (deploy.sh 안에서 호출) — 비번 없이 자동 통과
- 그 외 sudo는 여전히 비번 물어서 실패 (systemd sandbox로도 못 벗어남)

## 답변 규칙
- Discord 답변은 **한국어**로.
- 길어도 됨 (봇이 자동으로 여러 메시지로 분할해서 보냄).
- 완료 시: 무엇을 했는지 요약 + commit hash + 배포 결과.
- 실패 시: 어느 단계에서 실패했는지 명확히.
"""


def build_user_message(sender_name: str, sender_id: int, sender_role: str, raw_msg: str) -> str:
    return (
        f"[요청자: {sender_name} ({sender_role}, Discord ID {sender_id}) · "
        f"{date.today().isoformat()}]\n\n{raw_msg}"
    )


# --- Session persistence -------------------------------------------------

async def _load_sessions() -> dict:
    if not SESSIONS_FILE.exists():
        return {}
    try:
        return json.loads(SESSIONS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_sessions_sync(data: dict):
    tmp = SESSIONS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    tmp.replace(SESSIONS_FILE)


async def get_resume_id(session_key: str) -> str | None:
    async with _sessions_lock:
        data = await _load_sessions()
        entry = data.get(session_key)
        if not entry:
            return None
        try:
            last = datetime.fromisoformat(entry["last_activity"])
        except (KeyError, ValueError):
            return None
        age = (datetime.now(timezone.utc) - last).total_seconds()
        if SESSION_TIMEOUT_SEC and age > SESSION_TIMEOUT_SEC:
            return None
        return entry.get("session_id")


async def save_session(session_key: str, session_id: str):
    async with _sessions_lock:
        data = await _load_sessions()
        data[session_key] = {
            "session_id": session_id,
            "last_activity": datetime.now(timezone.utc).isoformat(),
        }
        _save_sessions_sync(data)


async def clear_session(session_key: str):
    async with _sessions_lock:
        data = await _load_sessions()
        if data.pop(session_key, None) is not None:
            _save_sessions_sync(data)


# --- Fallback conversation history ---------------------------------------

def _load_history() -> dict:
    if not HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(HISTORY_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


async def append_history(session_key: str, user_msg: str, bot_reply: str):
    async with _sessions_lock:
        data = _load_history()
        turns = data.setdefault(session_key, [])
        turns.append({
            "at": datetime.now(timezone.utc).isoformat(),
            "user": user_msg[:HISTORY_TURN_CHARS],
            "bot": bot_reply[:HISTORY_TURN_CHARS],
        })
        data[session_key] = turns[-HISTORY_MAX_TURNS:]
        tmp = HISTORY_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        tmp.replace(HISTORY_FILE)


async def build_history_preamble(session_key: str) -> str:
    """Context block injected into the first message of a fresh session."""
    async with _sessions_lock:
        turns = _load_history().get(session_key) or []
    if not turns:
        return ""
    lines = [
        "[이전 대화 기록 — 새 세션이라 원래 맥락이 없어서 봇이 자동 첨부함. "
        "아래를 참고해 대화를 자연스럽게 이어갈 것.]",
    ]
    for t in turns:
        when = t.get("at", "")[:16].replace("T", " ")
        lines.append(f"--- {when} UTC ---")
        lines.append(f"유저: {t.get('user', '')}")
        lines.append(f"봇: {t.get('bot', '')}")
    lines.append("[이전 대화 기록 끝]\n")
    return "\n".join(lines) + "\n"


TOOL_ICONS = {
    "Read": "📄", "Edit": "✏️", "Write": "📝", "Bash": "⚙️",
    "Grep": "🔍", "Glob": "🔍", "TodoWrite": "✅", "WebFetch": "🌐",
    "WebSearch": "🔎", "Task": "🤖", "Workflow": "🧩",
    "NotebookEdit": "📓", "SendMessage": "✉️",
}


def _summarise_tool(name: str, input_: dict) -> str:
    """One-line label for a tool call, tuned for glance-readability."""
    icon = TOOL_ICONS.get(name, "🔧")
    if name in ("Read", "Edit", "Write", "NotebookEdit"):
        path = input_.get("file_path") or input_.get("notebook_path") or ""
        # Relative-to-project for readability
        try:
            rel = os.path.relpath(path, PROJECT_DIR) if path else ""
        except ValueError:
            rel = path
        return f"{icon} {name} `{rel or '?'}`"
    if name == "Bash":
        cmd = (input_.get("command") or "").strip().splitlines()[0][:80]
        return f"{icon} Bash `{cmd}`"
    if name in ("Grep", "Glob"):
        pat = input_.get("pattern") or ""
        return f"{icon} {name} `{pat[:60]}`"
    if name == "WebFetch":
        url = input_.get("url") or ""
        return f"{icon} WebFetch `{url[:60]}`"
    if name == "WebSearch":
        q = input_.get("query") or ""
        return f"{icon} WebSearch `{q[:60]}`"
    if name == "TodoWrite":
        todos = input_.get("todos") or []
        active = next((t.get("activeForm", "") for t in todos if t.get("status") == "in_progress"), "")
        return f"{icon} Todo: {active[:60]}" if active else f"{icon} Todo update"
    if name == "Task":
        return f"{icon} 서브에이전트 실행"
    # Fallback: show tool name only
    return f"{icon} {name}"


class ProgressTracker:
    """Accumulates timeline of events and produces Discord-ready status text."""

    def __init__(self):
        self.steps: list[str] = []          # tool-call labels, in order
        self.latest_text: str = ""          # last assistant text block
        self.final_text: str = ""           # result event
        self.done: bool = False
        self.session_id: str | None = None  # captured from stream for resume

    def add_tool_use(self, name: str, input_: dict):
        self.steps.append(_summarise_tool(name, input_))

    def set_text(self, text: str):
        # Assistant emitted a text block; keep the latest snippet visible.
        # Long thinking → we take the tail for freshness.
        self.latest_text = text.strip()

    def set_final(self, text: str):
        self.final_text = text.strip()
        self.done = True

    def render(self, clamp: bool = True) -> str:
        """`clamp` keeps in-flight progress edits to one message; the final
        render passes clamp=False and is split across messages instead."""
        header = "✅ 완료" if self.done else "🤔 작업 중"
        lines = [f"**{header}**"]
        if self.steps:
            recent = self.steps[-MAX_STEPS_SHOWN:]
            if len(self.steps) > MAX_STEPS_SHOWN:
                lines.append(f"…(앞선 {len(self.steps) - MAX_STEPS_SHOWN}단계 생략)")
            lines.extend(recent)
        body = self.final_text or self.latest_text
        if body:
            lines.append("")
            lines.append(body)
        text = "\n".join(lines)
        if clamp and len(text) > DISCORD_MSG_LIMIT:
            keep = DISCORD_MSG_LIMIT - 40
            text = text[:keep] + "\n\n…(잘림)"
        return text


async def run_claude_streaming(
    user_message: str, on_update, resume_id: str | None = None,
) -> tuple[int, ProgressTracker]:
    """Spawn `claude -p --output-format stream-json` and stream events.

    Passes the bot rules via `--append-system-prompt`. If `resume_id` is
    provided, continues that Claude session with `-r`; otherwise a fresh
    session is created and its id is captured on `tracker.session_id`.

    `on_update(tracker)` is called after each event; the callback throttles
    Discord edits itself.
    """
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    for k in ("SUDO_ASKPASS", "SUDO_PROMPT"):
        env.pop(k, None)

    args = [
        CLAUDE_BIN,
        "-p", user_message,
        "--append-system-prompt", BOT_SYSTEM_PROMPT,
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", "bypassPermissions",
    ]
    if CLAUDE_MODEL:
        args.extend(["--model", CLAUDE_MODEL])
    if resume_id:
        args.extend(["-r", resume_id])

    log.info("Spawning claude subprocess (cwd=%s, resume=%s)", PROJECT_DIR, resume_id or "no")
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(PROJECT_DIR),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        limit=STREAM_LIMIT_BYTES,
    )

    tracker = ProgressTracker()

    # Drain stderr concurrently: with --verbose claude can write enough to
    # fill the 64KB pipe buffer, which would block it (and hang proc.wait())
    # if nobody reads until after stdout closes.
    stderr_buf = bytearray()

    async def drain_stderr():
        assert proc.stderr is not None
        while True:
            chunk = await proc.stderr.read(65536)
            if not chunk:
                return
            if len(stderr_buf) < 1_000_000:
                stderr_buf.extend(chunk)

    stderr_task = asyncio.create_task(drain_stderr())

    async def read_stream():
        assert proc.stdout is not None
        while True:
            try:
                raw = await proc.stdout.readline()
            except ValueError:
                # One event line overflowed even STREAM_LIMIT_BYTES. The
                # stream can't be resynced mid-line, so stop reading but
                # let the run finish instead of crashing the handler.
                log.exception("stream-json line exceeded %d bytes", STREAM_LIMIT_BYTES)
                tracker.set_final(
                    "⚠️ 응답 데이터가 너무 커서 출력 일부가 유실됐습니다. "
                    "작업 자체는 계속 진행됐을 수 있으니, 결과를 물어보는 메시지를 한 번 더 보내주세요."
                )
                return
            if not raw:
                return
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            _handle_event(event, tracker)
            try:
                await on_update(tracker)
            except Exception:
                log.exception("on_update raised")

    try:
        await asyncio.wait_for(read_stream(), timeout=CLAUDE_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        stderr_task.cancel()
        tracker.set_final(f"⏱️ 시간 초과 ({CLAUDE_TIMEOUT_SEC}s)")
        return (-1, tracker)
    except Exception:
        # Never leave an orphaned claude process behind on an unexpected error.
        proc.kill()
        await proc.wait()
        stderr_task.cancel()
        raise

    rc = await proc.wait()
    try:
        await asyncio.wait_for(stderr_task, timeout=5)
    except Exception:
        stderr_task.cancel()
    if rc != 0:
        err = stderr_buf.decode(errors="replace").strip()
        if err:
            log.warning("claude exited rc=%s: %s", rc, err[:500])
            if not tracker.final_text and not tracker.latest_text:
                # Without this, a run that died before producing any text
                # (e.g. API overload) rendered as a bare "작업 중" forever.
                tracker.set_final(f"오류 출력: `{err[-300:]}`")
    return (rc, tracker)


def _handle_event(event: dict[str, Any], tracker: ProgressTracker):
    et = event.get("type")
    # Capture session id from the init event (or any event that has one).
    sid = event.get("session_id")
    if sid and not tracker.session_id:
        tracker.session_id = sid
    if et == "assistant":
        content = (event.get("message") or {}).get("content") or []
        for block in content:
            bt = block.get("type")
            if bt == "tool_use":
                tracker.add_tool_use(block.get("name", "?"), block.get("input") or {})
            elif bt == "text":
                text = block.get("text") or ""
                if text.strip():
                    tracker.set_text(text)
    elif et == "result":
        # Terminal event — carries the final assistant text as "result".
        result = event.get("result") or ""
        if result:
            tracker.set_final(result)
        else:
            tracker.done = True


def _split_for_discord(text: str, limit: int = DISCORD_MSG_LIMIT) -> list[str]:
    """Split into <=limit chunks, preferring paragraph then line then word
    boundaries so a chunk never breaks mid-token when avoidable."""
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        # Try double newline (paragraph), then single newline, then space.
        for sep, min_pos in (("\n\n", limit // 3), ("\n", limit // 3), (" ", limit // 2)):
            pos = remaining.rfind(sep, 0, limit)
            if pos >= min_pos:
                chunks.append(remaining[:pos].rstrip())
                remaining = remaining[pos + len(sep):].lstrip()
                break
        else:
            # No decent boundary — hard cut at the limit.
            chunks.append(remaining[:limit])
            remaining = remaining[limit:]
    if remaining:
        chunks.append(remaining)
    return chunks


intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True
bot = discord.Client(intents=intents)


def _is_allowed(message: discord.Message) -> bool:
    is_dm = isinstance(message.channel, discord.DMChannel)
    is_configured_channel = (
        COOP_CHANNEL_ID is not None
        and getattr(message.channel, "id", None) == COOP_CHANNEL_ID
    )
    if is_dm:
        return message.author.id in ALLOWED_USER_IDS
    if is_configured_channel:
        return not ALLOWED_USER_IDS or message.author.id in ALLOWED_USER_IDS
    return False


@bot.event
async def on_ready():
    log.info("Logged in as %s (id=%s)", bot.user, bot.user.id if bot.user else "?")
    log.info(
        "Auth: channel=%s whitelist=%s",
        COOP_CHANNEL_ID if COOP_CHANNEL_ID else "(none)",
        sorted(ALLOWED_USER_IDS) or "(open — any user in channel)",
    )


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if not _is_allowed(message):
        return
    if not message.content.strip():
        return

    log.info("Request from %s: %s", message.author.name, message.content[:200])

    # Role & channel key for session lookup. DMs get a per-user session key,
    # guild channels get a per-channel key.
    is_dm = isinstance(message.channel, discord.DMChannel)
    session_key = f"dm-{message.author.id}" if is_dm else str(message.channel.id)

    if message.content.strip().lower() in RESET_COMMANDS:
        await clear_session(session_key)
        await message.reply("🧹 세션을 초기화했습니다. 다음 요청부터 새 대화로 시작합니다.")
        return

    sender_role = "오너" if message.author.name == "rb_elyss" else "부운영자"
    raw_msg = message.content
    user_msg = build_user_message(
        sender_name=message.author.display_name or message.author.name,
        sender_id=message.author.id,
        sender_role=sender_role,
        raw_msg=raw_msg,
    )
    resume_id = await get_resume_id(session_key)
    if not resume_id:
        # Fresh session — inject the rolling history log so context survives
        # even when the underlying Claude session is gone.
        preamble = await build_history_preamble(session_key)
        if preamble:
            user_msg = preamble + user_msg

    prefix = "🔄 이어가는 중" if resume_id else "🆕 새 세션"
    status_msg = await message.reply(f"🤔 작업 시작... ({prefix}, 최대 {CLAUDE_TIMEOUT_SEC // 60}분)")

    # Debounce edits so we don't hit Discord's rate limit even if events arrive
    # rapidly (a batch of tool calls can fire back-to-back).
    last_edit = 0.0
    last_rendered = ""
    edit_lock = asyncio.Lock()

    async def on_update(tracker: ProgressTracker):
        nonlocal last_edit, last_rendered
        now = time.monotonic()
        if not tracker.done and now - last_edit < EDIT_MIN_INTERVAL_SEC:
            return
        rendered = tracker.render()
        if rendered == last_rendered:
            return
        async with edit_lock:
            try:
                await status_msg.edit(content=rendered)
                last_edit = time.monotonic()
                last_rendered = rendered
            except discord.HTTPException as e:
                log.warning("Discord edit failed: %s", e)

    try:
        rc, tracker = await run_claude_streaming(user_msg, on_update, resume_id=resume_id)
        if resume_id and rc != 0 and not tracker.steps and not tracker.final_text:
            # `-r` with a stale/deleted session id fails before doing any
            # work. Fall back to a fresh session with the history log.
            log.warning("Resume of %s failed; retrying with a fresh session", resume_id)
            await clear_session(session_key)
            preamble = await build_history_preamble(session_key)
            user_msg = preamble + build_user_message(
                sender_name=message.author.display_name or message.author.name,
                sender_id=message.author.id,
                sender_role=sender_role,
                raw_msg=raw_msg,
            )
            rc, tracker = await run_claude_streaming(user_msg, on_update, resume_id=None)
    except Exception as e:
        log.exception("Bot error")
        try:
            await status_msg.edit(content=f"❌ 봇 내부 오류: `{type(e).__name__}: {e}`")
        except discord.HTTPException:
            pass
        return

    # Force final render (bypasses throttle so completion always shows).
    tracker.done = True
    final = tracker.render(clamp=False)
    if rc != 0 and "실패" not in final and "❌" not in final:
        final = f"❌ 실패 (exit {rc})\n\n{final}"

    # Long final response → split into multiple Discord messages instead of
    # truncating. First chunk edits the status message so the reply-arrow
    # stays anchored; the rest follow as fresh messages in the channel.
    chunks = _split_for_discord(final)
    try:
        await status_msg.edit(content=chunks[0])
    except discord.HTTPException as e:
        log.warning("Final edit failed: %s", e)
    for chunk in chunks[1:]:
        try:
            await message.channel.send(chunk)
        except discord.HTTPException as e:
            log.warning("Follow-up send failed: %s", e)
            break
    # Persist session + rolling history for next turn in this channel/DM.
    if tracker.session_id:
        try:
            await save_session(session_key, tracker.session_id)
        except Exception:
            log.exception("Failed to persist session")
    try:
        await append_history(session_key, raw_msg, tracker.final_text or tracker.latest_text)
    except Exception:
        log.exception("Failed to append history")
    log.info(
        "Completed request from %s (rc=%s, %d chunk%s, session=%s)",
        message.author.name, rc, len(chunks), "s" if len(chunks) > 1 else "",
        tracker.session_id[:8] if tracker.session_id else "?",
    )


if __name__ == "__main__":
    bot.run(DISCORD_TOKEN, log_handler=None)
