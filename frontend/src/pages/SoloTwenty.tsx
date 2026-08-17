import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CardSearchModal from "@/components/CardSearchModal";
import {
  fetchMenu,
  fetchCurrentGame,
  startGame,
  askQuestion,
  guessCard,
  giveUp,
  fetchHintDims,
  useHint,
  type TwGame,
  type TwMenuGroup,
  type TwGuessResponse,
  type TwDifficulty,
  type TwHintDim,
} from "@/api/soloTwentyApi";

const DIFFICULTY_DESCRIPTIONS: Record<TwDifficulty, { label: string; cap: number; desc: string }> = {
  "초급": { label: "초급 (권장)", cap: 100, desc: "마스터 듀얼 유저라면 누구나 아는 카드. 하루 최대 100P." },
  "중급": { label: "중급", cap: 150, desc: "유희왕을 오래 해왔다면 알 수 있는 카드. 하루 최대 150P." },
  "고급": { label: "고급", cap: 200, desc: "모든 카드. 매우 어려움. 하루 최대 200P." },
};

/** Solo 딱무고개 — structured yes/no questions vs a hidden card.
 *  20-question budget, daily 100P cap shared with Solo Duchmind. */

type ComparisonRow = { label: string; guess: string | number; match: boolean };
function HistoryRow({ entry }: { entry: TwGame["history"][number] & { comparison?: ComparisonRow[] } }) {
  // Hint entries get their own neutral chip + dedicated layout.
  if (entry.kind === "hint") {
    return (
      <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 text-base">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">
            <span className="text-yellow-700 dark:text-yellow-400 font-semibold mr-1">💡 {entry.hint_label}</span>
            <span className="font-bold">{entry.hint_value}</span>
          </span>
          <span className="shrink-0 px-2.5 py-1 rounded-full text-sm font-semibold bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">힌트</span>
        </div>
      </div>
    );
  }
  const ansClass = entry.answer
    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
  const ansLabel = entry.kind === "guess"
    ? (entry.answer ? "정답!" : "땡!")
    : (entry.answer ? "예" : "아니오");
  const comp = entry.comparison;
  return (
    <div className="px-3 py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-base">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{entry.q_text}</span>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-sm font-semibold ${ansClass}`}>{ansLabel}</span>
      </div>
      {comp && comp.length > 0 && (() => {
        const matches = comp.filter((r) => r.match);
        const misses = comp.filter((r) => !r.match);
        return (
          <div className="mt-1.5 space-y-0.5 text-xs leading-snug">
            {matches.length > 0 && (
              <div className="text-green-700 dark:text-green-300">
                <span className="font-bold mr-1">✓</span>
                {matches.map((r) => `${r.label} ${r.guess}`).join("  ·  ")}
              </div>
            )}
            {misses.length > 0 && (
              <div className="text-red-600 dark:text-red-400">
                <span className="font-bold mr-1">✗</span>
                {misses.map((r) => `${r.label} ${r.guess}`).join("  ·  ")}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default function SoloTwenty() {
  const navigate = useNavigate();
  const [menu, setMenu] = useState<TwMenuGroup[] | null>(null);
  const [game, setGame] = useState<TwGame | null>(null);
  const [dailyCap, setDailyCap] = useState<number>(100);
  const [pointsToday, setPointsToday] = useState<number>(0);
  const [pointsRemaining, setPointsRemaining] = useState<number>(100);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [givingUp, setGivingUp] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  // Drill-down menu: null = root (group list); otherwise group name being
  // viewed. ← 뒤로 returns to null.
  const [drillGroup, setDrillGroup] = useState<string | null>(null);
  // Local state for the freeform ATK/DEF input on number-kind groups.
  const [numberInput, setNumberInput] = useState<string>("");
  // Multi-select picks for "kind=multiselect" groups (속성/종족). Cleared
  // when the player navigates back to root or asks a question.
  const [multiSelections, setMultiSelections] = useState<Set<string>>(new Set());
  // Search-filter text for searchable multiselect groups (아키타입).
  const [multiSearch, setMultiSearch] = useState<string>("");
  const [showScoringInfo, setShowScoringInfo] = useState(false);
  // Exclude Spell/Trap from pool. Persisted in localStorage so the
  // player doesn't have to re-toggle every game. Defaults to ON.
  const EXCLUDE_ST_KEY = "solo-twenty-exclude-st";
  const [excludeST, setExcludeST] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem(EXCLUDE_ST_KEY);
    return v === null ? true : v === "1";
  });
  const toggleExcludeST = (next: boolean) => {
    setExcludeST(next);
    try { localStorage.setItem(EXCLUDE_ST_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };
  // Hint UI: dim list + penalty schedule fetched once on mount; modal
  // open state + busy guard for the pending hint call.
  const [hintDims, setHintDims] = useState<TwHintDim[] | null>(null);
  const [hintPenalties, setHintPenalties] = useState<number[]>([0, 1, 3, 5]);
  const [showHintModal, setShowHintModal] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  // One-shot announcement when ST cards joined the pool (2026-06-01).
  // Dismissed forever once the player closes it.
  const ST_ANNOUNCE_FLAG = "solo-twenty-st-announce-2026-06";
  const [showSTAnnounce, setShowSTAnnounce] = useState(() =>
    typeof window !== "undefined" && !localStorage.getItem(ST_ANNOUNCE_FLAG)
  );
  const dismissSTAnnounce = () => {
    localStorage.setItem(ST_ANNOUNCE_FLAG, "1");
    setShowSTAnnounce(false);
  };
  const historyRef = useRef<HTMLDivElement>(null);

  // Initial load: current game first (so we know its difficulty), then
  // menu scoped to that pool. If no active game, fetch the 중급 menu by
  // default — the menu is re-fetched when the player picks a difficulty.
  useEffect(() => {
    (async () => {
      try {
        const cur = await fetchCurrentGame();
        const diff = cur.game?.difficulty ?? "중급";
        // For an active game, mirror the game's own exclude_st flag so
        // the menu matches what the player chose at game start. For no
        // active game, use the persisted checkbox state.
        const gameExclude = cur.game?.exclude_st ?? excludeST;
        const [m, hd] = await Promise.all([fetchMenu(diff, gameExclude), fetchHintDims()]);
        setMenu(m.menu);
        setHintDims(hd.dims);
        setHintPenalties(hd.penalties);
        setGame(cur.game);
        setDailyCap(cur.daily_points_cap);
        setPointsToday(cur.points_earned_today);
        setPointsRemaining(cur.points_remaining_today);
      } catch (e: any) {
        setErr(String(e.message || e));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseHint = async (dim: string) => {
    if (!game || hintBusy) return;
    setHintBusy(true); setErr("");
    try {
      const g = await useHint(game.id, dim);
      setGame(g);
      setShowHintModal(false);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setHintBusy(false); }
  };

  // Auto-scroll history to bottom on update.
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [game?.history?.length]);

  const handleAsk = async (q_type: string, q_value: string | number) => {
    if (!game || busy) return;
    setBusy(true); setErr("");
    try {
      const g = await askQuestion(game.id, q_type, q_value);
      setGame(g);
      // Return to root after a question lands so the next pick starts fresh.
      setDrillGroup(null);
      setNumberInput("");
      setMultiSelections(new Set());
      setMultiSearch("");
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  const handleGuess = async (cardName: string) => {
    if (!game || busy) return;
    setBusy(true); setErr("");
    try {
      const g: TwGuessResponse = await guessCard(game.id, cardName);
      setGame(g);
      setPointsToday(g.points_earned_today);
      setPointsRemaining(g.points_remaining_today);
      setDailyCap(g.daily_points_cap);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  };

  const handleGiveUp = async () => {
    // 포기 is intentionally allowed mid-request — if the user feels stuck on
    // a slow ask/answer round-trip, they should be able to bail. We only
    // guard against double-submit of giveup itself via `givingUp`.
    if (!game || givingUp) return;
    if (!confirm("정말 포기하시겠어요? 정답이 공개되고 포인트는 받지 않습니다.")) return;
    setGivingUp(true); setErr("");
    try {
      const g = await giveUp(game.id);
      setGame(g);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setGivingUp(false); }
  };

  const isActive = game?.status === "active";
  const isEnded = !!game && game.status !== "active";

  const remaining = game?.questions_remaining ?? 20;
  const total = game?.total_questions ?? 20;
  const used = game?.questions_used ?? 0;

  // Set of (q_type|q_value) the user already asked — disable repeats so the
  // budget can't be wasted on a re-ask.
  const askedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const h of game?.history ?? []) {
      if (h.kind === "ask") s.add(`${h.q_type}|${h.q_value}`);
    }
    return s;
  }, [game?.history]);

  // Once a player confirms a specific frame_type, certain level/rank/link
  // values become impossible — hide them so the budget isn't spent on
  // guaranteed-no questions. Caps reflect what actually exists in the 중급
  // pool (verified at engine load time):
  //   - link    → 6 (link rating cap)
  //   - normal  → 8 (highest normal monster in the pool)
  const LEVEL_CAP_BY_FRAME: Record<string, number> = { link: 6, normal: 8 };
  const levelCap = useMemo(() => {
    for (const h of game?.history ?? []) {
      if (h.kind === "ask" && h.q_type === "frame_type" && h.answer === true) {
        const cap = LEVEL_CAP_BY_FRAME[String(h.q_value)];
        if (cap !== undefined) return cap;
      }
    }
    return 13;  // xyz can hit rank 13 (CiNo.1000 등); default to widest range
  }, [game?.history]);

  // Once the player narrows the target to monster/spell/trap/ST, hide
  // groups + items that are guaranteed-no so the budget isn't wasted.
  // cardKind:
  //   "monster" — is_monster=YES OR is_spell_or_trap=NO
  //   "spell"   — frame_type=spell=YES
  //   "trap"    — frame_type=trap=YES
  //   "st"      — is_monster=NO OR is_spell_or_trap=YES (but not yet refined)
  //   null      — unknown
  type CardKind = "monster" | "spell" | "trap" | "st" | null;
  const cardKind = useMemo<CardKind>(() => {
    let mYes = false, mNo = false, stYes = false, stNo = false;
    for (const h of game?.history ?? []) {
      if (h.kind !== "ask") continue;
      if (h.q_type === "frame_type" && h.q_value === "spell" && h.answer) return "spell";
      if (h.q_type === "frame_type" && h.q_value === "trap" && h.answer) return "trap";
      if (h.q_type === "is_monster") { if (h.answer) mYes = true; else mNo = true; }
      if (h.q_type === "is_spell_or_trap") { if (h.answer) stYes = true; else stNo = true; }
    }
    if (mYes || stNo) return "monster";
    if (mNo || stYes) return "st";
    return null;
  }, [game?.history]);

  // Monster-specific groups and items — hidden when cardKind is spell/trap/st.
  const MONSTER_ONLY_GROUPS = new Set(["속성", "종족", "레벨 / 랭크 / 링크", "공격력", "수비력"]);
  const MONSTER_ONLY_ITEM_KEYS = new Set([
    "tuner|", "extra_deck|", "atk_eq_def|", "has_level|", "tag_hand_trap|",
  ]);
  // ST-specific items in 일반적인 질문 — hidden when cardKind is "monster".
  const ST_ONLY_BRANCH_KEYS = new Set([
    "frame_type|spell", "frame_type|trap", "is_spell_or_trap|",
  ]);
  // For the 유형 group, items are q_type-driven: frame_type (monster
  // sub-types), spell_kind, trap_kind. We filter by q_type per cardKind.
  const isItemHidden = (q_type: string, q_value: string): boolean => {
    const k = `${q_type}|${q_value}`;
    if (cardKind === "monster") {
      if (ST_ONLY_BRANCH_KEYS.has(k)) return true;
      if (q_type === "spell_kind" || q_type === "trap_kind") return true;
      // is_monster YES already → no point re-asking
      if (q_type === "is_monster") return true;
    } else if (cardKind === "spell") {
      if (MONSTER_ONLY_ITEM_KEYS.has(k)) return true;
      if (q_type === "frame_type" && q_value !== "spell" && q_value !== "trap") return true;
      if (q_type === "trap_kind") return true;
      if (q_type === "is_monster" || k === "frame_type|spell" || k === "is_spell_or_trap|" || k === "frame_type|trap") return true;
    } else if (cardKind === "trap") {
      if (MONSTER_ONLY_ITEM_KEYS.has(k)) return true;
      if (q_type === "frame_type" && q_value !== "spell" && q_value !== "trap") return true;
      if (q_type === "spell_kind") return true;
      if (q_type === "is_monster" || k === "frame_type|trap" || k === "is_spell_or_trap|" || k === "frame_type|spell") return true;
    } else if (cardKind === "st") {
      if (MONSTER_ONLY_ITEM_KEYS.has(k)) return true;
      if (q_type === "frame_type" && q_value !== "spell" && q_value !== "trap") return true;
      if (q_type === "is_monster" || k === "is_spell_or_trap|") return true;
    }
    return false;
  };
  const isGroupHidden = (group: string): boolean => {
    if (cardKind === "spell" || cardKind === "trap" || cardKind === "st") {
      if (MONSTER_ONLY_GROUPS.has(group)) return true;
    }
    return false;
  };
  const confirmedGroups = useMemo(() => new Set<string>(), []);

  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 md:py-8 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/solo")}
        className="mb-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >← 솔로 플레이</button>

      <div className="bg-white dark:bg-gray-800 sm:rounded-xl shadow px-3 py-3 sm:p-5">
        <h1 className="text-xl md:text-2xl font-bold text-center mb-1">🧩 솔로 딱무고개</h1>
        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mb-3">
          20개의 질문으로 카드를 맞춰보세요
        </p>

        {/* Status line */}
        <div className="flex justify-between items-center text-sm mb-3 gap-2 flex-wrap">
          {game ? (
            <span className="font-semibold flex items-center gap-2">
              <span>질문 <span className="text-blue-600 dark:text-blue-400">{used}</span> / {total}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{game.difficulty}</span>
            </span>
          ) : (
            <span className="font-semibold text-gray-500">새 게임 준비됨</span>
          )}
          <span className="text-xs text-gray-500 flex items-center gap-1">
            오늘 {pointsToday}/{dailyCap}P
            {pointsRemaining > 0 ? ` (${pointsRemaining}P 남음)` : " (한도 도달)"}
            <button
              type="button"
              onClick={() => setShowScoringInfo(true)}
              aria-label="점수 방식 설명"
              className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 text-[11px] font-bold"
            >?</button>
          </span>
        </div>

        {err && (
          <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
            {err}
          </div>
        )}

        {/* No active game — difficulty picker. Clicking a card starts
            the game immediately. */}
        {!game && (
          <div className="py-2">
            <p className="text-center text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              난이도를 선택하면 게임이 시작됩니다
            </p>
            <div className="space-y-2">
              {(Object.keys(DIFFICULTY_DESCRIPTIONS) as TwDifficulty[]).map((d) => {
                const info = DIFFICULTY_DESCRIPTIONS[d];
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={async () => {
                      setBusy(true); setErr("");
                      try {
                        const g = await startGame(d, excludeST);
                        const m = await fetchMenu(d, excludeST);
                        setMenu(m.menu);
                        setGame(g);
                        setDrillGroup(null);
                        setNumberInput("");
                        setMultiSelections(new Set());
                      } catch (e: any) {
                        setErr(String(e.message || e));
                      } finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-base">{info.label}</span>
                      <span className="text-xs text-gray-500">하루 최대 {info.cap}P</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{info.desc}</p>
                  </button>
                );
              })}
            </div>
            <label className="mt-3 flex items-center gap-2 cursor-pointer text-sm select-none">
              <input
                type="checkbox"
                checked={excludeST}
                onChange={(e) => toggleExcludeST(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-gray-700 dark:text-gray-300">
                마법/함정 제외 <span className="text-xs text-gray-500">(체크 시 몬스터만 출제)</span>
              </span>
            </label>
          </div>
        )}

        {/* History — fixed-height pane so the action area below doesn't
            shift as the user racks up questions. Scrolls inside. */}
        {game && (
          <div
            ref={historyRef}
            className="space-y-1.5 mb-3 h-56 sm:h-64 overflow-y-auto pr-1 rounded-lg bg-gray-50 dark:bg-gray-900/30 p-2 border border-gray-200 dark:border-gray-700"
          >
            {game.history.length > 0 ? (
              game.history.map((h, i) => <HistoryRow key={i} entry={h} />)
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                아래에서 질문을 골라보세요
              </div>
            )}
          </div>
        )}

        {/* Ended — reveal */}
        {isEnded && game.answer && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              {game.answer.image_url && (
                <img
                  src={game.answer.image_url}
                  alt={game.answer.name}
                  className="w-20 h-20 object-contain rounded bg-white border border-gray-200 dark:border-gray-700 shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">정답</p>
                <p className="font-bold text-lg truncate">{game.answer.name}</p>
                {game.status === "won" ? (
                  <p className="text-sm text-green-700 dark:text-green-400 font-semibold">
                    ✓ 정답! {game.points_awarded > 0 ? `+${game.points_awarded}P` : "(포인트 한도 도달)"}
                  </p>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    ✗ 실패
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => { setGame(null); setDrillGroup(null); setNumberInput(""); setMultiSelections(new Set()); }}
              disabled={busy}
              className="mt-3 w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:bg-gray-400"
            >🔄 새 게임 (난이도 선택)</button>
          </div>
        )}

        {/* Active actions */}
        {isActive && menu && (
          <>
            {remaining <= 0 && (
              <div className="mb-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300 font-semibold text-center">
                ⚠️ 질문을 모두 사용했어요. 마지막 정답 시도만 남았습니다!
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <button
                onClick={() => setSearchOpen(true)}
                disabled={busy}
                className={`px-3 py-2 rounded-lg text-white text-sm font-bold disabled:bg-gray-400 ${
                  remaining <= 0
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >{remaining <= 0 ? "🎯 최후의 시도" : "🎯 정답 시도"}</button>
              <button
                onClick={() => setShowHintModal(true)}
                disabled={busy || (game.hints_used ?? 0) >= (game.hints_max ?? 3)}
                className="px-3 py-2 rounded-lg border border-yellow-400 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >💡 힌트 ({(game.hints_max ?? 3) - (game.hints_used ?? 0)}/{game.hints_max ?? 3})</button>
              <button
                onClick={handleGiveUp}
                disabled={givingUp}
                className="px-3 py-2 rounded-lg border border-red-300 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >🏳️ 포기</button>
            </div>

            {remaining <= 0 ? null : drillGroup === null ? (
              <>
                <p className="text-xs text-gray-500 mb-1">질문하기 — 그룹 선택</p>
                <div className="space-y-1.5">
                  {menu.filter((g) => !isGroupHidden(g.group)).map((g) => {
                    const locked = confirmedGroups.has(g.group);
                    return (
                      <button
                        key={g.group}
                        type="button"
                        disabled={locked}
                        onClick={() => { setDrillGroup(g.group); setNumberInput(""); }}
                        className={`w-full px-4 py-3 flex justify-between items-center rounded-lg border text-base font-semibold text-left ${
                          locked
                            ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                            : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
                        }`}
                      >
                        <span>{g.group}{locked && " ✓ (확정)"}</span>
                        <span className="text-base text-gray-500">{locked ? "" : "›"}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (() => {
              const g = menu.find((x) => x.group === drillGroup);
              if (!g) { setDrillGroup(null); return null; }
              const back = (
                <button
                  type="button"
                  onClick={() => { setDrillGroup(null); setMultiSelections(new Set()); setMultiSearch(""); }}
                  className="mb-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >← 뒤로</button>
              );
              if (g.kind === "list") {
                const items = g.items.filter((it: { q_type: string; q_value: string | number }) =>
                  !isItemHidden(it.q_type, String(it.q_value)));
                return (
                  <>
                    {back}
                    <p className="text-sm text-gray-500 mb-2">{g.group}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {items.map((it) => {
                        const k = `${it.q_type}|${it.q_value}`;
                        const already = askedKeys.has(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            disabled={busy || already}
                            onClick={() => handleAsk(it.q_type, it.q_value)}
                            className={`px-3 py-3 rounded-lg text-sm font-semibold border transition text-left break-keep ${
                              already
                                ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            }`}
                          >{it.label}{already && " ✓"}</button>
                        );
                      })}
                    </div>
                  </>
                );
              }
              if (g.kind === "multiselect") {
                // Build canonical q_value (sorted, comma-joined) so askedKeys
                // catches the same combination regardless of click order.
                const sorted = Array.from(multiSelections).sort();
                const askValue = sorted.join(",");
                const askKey = sorted.length > 0 ? `${g.multi_q_type}|${askValue}` : "";
                const askedThis = !!askKey && askedKeys.has(askKey);
                // Filter visible items by search (case-insensitive substring).
                // Always show selected items even if they don't match — user
                // shouldn't lose track of what they picked.
                const q = multiSearch.trim().toLowerCase();
                const visibleItems = g.searchable && q
                  ? g.items.filter((it) => it.label.toLowerCase().includes(q) || multiSelections.has(String(it.q_value)))
                  : g.items;
                return (
                  <>
                    {back}
                    <p className="text-sm text-gray-500 mb-2">{g.group} — 여러 개 선택 가능 (하나라도 맞으면 예)</p>
                    {g.searchable && (
                      <input
                        type="text"
                        value={multiSearch}
                        onChange={(e) => setMultiSearch(e.target.value)}
                        placeholder={`검색 (총 ${g.items.length}개)`}
                        className="w-full px-3 py-2 mb-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    )}
                    <div className={`grid grid-cols-2 gap-2 mb-2 ${g.searchable ? "max-h-72 overflow-y-auto" : ""}`}>
                      {visibleItems.map((it) => {
                        const v = String(it.q_value);
                        const picked = multiSelections.has(v);
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => {
                              setMultiSelections((prev) => {
                                const next = new Set(prev);
                                if (next.has(v)) next.delete(v); else next.add(v);
                                return next;
                              });
                            }}
                            className={`px-3 py-3 rounded-lg text-sm font-semibold border transition text-left break-keep ${
                              picked
                                ? "border-blue-500 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200"
                                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            }`}
                          >{picked ? "✓ " : ""}{it.label}</button>
                        );
                      })}
                      {visibleItems.length === 0 && (
                        <p className="col-span-2 text-sm text-gray-400 text-center py-4">검색 결과 없음</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy || sorted.length === 0 || askedThis}
                      onClick={() => handleAsk(g.multi_q_type, askValue)}
                      className={`w-full px-3 py-3 rounded-lg text-base font-bold border ${
                        sorted.length === 0 || askedThis
                          ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                          : "border-blue-600 bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      {sorted.length === 0
                        ? "선택한 항목 묻기"
                        : askedThis
                          ? `${sorted.length}개 선택 — 이미 물음 ✓`
                          : `${sorted.length}개 선택 — 묻기`}
                    </button>
                  </>
                );
              }
              // number kind — freeform numeric input. Range metadata comes
              // from the backend; only the level group's max is overridden
              // here to honor the dynamic cap derived from confirmed
              // frame_type (link → 6, normal → 8).
              const isLevel = g.group === "레벨 / 랭크 / 링크";
              const inputMin = g.min;
              const inputMax = isLevel ? levelCap : g.max;
              const inputStep = g.step;
              const placeholder = isLevel ? `1~${levelCap}` : g.placeholder;
              const parsed = parseInt(numberInput, 10);
              const valid = !Number.isNaN(parsed) && parsed >= inputMin && parsed <= inputMax;
              const [gteType, lteType, eqType] = g.q_types;
              const gteAsked = valid && askedKeys.has(`${gteType}|${parsed}`);
              const lteAsked = valid && askedKeys.has(`${lteType}|${parsed}`);
              const eqAsked = valid && askedKeys.has(`${eqType}|${parsed}`);
              return (
                <>
                  {back}
                  <p className="text-sm text-gray-500 mb-2">{g.group} — 숫자를 입력하고 이상/이하 선택</p>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={inputMin}
                    max={inputMax}
                    step={inputStep}
                    value={numberInput}
                    onChange={(e) => setNumberInput(e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-base mb-2"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={busy || !valid || gteAsked}
                      onClick={() => handleAsk(gteType, parsed)}
                      className={`px-2 py-3 rounded-lg text-base font-semibold border transition ${
                        !valid || gteAsked
                          ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      }`}
                    >{valid ? `${parsed} 이상?` : "이상?"}{gteAsked && " ✓"}</button>
                    <button
                      type="button"
                      disabled={busy || !valid || eqAsked}
                      onClick={() => handleAsk(eqType, parsed)}
                      className={`px-2 py-3 rounded-lg text-base font-semibold border transition ${
                        !valid || eqAsked
                          ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      }`}
                    >{valid ? `${parsed} 일치?` : "일치?"}{eqAsked && " ✓"}</button>
                    <button
                      type="button"
                      disabled={busy || !valid || lteAsked}
                      onClick={() => handleAsk(lteType, parsed)}
                      className={`px-2 py-3 rounded-lg text-base font-semibold border transition ${
                        !valid || lteAsked
                          ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      }`}
                    >{valid ? `${parsed} 이하?` : "이하?"}{lteAsked && " ✓"}</button>
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>

      {searchOpen && (
        <CardSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onPick={(name) => { setSearchOpen(false); handleGuess(name); }}
          series="yugioh"
          copyTargetLabel="정답시도"
        />
      )}

      {showSTAnnounce && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={dismissSTAnnounce}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-5 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">🎉 마법 / 함정 카드 등장!</h2>
              <button
                type="button"
                onClick={dismissSTAnnounce}
                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                aria-label="닫기"
              >×</button>
            </div>
            <p className="text-gray-700 dark:text-gray-300 mb-3">
              이제 솔로 딱무고개에 <b>마법 / 함정 카드</b>도 출제됩니다.
            </p>
            <ul className="space-y-1 text-gray-700 dark:text-gray-300 mb-4 list-disc list-inside">
              <li>"일반적인 질문"에 <b>몬스터 / 마법 / 함정</b> 분기 추가</li>
              <li>"유형"에 <b>속공·지속·필드·장착·의식 마법</b>, <b>일반·지속·카운터 함정</b> 추가</li>
              <li>몬스터로 확정되면 마법·함정 질문은 자동 숨김 (반대도)</li>
            </ul>
            <button
              type="button"
              onClick={dismissSTAnnounce}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg"
            >확인</button>
          </div>
        </div>
      )}

      {showHintModal && game && hintDims && (() => {
        const nextIdx = game.hints_used ?? 0;
        const nextPenalty = hintPenalties[Math.min(nextIdx + 1, hintPenalties.length - 1)] - hintPenalties[Math.min(nextIdx, hintPenalties.length - 1)];
        // Effect/Cost/Trigger are repeatable — disabled only when the
        // server says no remaining clusters. Other dims stay one-shot.
        const remaining = game.hint_remaining_per_dim || {};
        return (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => !hintBusy && setShowHintModal(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-5 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold">💡 힌트 사용</h2>
                <button
                  type="button"
                  onClick={() => !hintBusy && setShowHintModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                  aria-label="닫기"
                >×</button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                이번 힌트 사용 시 정답 보상 <b className="text-red-600">-{nextPenalty}P</b> · 남은 힌트: <b>{(game.hints_max ?? 3) - nextIdx}</b>회
              </p>
              <div className="grid grid-cols-2 gap-2">
                {hintDims.map((d) => {
                  const left = remaining[d.dim] ?? 1;
                  const exhausted = left <= 0;
                  const isRepeatable = d.dim === "effect" || d.dim === "cost" || d.dim === "trigger";
                  return (
                    <button
                      key={d.dim}
                      type="button"
                      disabled={hintBusy || exhausted}
                      onClick={() => handleUseHint(d.dim)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-semibold border transition text-left ${
                        exhausted
                          ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                          : "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                      }`}
                    >
                      {d.label}
                      {isRepeatable && !exhausted && left < 99 ? <span className="ml-1 text-xs opacity-60">({left})</span> : null}
                      {exhausted && " ✓"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {showScoringInfo && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowScoringInfo(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-5 text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">점수 / 일일 한도 설명</h2>
              <button
                type="button"
                onClick={() => setShowScoringInfo(false)}
                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                aria-label="닫기"
              >×</button>
            </div>

            <p className="font-semibold mb-1">🎯 정답 시 획득 점수 (질문 수 기준)</p>
            <ul className="space-y-0.5 text-gray-700 dark:text-gray-300 mb-3">
              <li>· 1~10질문 → <b>20P</b></li>
              <li>· 11~12 → 19P</li>
              <li>· 13~14 → 18P, 15~16 → 17P, 17~18 → 16P</li>
              <li>· 19~20 → 15P</li>
              <li>· 21질문(최후의 시도) → <b>15P</b> (맞추기만 하면 보장)</li>
            </ul>

            <p className="font-semibold mb-1">⏳ 최후의 정답 시도</p>
            <p className="text-gray-700 dark:text-gray-300 mb-3">
              20개 질문 다 써도 마지막 정답 시도 한 번 추가 기회. 맞추면 15P.
            </p>

            <p className="font-semibold mb-1">💡 힌트</p>
            <ul className="space-y-0.5 text-gray-700 dark:text-gray-300 mb-3">
              <li>· 게임당 최대 3개. 1번씩 사용 시 보상 페널티:</li>
              <li>· 1번째 -1P · 2번째 -2P · 3번째 -2P (누적 최대 -5P)</li>
              <li>· 힌트 종류: 유형/속성/종족/레벨/효과/발동 비용·시점</li>
            </ul>

            <p className="font-semibold mb-1">💯 일일 한도 (난이도별)</p>
            <ul className="space-y-0.5 text-gray-700 dark:text-gray-300 mb-3">
              <li>· <b>초급</b>: 100P까지 (권장)</li>
              <li>· <b>중급</b>: 150P까지</li>
              <li>· <b>고급</b>: 200P까지</li>
            </ul>
            <p className="text-gray-700 dark:text-gray-300 mb-3 text-xs">
              세 난이도가 같은 포인트 풀을 공유합니다. 예: 초급으로 100P 채워도 중급/고급 게임으로 50P 더 벌 수 있고, 150P 채우면 고급으로 50P 더 가능. 듀치마인드는 별도 풀입니다.
            </p>

            <p className="font-semibold mb-1">🏳️ 포기</p>
            <p className="text-gray-700 dark:text-gray-300">
              포기 시 정답 공개되지만 포인트는 못 받음.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
