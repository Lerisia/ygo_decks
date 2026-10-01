import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import data from "@/data/lolSkills.json";
import { buildNameIndex, judgeName, type NameEntry } from "@/utils/nameGame";

const TURN_MS = 20_000;
const GOAL = 100;
const BEST_KEY = "skill_names_best";

type Phase = "ready" | "playing" | "over";
type EndReason = "time" | "left";
type Note = { tone: "ok" | "warn" | "bad"; text: string } | null;
type LastTry = { text: string; kind: "wrong" | "repeat" } | null;

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

  const inputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef<Phase>("ready");
  const usedRef = useRef(new Set<string>());
  const deadlineRef = useRef(0);
  const bestRef = useRef(best);
  const composingRef = useRef(false);

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
    deadlineRef.current = performance.now() + TURN_MS;
    phaseRef.current = "playing";
    // The input has to exist before this click handler returns, or a phone will not open its keyboard.
    flushSync(() => {
      setAnswered([]);
      setLeft(TURN_MS);
      setNote(null);
      setLastTry(null);
      setNewBest(false);
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
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 text-sm md:text-base">
        나는 롤 스킬을 {GOAL}가지 이상 알고 있다
      </p>

      {phase === "ready" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
          <ul className="list-disc pl-5 space-y-1.5 text-sm md:text-base">
            <li>{TURN_MS / 1000}초 안에 리그 오브 레전드 스킬 이름을 하나 입력합니다. 기본 지속 효과(패시브)도 됩니다.</li>
            <li>맞히면 시간이 다시 {TURN_MS / 1000}초가 됩니다.</li>
            <li>틀리면 고치거나 지우고 다시 입력할 수 있지만, 시간은 계속 흐릅니다.</li>
            <li>띄어쓰기와 특수문자는 틀려도 됩니다.</li>
            <li>다른 창이나 탭으로 나가면 그 판은 끝납니다. 붙여넣기는 되지 않습니다.</li>
          </ul>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">내 최고 기록: {best}개</p>
          <button
            onClick={start}
            className="mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
          >
            시작
          </button>
        </div>
      )}

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
          <AnsweredList answered={answered} />
        </div>
      )}

      <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
        스킬 이름: 리그 오브 레전드 {data.version} 한국어판
      </p>
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
