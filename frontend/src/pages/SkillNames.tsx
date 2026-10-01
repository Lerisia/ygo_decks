import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/Avatar";
import {
  fetchLeaderboard, hasLogin, LoginExpired, startGame, submitGame,
  type Answer, type Leaderboard, type SubmitResult,
} from "@/api/skillNamesApi";
import data from "@/data/lolSkills.json";
import { buildNameIndex, judgeName, type NameEntry } from "@/utils/nameGame";

const TURN_MS = 20_000;
const GOAL = 100;
const BEST_KEY = "skill_names_best";
const NICK_KEY = "skill_names_nickname";
const NICK_MAX = 12;

type Phase = "ready" | "playing" | "over";
type EndReason = "time" | "left";
type Note = { tone: "ok" | "warn" | "bad"; text: string } | null;
type LastTry = { text: string; kind: "wrong" | "repeat" } | null;
type Saving =
  | { status: "idle" | "saving" }
  | { status: "done"; result: SubmitResult }
  | { status: "error"; message: string };

const NOTE_COLOR = {
  ok: "text-green-600 dark:text-green-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

function ownersLabel(e: NameEntry) {
  return e.owners.map((o) => `${o.c} ${o.k === "P" ? "패시브" : o.k}`).join(" · ");
}

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function readNickname() {
  try {
    return localStorage.getItem(NICK_KEY) || "";
  } catch {
    return "";
  }
}

function SkillNames() {
  const navigate = useNavigate();
  const index = useMemo(() => buildNameIndex(data.skills), []);
  const [phase, setPhase] = useState<Phase>("ready");
  const [answered, setAnswered] = useState<NameEntry[]>([]);
  const [left, setLeft] = useState(TURN_MS);
  const [note, setNote] = useState<Note>(null);
  const [endReason, setEndReason] = useState<EndReason>("time");
  const [lastTry, setLastTry] = useState<LastTry>(null);
  const [best, setBest] = useState(readBest);
  const [newBest, setNewBest] = useState(false);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [member, setMember] = useState(hasLogin);
  const [nickname, setNickname] = useState(readNickname);
  const [saving, setSaving] = useState<Saving>({ status: "idle" });

  const inputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef<Phase>("ready");
  const usedRef = useRef(new Set<string>());
  const deadlineRef = useRef(0);
  const bestRef = useRef(best);
  const composingRef = useRef(false);
  const startAtRef = useRef(0);
  const logRef = useRef<Answer[]>([]);
  const tokenRef = useRef<Promise<string | null>>(Promise.resolve(null));

  const loadBoard = useCallback(() => {
    fetchLeaderboard()
      .then(setBoard)
      .catch(() => setBoard((b) => b ?? { leaderboard: [], players: 0, my_best: null }));
  }, []);
  useEffect(loadBoard, [loadBoard]);

  /** Sends the finished game to the ranking: under the account, or under `nick` for a guest. */
  const save = useCallback(
    async (nick: string | null) => {
      setSaving({ status: "saving" });
      try {
        const token = await tokenRef.current;
        if (!token) throw new Error("서버에 연결하지 못해 이번 판은 랭킹에 남길 수 없습니다.");
        const result = await submitGame(token, logRef.current, nick);
        setSaving({ status: "done", result });
        loadBoard();
      } catch (e) {
        if (e instanceof LoginExpired) {
          setMember(false);
          setSaving({ status: "idle" });
        } else setSaving({ status: "error", message: e instanceof Error ? e.message : "기록하지 못했습니다." });
      }
    },
    [loadBoard],
  );

  const end = useCallback((reason: EndReason, last: LastTry = null) => {
    if (phaseRef.current !== "playing") return;
    phaseRef.current = "over";
    const count = usedRef.current.size;
    const record = count > bestRef.current;
    if (record) {
      bestRef.current = count;
      try {
        localStorage.setItem(BEST_KEY, String(count));
      } catch {
        /* private mode: the record just is not kept */
      }
      setBest(count);
    }
    setNewBest(record);
    setEndReason(reason);
    setLastTry(last);
    setPhase("over");
  }, []);

  const tryInput = useCallback(
    (timeUp: boolean) => {
      if (phaseRef.current !== "playing") return;
      const el = inputRef.current;
      const text = el?.value ?? "";
      const r = judgeName(index, usedRef.current, text);
      if (r.kind === "correct") {
        usedRef.current.add(r.key);
        logRef.current.push({ name: r.entry.name, ms: Math.round(performance.now() - startAtRef.current) });
        deadlineRef.current = performance.now() + TURN_MS;
        if (el) el.value = "";
        setAnswered((a) => [r.entry, ...a]);
        setLeft(TURN_MS);
        setNote({ tone: "ok", text: `${r.entry.name} — ${ownersLabel(r.entry)}` });
        return;
      }
      if (timeUp) {
        end("time", r.kind === "empty" ? null : { text: text.trim(), kind: r.kind });
        return;
      }
      if (r.kind === "repeat") setNote({ tone: "warn", text: "이미 말한 스킬입니다." });
      else if (r.kind === "wrong") setNote({ tone: "bad", text: "그런 스킬은 없습니다." });
    },
    [index, end],
  );

  useEffect(() => {
    if (phase !== "playing") return;
    const tick = window.setInterval(() => {
      const ms = deadlineRef.current - performance.now();
      if (ms <= 0) tryInput(true);
      else setLeft(ms);
    }, 100);
    // Looking a name up means leaving this window, so leaving it ends the game.
    const onBlur = () => end("left");
    const onHide = () => {
      if (document.visibilityState === "hidden") end("left");
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [phase, tryInput, end]);

  const start = () => {
    usedRef.current = new Set();
    logRef.current = [];
    startAtRef.current = performance.now();
    tokenRef.current = startGame().catch(() => null);
    deadlineRef.current = startAtRef.current + TURN_MS;
    phaseRef.current = "playing";
    // The input has to exist before this click handler returns, or a phone will not open its keyboard.
    flushSync(() => {
      setAnswered([]);
      setLeft(TURN_MS);
      setNote(null);
      setLastTry(null);
      setNewBest(false);
      setSaving({ status: "idle" });
      setPhase("playing");
    });
    inputRef.current?.focus();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const judge = () => {
      tryInput(false);
      inputRef.current?.focus();
    };
    // Enter can arrive while a Hangul syllable is still being composed; judge once it has been committed.
    if (composingRef.current) window.setTimeout(judge, 0);
    else judge();
  };

  // A member's game goes to the ranking by itself; a guest is asked for a nickname first.
  useEffect(() => {
    if (phase === "over" && member && logRef.current.length > 0) save(null);
  }, [phase, member, save]);

  const saveAsGuest = (e: React.FormEvent) => {
    e.preventDefault();
    const nick = nickname.trim().replace(/\s+/g, " ");
    if (!nick) return;
    try {
      localStorage.setItem(NICK_KEY, nick);
    } catch {
      /* private mode: the nickname is just not remembered */
    }
    save(nick);
  };

  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = "";
    setNote(null);
    inputRef.current?.focus();
  };

  const count = answered.length;
  const seconds = Math.max(0, left) / 1000;
  const urgent = left <= 5000;

  return (
    <div className="min-h-screen px-4 py-6 md:py-10 max-w-lg mx-auto">
      <button
        onClick={() => navigate("/solo")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← 솔로 플레이
      </button>
      <h1 className="text-2xl md:text-3xl font-bold text-center mb-1">
        스킬 이름 대기 <span className="text-amber-600 dark:text-amber-400">(베타)</span>
      </h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-4 text-sm md:text-base">
        나는 롤 스킬을 {GOAL}가지 이상 알고 있다
      </p>

      <PortraitMarquee />

      {phase === "ready" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
          <ul className="list-disc pl-5 space-y-1.5 text-sm md:text-base">
            <li>{TURN_MS / 1000}초 안에 리그 오브 레전드 스킬 이름을 하나 입력합니다. 기본 지속 효과(패시브)도 됩니다.</li>
            <li>맞히면 시간이 다시 {TURN_MS / 1000}초가 됩니다.</li>
            <li>틀리면 고치거나 지우고 다시 입력할 수 있지만, 시간은 계속 흐릅니다.</li>
            <li>띄어쓰기와 특수문자는 틀려도 됩니다.</li>
            <li>다른 창이나 탭으로 나가면 그 판은 끝납니다. 붙여넣기는 되지 않습니다.</li>
            <li>끝나면 랭킹에 기록을 남길 수 있습니다. 가입하지 않아도 닉네임만 쓰면 됩니다.</li>
          </ul>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            원래 유희왕 카드로 하려 했는데, 일단 롤대남들 데리고 테스트하느라 롤이 되어버림.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">내 최고 기록: {best}개</p>
          <button
            onClick={start}
            className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
          >
            시작
          </button>
        </div>
      )}
      {phase === "ready" && <RankingBoard board={board} />}

      {phase === "playing" && (
        <div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="text-3xl font-bold tabular-nums">{count}</span>
              <span className="ml-1 text-gray-500 dark:text-gray-400">개</span>
            </div>
            <div className={`text-2xl font-bold tabular-nums ${urgent ? "text-red-600 dark:text-red-400" : ""}`}>
              {seconds.toFixed(1)}
              <span className="ml-0.5 text-base font-normal text-gray-500 dark:text-gray-400">초</span>
            </div>
          </div>
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-4">
            <div
              className={`h-full ${urgent ? "bg-red-500" : "bg-blue-600"}`}
              style={{ width: `${Math.max(0, Math.min(100, (left / TURN_MS) * 100))}%` }}
            />
          </div>

          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              lang="ko"
              aria-label="스킬 이름"
              placeholder="스킬 이름"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-base bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearInput}
              className="shrink-0 px-3 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold transition"
            >
              지우기
            </button>
            <button
              type="submit"
              onMouseDown={(e) => e.preventDefault()}
              className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
            >
              입력
            </button>
          </form>
          <p className={`mt-2 h-6 text-sm truncate ${note ? NOTE_COLOR[note.tone] : ""}`} aria-live="polite">
            {note?.text}
          </p>

          <AnsweredList answered={answered} />
        </div>
      )}

      {phase === "over" && (
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {endReason === "left" ? "다른 창으로 나가서 끝났습니다." : "시간이 다 됐습니다."}
            </p>
            <p className="mt-2">
              <span className="text-5xl font-bold tabular-nums">{count}</span>
              <span className="ml-1 text-lg text-gray-500 dark:text-gray-400">개</span>
            </p>
            {count >= GOAL && (
              <p className="mt-2 font-semibold text-green-600 dark:text-green-400">
                나는 롤 스킬을 {GOAL}가지 이상 알고 있다 ✓
              </p>
            )}
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {newBest ? "새 최고 기록입니다." : `내 최고 기록: ${best}개`} · 전체 {index.size}개
            </p>
            {lastTry && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 break-words">
                마지막 입력 “{lastTry.text}” — {lastTry.kind === "repeat" ? "이미 말한 스킬" : "없는 스킬"}
              </p>
            )}
            {count > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-sm">
                {saving.status === "done" ? (
                  <p className="font-semibold text-blue-600 dark:text-blue-400">
                    랭킹 {saving.result.rank}위 · {saving.result.players}명 중
                    {saving.result.best > saving.result.count && ` (최고 기록 ${saving.result.best}개 기준)`}
                  </p>
                ) : saving.status === "saving" ? (
                  <p className="text-gray-500 dark:text-gray-400">랭킹에 기록하는 중…</p>
                ) : member ? (
                  saving.status === "error" && <p className="text-red-600 dark:text-red-400">{saving.message}</p>
                ) : (
                  <form onSubmit={saveAsGuest}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        maxLength={NICK_MAX}
                        aria-label="닉네임"
                        placeholder="닉네임"
                        autoComplete="off"
                        className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-base bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={!nickname.trim()}
                        className={`shrink-0 px-4 py-2 rounded-lg font-semibold transition ${
                          nickname.trim()
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                        }`}
                      >
                        기록 남기기
                      </button>
                    </div>
                    <p className={`mt-2 ${saving.status === "error" ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
                      {saving.status === "error" ? saving.message : "가입하지 않아도 닉네임만 쓰면 랭킹에 남습니다."}
                    </p>
                  </form>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => navigate("/solo")}
                className="flex-1 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold transition"
              >
                나가기
              </button>
              <button
                onClick={start}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
              >
                다시 하기
              </button>
            </div>
          </div>
          <RankingBoard board={board} />
          <AnsweredList answered={answered} />
        </div>
      )}

      <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
        스킬 이름: 리그 오브 레전드 {data.version} 한국어판
      </p>
    </div>
  );
}

const PORTRAIT_ROWS = [
  { n: 58, seconds: 100, reverse: false },
  { n: 58, seconds: 125, reverse: true },
  { n: 57, seconds: 110, reverse: false },
];
const EDGE_FADE = "linear-gradient(to right, transparent, black 6%, black 94%, transparent)";

/** Champion portraits drifting past in three rows, the middle one the other way. */
function PortraitMarquee() {
  return (
    <div
      aria-hidden
      className="mb-5 space-y-1 md:space-y-1.5 [--h:32px] md:[--h:44px]"
      style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
    >
      {PORTRAIT_ROWS.map((r, i) => (
        <div key={i} className="portrait-row">
          <div
            className={`portrait-strip${r.reverse ? " reverse" : ""}`}
            style={
              {
                "--n": r.n,
                "--dur": `${r.seconds}s`,
                backgroundImage: `url(/images/lol/champions-${i + 1}.webp)`,
              } as React.CSSProperties
            }
          />
        </div>
      ))}
    </div>
  );
}

const BOARD_SKELETON_ROWS = 5;

/** Every player's best game. Members show their avatar; guests are marked as such. */
function RankingBoard({ board }: { board: Leaderboard | null }) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-lg font-semibold">랭킹</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 h-4">
          {board && board.players > 0 && `${board.players}명 참여`}
          {board?.my_best != null && ` · 내 최고 ${board.my_best}개`}
        </span>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        {board === null &&
          Array.from({ length: BOARD_SKELETON_ROWS }, (_, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 h-12 ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse ml-8" />
              <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </div>
          ))}
        {board?.leaderboard.length === 0 && (
          <p className="px-4 h-12 flex items-center text-sm text-gray-500 dark:text-gray-400">아직 기록이 없습니다.</p>
        )}
        {board?.leaderboard.map((r, i) => (
          <div
            key={i}
            className={`flex items-center justify-between gap-3 px-4 h-12 ${
              i === 0 ? "bg-yellow-50 dark:bg-yellow-900/20 font-bold" : ""
            } ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 text-center shrink-0 tabular-nums">{i === 0 ? "👑" : `${i + 1}.`}</span>
              {r.guest ? (
                <span className="w-8 h-8 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
              ) : (
                <Avatar icon={r.avatar_icon} border={r.border} size={32} />
              )}
              <span className="truncate">{r.name}</span>
              {r.guest && (
                <span className="shrink-0 text-[10px] font-normal px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  비회원
                </span>
              )}
            </div>
            <span className="font-semibold shrink-0 tabular-nums">{r.count}개</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnsweredList({ answered }: { answered: NameEntry[] }) {
  if (answered.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-700 text-sm">
      {answered.map((e, i) => (
        <li key={e.name} className="py-1.5 flex items-baseline gap-2">
          <span className="w-8 shrink-0 text-right tabular-nums text-gray-400">{answered.length - i}</span>
          <span className="font-medium">{e.name}</span>
          <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{ownersLabel(e)}</span>
        </li>
      ))}
    </ul>
  );
}

export default SkillNames;
