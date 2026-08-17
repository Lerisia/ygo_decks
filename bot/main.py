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
from datetime import date
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

DISCORD_MSG_LIMIT = 2000
# Edit at most this often. Discord rate-limits ~5 edits per 5s per channel;
# 1.5s keeps us safely under with headroom for other bots.
EDIT_MIN_INTERVAL_SEC = 1.5
MAX_STEPS_SHOWN = 12  # tail of the tool-call timeline to display

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("coop-bot")


SYSTEM_PROMPT_TEMPLATE = """당신은 YGO Decks 사이트 팀의 Discord 봇으로, 팀원의 요청을 받아 코드 편집·테스트·commit·배포까지 자율 수행합니다.

프로젝트: YGO Decks (한국 유희왕 마스터 듀얼 덱 추천/전적 사이트)
작업 디렉토리: {project_dir}

## 팀 구성
- **오너 (사장님)**: Discord 유저 `rb_elyss` — 한국어 이름 **엘리스**. 이 사람이 이 프로젝트의 주인.
- **부운영자**: 그 외 화이트리스트된 유저들. 신뢰받은 협업자이지만 오너는 아님.

## 이번 요청
- 요청자: **{sender_name}** (Discord ID {sender_id}) — {sender_role}
- 원문 메시지는 맨 아래에 있음.

요청자가 오너이면 "엘리스님"으로, 부운영자이면 "OO님"으로 자연스럽게 호칭해도 됨.

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
- Discord 답변은 **한국어**, 2000자 이내.
- 완료 시: 무엇을 했는지 1~3줄 + commit hash + 배포 결과.
- 실패 시: 어느 단계에서 실패했는지 명확히.

## 부운영자 요청
{message}
"""


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

    def add_tool_use(self, name: str, input_: dict):
        self.steps.append(_summarise_tool(name, input_))

    def set_text(self, text: str):
        # Assistant emitted a text block; keep the latest snippet visible.
        # Long thinking → we take the tail for freshness.
        self.latest_text = text.strip()

    def set_final(self, text: str):
        self.final_text = text.strip()
        self.done = True

    def render(self) -> str:
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
        if len(text) > DISCORD_MSG_LIMIT:
            keep = DISCORD_MSG_LIMIT - 40
            text = text[:keep] + "\n\n…(잘림)"
        return text


async def run_claude_streaming(user_message: str, on_update) -> tuple[int, ProgressTracker]:
    """Spawn `claude -p --output-format stream-json` and stream events.

    `on_update(tracker)` is called after each event; the callback is expected
    to throttle Discord edits itself.
    """
    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        project_dir=PROJECT_DIR,
        message=user_message,
        today=date.today().isoformat(),
    )

    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    for k in ("SUDO_ASKPASS", "SUDO_PROMPT"):
        env.pop(k, None)

    log.info("Spawning claude subprocess (cwd=%s)", PROJECT_DIR)
    proc = await asyncio.create_subprocess_exec(
        CLAUDE_BIN,
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", "bypassPermissions",
        cwd=str(PROJECT_DIR),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    tracker = ProgressTracker()

    async def read_stream():
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
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
        tracker.set_final(f"⏱️ 시간 초과 ({CLAUDE_TIMEOUT_SEC}s)")
        return (-1, tracker)

    rc = await proc.wait()
    return (rc, tracker)


def _handle_event(event: dict[str, Any], tracker: ProgressTracker):
    et = event.get("type")
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


def _truncate(text: str, limit: int = DISCORD_MSG_LIMIT) -> str:
    """Used for in-flight progress edits where extending across messages
    would spam. Final output uses `_split_for_discord` instead."""
    if len(text) <= limit:
        return text
    return text[: limit - 40] + "\n\n…(잘림)"


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
    status_msg = await message.reply(f"🤔 작업 시작... (최대 {CLAUDE_TIMEOUT_SEC // 60}분)")

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
        rc, tracker = await run_claude_streaming(message.content, on_update)
    except Exception as e:
        log.exception("Bot error")
        try:
            await status_msg.edit(content=f"❌ 봇 내부 오류: `{type(e).__name__}: {e}`")
        except discord.HTTPException:
            pass
        return

    # Force final render (bypasses throttle so completion always shows).
    tracker.done = True
    final = tracker.render()
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
    log.info(
        "Completed request from %s (rc=%s, %d chunk%s)",
        message.author.name, rc, len(chunks), "s" if len(chunks) > 1 else "",
    )


if __name__ == "__main__":
    bot.run(DISCORD_TOKEN, log_handler=None)
