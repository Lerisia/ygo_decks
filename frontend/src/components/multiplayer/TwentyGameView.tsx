import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { PublicCardIcon, Border } from "@/api/avatarApi";

const DEFAULT_TOTAL_QUESTIONS = 20;
const ANSWER_LABEL: Record<string, string> = {
  yes: "예",
  no: "아니오",
  unsure: "모르겠음",
  correct: "✓ 정답",
  wrong: "✗ 오답",
  skip: "패스",
};

export type TwPlayerLite = {
  id: number;
  display_name: string;
  is_host: boolean;
  is_spectator?: boolean;
  avatar_icon: PublicCardIcon | null;
  border: Border | null;
};

export type TwChoosingEvent = {
  drawer_id: string;
  drawer_name?: string;
  deadline: number;
  seconds_remaining?: number;
  round: number;
  total_rounds: number;
  turn_index: number;
};

export type TwTurnEvent = {
  asker_id: string;
  asker_name?: string;
  questions_remaining: number;
  ask_deadline?: number;
  seconds_remaining?: number;
};

export type TwQuestionEvent = {
  asker_id: string;
  asker_name: string;
  text: string;
  questions_used: number;
  answer_deadline?: number;
};

export type TwQALogEntry = {
  asker_id: string;
  asker_name?: string;
  text: string;
  answer: string;  // yes / no / unsure / correct / wrong / skip
  ts?: number;
};

export type TwTurnReveal = {
  drawer_id: string;
  drawer_name?: string;
  card_id: number | null;
  card_name: string | null;
  winner_id: string | null;
  winner_name?: string | null;
  questions_used: number;
  drawer_score: number;
  guesser_score_each: number;
  winner_score?: number;
  mode?: "competitive" | "cooperative";
  qa_log: TwQALogEntry[];
  scores: Record<string, number>;
  round: number;
  total_rounds: number;
  image_url?: string | null;
};

/** Competitive mode: after the drawer answers, the same asker has a brief
 * window to immediately try the answer or pass. */
export type TwGuessWindowEvent = {
  asker_id: string;
  asker_name?: string;
  deadline: number;
  seconds_remaining: number;
};

/** Competitive mode: after the asker's guess window resolves (pass / wrong /
 * timeout), a 10s hand-raise window opens for non-asker, non-excluded
 * guessers to claim the next post-answer guess slot. Loops until someone
 * wins, all eligible are exhausted, or the window times out unanswered. */
export type TwHandRaiseWindowEvent = {
  deadline: number;
  seconds_remaining: number;
  eligible_player_ids: string[];
};

export type TwGameEnd = {
  ranked: {
    player: { id: number; display_name: string; avatar_icon: PublicCardIcon | null; border: Border | null };
    score: number;
    points_awarded: number;
  }[];
};

/** Unified chat stream event — covers both free chat and styled in-game
 * events (questions, answers, guesses, hand-raises, system notices). The
 * `kind` field drives chat-bubble styling so the player can scan the round
 * at a glance like a chat app. */
export type TwChatEvent = {
  player_id: string;
  display_name: string;
  text: string;
  ts: number;
  kind?:
    | "chat"            // default — free chat
    | "system"          // backend system notice (e.g. deploy notice)
    | "round_start"     // X님이 출제자입니다 (round N)
    | "round_skipped"   // 출제자가 카드를 안 뽑아 라운드 스킵
    | "question"        // ❓ asker: question text
    | "qa_pair"         // ❓ question + 🎴 answer (replayed once answered)
    | "guess"           // 🎯 guesser → card_name (correct/wrong)
    | "raise"           // ✋ X님이 손 들었음
    | "phase_pass";     // 정답 페이즈 종료 (no one raised)
  // Optional extras keyed by kind; consumers cherry-pick what they need.
  question_text?: string;
  answer?: string;       // 예 / 아니오 / 모르겠음
  card_name?: string;
  correct?: boolean;
  drawer_name?: string;
  round?: number;
};

interface Props {
  choosing: TwChoosingEvent | null;
  drawerCardId: number | null;        // drawer's chosen card (private)
  drawerCardName: string | null;
  drawerImageUrl: string | null;
  turn: TwTurnEvent | null;
  currentQuestion: TwQuestionEvent | null;  // set when in answering phase
  reveal: TwTurnReveal | null;
  finalResult: TwGameEnd | null;
  qaLog: TwQALogEntry[];
  chatLog: TwChatEvent[];
  liveScores: Record<string, number>;
  questionsRemaining: number;
  totalQuestions?: number;  // server-supplied per-round (scales with guesser count)
  players: TwPlayerLite[];
  selfDisplayName?: string;
  // Anonymous-room safe identity: server sends "플레이어N" as display_name
  // when room.is_anonymous, so display_name lookups don't match the user's
  // real nickname. Use this for iAmDrawer / "나" badge / self detection.
  selfPlayerId?: number | null;

  onChooseCard: (cardId: number, name: string) => void;
  onSubmitQuestion: (text: string) => void;
  onSubmitAnswer: (answer: "yes" | "no" | "unsure") => void;
  onSubmitGuess: (cardId: number) => void;
  onChat: (text: string) => void;
  // Competitive mode: pass on the post-answer guess window.
  onPassGuess?: () => void;
  guessWindow?: TwGuessWindowEvent | null;
  // Competitive: raise hand for the next post-answer slot.
  onRaiseHand?: () => void;
  // Competitive: hand-raiser passes their own guess opportunity.
  onPassHandGuess?: () => void;
  handRaiseWindow?: TwHandRaiseWindowEvent | null;
  twentyMode?: "competitive" | "cooperative";

  amSpectator?: boolean;
  chatLockedExternal?: boolean;
  // Leave / end-game actions surfaced inside the mobile fixed-overlay
  // layout (since the page-level buttons are hidden when the game takes
  // over the viewport).
  onLeave?: () => void;
  onEndGame?: () => void;
  isHost?: boolean;
}

type CardSearchResult = { id: number; name: string; image_url: string | null };

export default function TwentyGameView({
  choosing, drawerCardName, drawerImageUrl,
  turn, currentQuestion, reveal, finalResult,
  qaLog, chatLog, questionsRemaining, totalQuestions = DEFAULT_TOTAL_QUESTIONS,
  players, selfDisplayName, selfPlayerId,
  onChooseCard, onSubmitQuestion, onSubmitAnswer, onSubmitGuess, onChat,
  onPassGuess, guessWindow,
  onRaiseHand, onPassHandGuess, handRaiseWindow,
  chatLockedExternal,
}: Props) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 200);
    return () => clearInterval(id);
  }, []);

  const meId = selfPlayerId != null
    ? String(selfPlayerId)
    : (players.find((p) => p.display_name === selfDisplayName)?.id?.toString() || "");
  // Drawer detection: compare with the choosing event drawer_id or use the
  // fact that drawerCardName is only sent to the drawer.
  const phaseDrawerId = (() => {
    // From choosing or current_question — both refer to the same round's drawer.
    if (choosing) return choosing.drawer_id;
    return null;
  })();
  const iAmDrawer = !!(phaseDrawerId && meId && phaseDrawerId === meId);
  // If we have a drawerCardName (only sent to drawer), we ARE the drawer regardless.
  const iAmDrawerEffective = iAmDrawer || !!drawerCardName;

  // Capture deadlines once per identity so they don't reset every render.
  const [askDeadline, setAskDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (!turn) { setAskDeadline(null); return; }
    if (typeof turn.seconds_remaining === "number") {
      setAskDeadline(Date.now() / 1000 + Math.max(0, turn.seconds_remaining));
    } else if (typeof turn.ask_deadline === "number") {
      setAskDeadline(turn.ask_deadline);
    }
  }, [turn?.asker_id, turn?.ask_deadline]);

  const [ansDeadline, setAnsDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (!currentQuestion) { setAnsDeadline(null); return; }
    if (typeof currentQuestion.answer_deadline === "number") {
      setAnsDeadline(currentQuestion.answer_deadline);
    }
  }, [currentQuestion?.answer_deadline, currentQuestion?.text]);

  const [chooseDeadline, setChooseDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (!choosing) { setChooseDeadline(null); return; }
    if (typeof choosing.seconds_remaining === "number") {
      setChooseDeadline(Date.now() / 1000 + Math.max(0, choosing.seconds_remaining));
    } else if (typeof choosing.deadline === "number") {
      setChooseDeadline(choosing.deadline);
    }
  }, [choosing?.drawer_id, choosing?.deadline]);

  // timerTotal values mirror the backend constants in twenty.py — keep in sync
  // when retuning. Frontend doesn't read them from the server because they're
  // immutable per game (no per-room override yet).
  let timerRemaining = 0;
  let timerTotal = 0;
  if (choosing && !reveal && !turn && chooseDeadline) {
    timerRemaining = Math.max(0, chooseDeadline - now);
    timerTotal = 60;  // WORD_CHOICE_SECONDS
  } else if (guessWindow) {
    timerRemaining = Math.max(0, (guessWindow.deadline || 0) - now);
    timerTotal = 30;  // GUESS_WINDOW_SECONDS
  } else if (handRaiseWindow) {
    timerRemaining = Math.max(0, (handRaiseWindow.deadline || 0) - now);
    timerTotal = 10;  // HAND_RAISE_SECONDS
  } else if (currentQuestion && ansDeadline) {
    timerRemaining = Math.max(0, ansDeadline - now);
    timerTotal = 30;  // ANSWER_SECONDS
  } else if (turn && askDeadline) {
    timerRemaining = Math.max(0, askDeadline - now);
    timerTotal = 60;  // ASK_SECONDS
  }
  const timerFrac = timerTotal > 0 ? Math.min(1, Math.max(0, timerRemaining / timerTotal)) : 0;
  const timerColor = timerFrac > 0.5 ? "bg-green-500" : timerFrac > 0.25 ? "bg-yellow-400" : "bg-red-500";
  const timerActive = timerTotal > 0;

  // Final result view
  if (finalResult) {
    const ranked = finalResult.ranked || [];
    return (
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-3 sm:p-5">
        <h2 className="text-xl font-bold text-center mb-4">🏆 게임 종료</h2>
        <div className="space-y-2">
          {ranked.map((entry, i) => (
            <div key={entry.player.id} className={`flex items-center justify-between p-3 rounded-lg ${
              i === 0 ? "bg-yellow-100 dark:bg-yellow-900/30"
              : i === 1 ? "bg-gray-100 dark:bg-gray-700"
              : i === 2 ? "bg-orange-100 dark:bg-orange-900/30"
              : "bg-gray-50 dark:bg-gray-900"
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-lg w-7 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                </span>
                <Avatar icon={entry.player.avatar_icon} border={entry.player.border} size={36} />
                <span className="font-semibold truncate">{entry.player.display_name}</span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="font-bold text-lg leading-tight">{entry.score}점</span>
                {entry.points_awarded > 0 && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">+{entry.points_awarded}P</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-900 md:rounded-xl md:shadow p-0 md:p-3 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">

      {/* Top time gauge */}
      <div className="h-1 bg-gray-200 dark:bg-gray-700 mb-1 rounded-full overflow-hidden">
        {timerActive && (
          <div className={`h-full ${timerColor} transition-[width] duration-200 ease-linear`} style={{ width: `${timerFrac * 100}%` }} />
        )}
      </div>

      {/* Status bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg px-2 py-2 mb-2 text-sm h-[68px] flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="font-semibold whitespace-nowrap">
            {(choosing || turn || reveal) ?
              `라운드 ${(choosing?.round ?? reveal?.round ?? 1)}/${(choosing?.total_rounds ?? reveal?.total_rounds ?? 1)}` : ""}
          </span>
          <div className="flex items-center gap-2 whitespace-nowrap text-xs text-gray-500">
            {timerActive && <span className="font-mono">{timerRemaining.toFixed(1)}s</span>}
            <span>질문 {questionsRemaining}/{totalQuestions}</span>
          </div>
        </div>
        <div className="text-center font-semibold flex-1 flex items-center justify-center break-words overflow-hidden">
          {reveal ? `✓ 정답: ${reveal.card_name}` :
           currentQuestion ? `${currentQuestion.asker_name}: "${currentQuestion.text}"` :
           guessWindow ? `🎯 ${guessWindow.asker_name || ""} 정답 시도 중...` :
           handRaiseWindow ? `✋ 정답 시도 페이즈 — 손 들면 정답 시도 가능` :
           turn ? `${turn.asker_name || "다음"} 차례 — 질문하거나 정답 시도하세요` :
           choosing ? `${choosing.drawer_name || "출제자"} 카드 선택 중...` : ""}
        </div>
      </div>

      {/* Mobile-only drawer indicator (hidden on desktop where the sidebar
          shows the full player list). */}
      {phaseDrawerId && (() => {
        const drawer = players.find((p) => String(p.id) === phaseDrawerId);
        if (!drawer) return null;
        return (
          <div className="md:hidden flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-2 py-1.5 mb-2">
            <Avatar icon={drawer.avatar_icon} border={drawer.border} size={28} />
            <span className="text-xs text-gray-500">출제자</span>
            <span className="text-sm font-semibold truncate">{drawer.display_name}</span>
          </div>
        );
      })()}

      <div className="md:grid md:gap-3 md:grid-cols-[320px_1fr] lg:flex-1 lg:min-h-0">
        {/* LEFT (desktop only) — QA history + drawer card preview. Hidden on
            mobile; mobile users tap the QA-log toggle to open as a modal. */}
        <div className="hidden md:flex md:flex-col md:gap-2 md:mb-0 min-w-0 md:h-[608px] lg:h-full lg:max-h-full">
          {iAmDrawerEffective && drawerCardName && drawerImageUrl && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-2 flex items-center gap-3 border-2 border-blue-300 dark:border-blue-700 shrink-0">
              <img src={drawerImageUrl} alt={drawerCardName} className="w-16 h-16 object-contain rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">내 카드 (나만 봄)</p>
                <p className="font-bold text-sm truncate">{drawerCardName}</p>
              </div>
            </div>
          )}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2 flex-1 min-h-0 min-w-0 flex flex-col">
            <p className="text-xs text-gray-500 mb-1 shrink-0">📋 질문 기록</p>
            <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1 text-sm">
              {qaLog.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">아직 질문 없음</p>
              ) : qaLog.map((q, i) => (
                <div key={i} className="border-b border-gray-100 dark:border-gray-700 pb-1">
                  <div className="break-words">
                    <span className="text-gray-500 mr-1">{i + 1}.</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{q.asker_name || "?"}</span>
                    <span className="mx-1">:</span>
                    <span>{q.text}</span>
                  </div>
                  <div className="text-xs ml-5">
                    <span className={`font-bold ${
                      q.answer === "yes" || q.answer === "correct" ? "text-green-600 dark:text-green-400"
                      : q.answer === "no" || q.answer === "wrong" ? "text-red-500"
                      : "text-gray-500"
                    }`}>
                      → {ANSWER_LABEL[q.answer] || q.answer}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — chat panel (primary surface) with phase-aware bottom bar.
            Mobile shows just this; desktop pairs it with the QA log to the left. */}
        <ChatPanel
          chatLog={chatLog}
          players={players}
          onChat={onChat}
          chatLocked={iAmDrawerEffective || !!chatLockedExternal}
          chatLockReason={chatLockedExternal ? "관전자 채팅이 비활성화되어 있습니다" : undefined}
          reveal={reveal}
          totalQuestions={totalQuestions}
          /* phase context */
          turn={turn}
          currentQuestion={currentQuestion}
          guessWindow={guessWindow}
          handRaiseWindow={handRaiseWindow}
          iAmDrawer={iAmDrawer}
          iAmDrawerEffective={iAmDrawerEffective}
          choosing={choosing}
          drawerHasPicked={!!drawerCardName}
          meId={meId}
          /* actions */
          onSubmitQuestion={onSubmitQuestion}
          onSubmitAnswer={onSubmitAnswer}
          onSubmitGuess={onSubmitGuess}
          onPassGuess={onPassGuess}
          onPassHandGuess={onPassHandGuess}
          onRaiseHand={onRaiseHand}
          onChooseCard={onChooseCard}
          /* mobile QA log modal */
          qaLog={qaLog}
          drawerCardName={drawerCardName}
        />
      </div>

    </div>
  );
}

/** ChatPanel — primary game surface for both desktop & mobile. Hosts:
 *  - reveal pin (sticky at top when round ends)
 *  - chat scroll (game events + free chat as a unified stream)
 *  - phase-aware bottom bar: question input / yes-no buttons / guess search /
 *    raise-hand button / free chat — replaces the chat input contextually
 *  - mobile QA-history toggle (modal)
 *  - mobile drawer-card-picker overlay (when drawer is choosing)
 *  Layout-stable: bottom bar height is fixed regardless of which sub-input
 *  shows, so the chat scroll never resizes during gameplay. */
function ChatPanel(props: {
  chatLog: TwChatEvent[];
  players: TwPlayerLite[];
  onChat: (text: string) => void;
  chatLocked: boolean;
  chatLockReason?: string;
  reveal: TwTurnReveal | null;
  totalQuestions: number;
  turn: TwTurnEvent | null;
  currentQuestion: TwQuestionEvent | null;
  guessWindow: TwGuessWindowEvent | null | undefined;
  handRaiseWindow: TwHandRaiseWindowEvent | null | undefined;
  iAmDrawer: boolean;
  iAmDrawerEffective: boolean;
  choosing: TwChoosingEvent | null;
  drawerHasPicked: boolean;
  meId: string;
  onSubmitQuestion: (text: string) => void;
  onSubmitAnswer: (a: "yes" | "no" | "unsure") => void;
  onSubmitGuess: (cardId: number) => void;
  onPassGuess?: () => void;
  onPassHandGuess?: () => void;
  onRaiseHand?: () => void;
  onChooseCard: (cardId: number, name: string) => void;
  qaLog: TwQALogEntry[];
  drawerCardName: string | null;
}) {
  const {
    chatLog, players, onChat,
    chatLocked, chatLockReason, reveal, totalQuestions,
    turn, currentQuestion, guessWindow, handRaiseWindow,
    iAmDrawer, iAmDrawerEffective, choosing, drawerHasPicked, meId,
    onSubmitQuestion, onSubmitAnswer, onSubmitGuess,
    onPassGuess, onPassHandGuess, onRaiseHand, onChooseCard,
    qaLog, drawerCardName,
  } = props;

  const [chatText, setChatText] = useState("");
  const [showQaModal, setShowQaModal] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [showCardSearchForGuess, setShowCardSearchForGuess] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatLog.length]);

  // Auto-open the picker modal when drawer needs to pick. Manually closeable
  // (drawer can re-open via button if they accidentally close).
  useEffect(() => {
    if (choosing && iAmDrawer && !drawerHasPicked) setShowPickerModal(true);
    else setShowPickerModal(false);
  }, [choosing, iAmDrawer, drawerHasPicked]);

  // Determine which bottom-bar form to show (mutually exclusive).
  const bottomMode: "answer" | "ask" | "guess" | "raise" | "chat" =
    currentQuestion && iAmDrawerEffective ? "answer"
      : turn && !currentQuestion && !iAmDrawerEffective && turn.asker_id === meId ? "ask"
      : guessWindow && !iAmDrawerEffective && guessWindow.asker_id === meId ? "guess"
      : handRaiseWindow && !iAmDrawerEffective && (handRaiseWindow.eligible_player_ids?.includes(meId) ?? false) ? "raise"
      : "chat";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 flex flex-col h-[55svh] md:h-[608px] lg:h-auto lg:flex-1 lg:min-h-0 lg:max-h-full relative">
      {/* Mobile-only header: QA log toggle button + drawer card preview */}
      <div className="md:hidden flex items-center gap-2 mb-1 shrink-0">
        <button
          type="button"
          onClick={() => setShowQaModal(true)}
          className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-semibold"
        >
          📋 질문 기록 ({qaLog.length})
        </button>
        {iAmDrawerEffective && drawerCardName && (
          <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold truncate flex-1 min-w-0" title={drawerCardName}>
            내 카드: {drawerCardName}
          </span>
        )}
      </div>

      {/* Reveal pin — floats at the top of the chat scroll area when a
          round just ended. Never expands the panel; sized to fit. */}
      {reveal && (
        <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-400 dark:border-green-600 rounded-lg p-2 mb-1 shrink-0 flex items-center gap-2">
          {reveal.image_url && (
            <img src={reveal.image_url} alt={reveal.card_name || ""} className="w-14 h-14 object-contain rounded shrink-0 bg-white dark:bg-gray-900" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-green-700 dark:text-green-300 font-semibold leading-none">정답</p>
            <p className="text-sm font-bold break-words">{reveal.card_name}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {reveal.winner_name
                ? `🎉 ${reveal.winner_name} (${reveal.questions_used}/${totalQuestions})`
                : "아무도 못 맞힘"}
            </p>
          </div>
        </div>
      )}

      <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto text-sm md:text-base space-y-1 break-words">
        {chatLog.map((m, i) => {
          if ((m as any).is_system) {
            return (
              <div key={i} className="font-semibold text-gray-500 dark:text-gray-400 text-left break-words">
                [시스템] {m.text}
              </div>
            );
          }
          const sender = players.find((p) => String(p.id) === m.player_id);
          const isSpec = sender?.is_spectator;
          const kind = m.kind || "chat";
          if (kind === "question") {
            return (
              <div key={i} className="px-1.5 py-1 rounded bg-blue-50 dark:bg-blue-900/20 flex items-start gap-1">
                {sender && (
                  <>
                    <span className="md:hidden">
                      <Avatar icon={sender.avatar_icon} border={sender.border} size={14} className="mt-0.5 shrink-0" />
                    </span>
                    <span className="hidden md:inline-flex">
                      <Avatar icon={sender.avatar_icon} border={sender.border} size={22} className="shrink-0" />
                    </span>
                  </>
                )}
                <div className="min-w-0">
                  <span className="font-bold text-blue-700 dark:text-blue-300">[질문] {m.display_name}</span>
                  <span className="mx-1 text-gray-400">:</span>
                  <span className="font-semibold">{m.question_text || m.text}</span>
                </div>
              </div>
            );
          }
          if (kind === "qa_pair") {
            const ans = m.answer || "";
            const ansColor = ans === "yes" ? "text-green-600 dark:text-green-400"
              : ans === "no" ? "text-red-500"
              : "text-gray-500";
            const ansLabel = ans === "yes" ? "예" : ans === "no" ? "아니오" : "모르겠음";
            return (
              <div key={i} className="px-1.5 py-1 rounded border border-blue-300 dark:border-blue-700">
                <div className="flex items-start gap-1">
                  {sender && (
                    <>
                      <span className="md:hidden">
                        <Avatar icon={sender.avatar_icon} border={sender.border} size={14} className="mt-0.5 shrink-0" />
                      </span>
                      <span className="hidden md:inline-flex">
                        <Avatar icon={sender.avatar_icon} border={sender.border} size={22} className="shrink-0" />
                      </span>
                    </>
                  )}
                  <div className="min-w-0">
                    <span className="font-bold text-blue-700 dark:text-blue-300">[질문] {m.display_name}</span>
                    <span className="mx-1 text-gray-400">:</span>
                    <span className="font-semibold">{m.question_text || m.text}</span>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">→ 🎴 </span>
                  <span className={`font-bold ${ansColor}`}>{ansLabel}</span>
                </div>
              </div>
            );
          }
          if (kind === "guess") {
            return (
              <div key={i} className={`px-1.5 py-1 rounded font-semibold ${
                m.correct
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
              }`}>
                🎯 <span className="font-bold">{m.display_name}</span> → {m.card_name || m.text} {m.correct ? "✓ 정답!" : "✗ 오답"}
              </div>
            );
          }
          if (kind === "raise") {
            return (
              <div key={i} className="px-1.5 py-1 rounded text-orange-600 dark:text-orange-400 font-semibold">
                ✋ <span className="font-bold">{m.display_name}</span>님이 정답 시도하러 손 들었습니다
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-1">
              {sender && (
                <>
                  <span className="md:hidden">
                    <Avatar icon={sender.avatar_icon} border={sender.border} size={14} className="mt-0.5 shrink-0" />
                  </span>
                  <span className="hidden md:inline-flex">
                    <Avatar icon={sender.avatar_icon} border={sender.border} size={22} className="shrink-0" />
                  </span>
                </>
              )}
              <div className="min-w-0">
                <span className={`font-semibold ${isSpec ? "text-gray-500 dark:text-gray-400" : "text-blue-600 dark:text-blue-400"}`}>
                  {m.display_name}
                </span>
                <span className="mx-1 text-gray-400">:</span>
                <span>{m.text}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Phase-aware bottom bar — fixed slot ~64px tall so the chat scroll
          height never shifts when the form changes. */}
      <div className="mt-2 shrink-0 min-h-[44px]">
        {bottomMode === "answer" && currentQuestion && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-500 truncate">
              <span className="font-semibold text-blue-600">{currentQuestion.asker_name}</span>: "{currentQuestion.text}"
            </p>
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => onSubmitAnswer("yes")} className="py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700 text-sm">✓ 예</button>
              <button onClick={() => onSubmitAnswer("no")} className="py-2 bg-red-500 text-white rounded font-semibold hover:bg-red-600 text-sm">✗ 아니오</button>
              <button onClick={() => onSubmitAnswer("unsure")} className="py-2 bg-gray-500 text-white rounded font-semibold hover:bg-gray-600 text-xs">? 모르겠음</button>
            </div>
          </div>
        )}
        {bottomMode === "ask" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = chatText.trim();
              if (!t) return;
              onSubmitQuestion(t);
              setChatText("");
            }}
            className="bg-blue-100 dark:bg-blue-900/40 ring-4 ring-blue-500 ring-inset rounded p-2"
          >
            <p className="text-xs font-bold text-blue-800 dark:text-blue-200 mb-1 flex items-center gap-1">
              ❓ 당신의 질문 차례 — 출제자에게 물어볼 질문을 입력하세요
            </p>
            <div className="flex gap-1">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="예: 효과 몬스터인가요?"
                autoFocus
                className="flex-1 min-w-0 px-2 py-2 border-2 border-blue-500 rounded bg-white dark:bg-gray-700 text-base font-medium"
              />
              <button
                type="submit"
                disabled={!chatText.trim()}
                className="shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 disabled:opacity-40"
              >
                질문 →
              </button>
              {!iAmDrawerEffective && drawerHasPicked && (
                <button
                  type="button"
                  onClick={() => setShowCardSearchForGuess(true)}
                  title="정답 시도"
                  className="shrink-0 px-3 py-2 bg-orange-500 text-white rounded font-semibold hover:bg-orange-600"
                >
                  🎯
                </button>
              )}
            </div>
            {showCardSearchForGuess && (
              <CardGuessModal
                onClose={() => setShowCardSearchForGuess(false)}
                onPick={(c) => { setShowCardSearchForGuess(false); onSubmitGuess(c.id); }}
              />
            )}
          </form>
        )}
        {bottomMode === "guess" && guessWindow && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setShowCardSearchForGuess(true)}
              className="flex-1 py-2 bg-orange-500 text-white rounded font-semibold hover:bg-orange-600 text-sm"
            >
              🔍 정답 시도
            </button>
            <button
              type="button"
              onClick={() => {
                if (onPassGuess) onPassGuess();
                if (onPassHandGuess) onPassHandGuess();
              }}
              className="px-3 py-2 bg-gray-500 text-white rounded font-semibold hover:bg-gray-600 text-sm"
            >
              패스
            </button>
            {showCardSearchForGuess && (
              <CardGuessModal
                onClose={() => setShowCardSearchForGuess(false)}
                onPick={(c) => { setShowCardSearchForGuess(false); onSubmitGuess(c.id); }}
              />
            )}
          </div>
        )}
        {bottomMode === "raise" && onRaiseHand && (
          <button
            type="button"
            onClick={onRaiseHand}
            className="w-full py-2 bg-orange-500 text-white rounded font-semibold hover:bg-orange-600 text-sm"
          >
            ✋ 정답 시도 — 손 들기 (선착순)
          </button>
        )}
        {bottomMode === "chat" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (chatLocked) return;
              const t = chatText.trim();
              if (!t) return;
              onChat(t);
              setChatText("");
            }}
            className="flex gap-1"
          >
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder={chatLocked ? (chatLockReason || "당신은 출제자입니다") : "채팅 입력 (정답은 옆 🎯 정답 버튼)"}
              disabled={chatLocked}
              className="flex-1 min-w-0 px-2 py-2 border rounded bg-white dark:bg-gray-700 text-base"
            />
            <button type="submit" disabled={chatLocked || !chatText.trim()} className="shrink-0 px-3 py-2 bg-blue-600 text-white rounded font-semibold disabled:opacity-40">전송</button>
            {/* Always-available guess attempt — DuchMind-style anytime
                anyone-can-guess. Hidden for the drawer (they know the card)
                and when no card has been chosen yet. */}
            {!iAmDrawerEffective && drawerHasPicked && (
              <button
                type="button"
                onClick={() => setShowCardSearchForGuess(true)}
                title="정답 시도"
                className="shrink-0 px-3 py-2 bg-orange-500 text-white rounded font-bold hover:bg-orange-600 whitespace-nowrap"
              >
                🎯 정답
              </button>
            )}
            {showCardSearchForGuess && (
              <CardGuessModal
                onClose={() => setShowCardSearchForGuess(false)}
                onPick={(c) => { setShowCardSearchForGuess(false); onSubmitGuess(c.id); }}
              />
            )}
          </form>
        )}
      </div>

      {/* QA log modal (mobile only — desktop has it in the left column) */}
      {showQaModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-end sm:items-center justify-center p-2 sm:p-4 md:hidden" onClick={() => setShowQaModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold">📋 질문 기록 ({qaLog.length})</h3>
              <button onClick={() => setShowQaModal(false)} className="text-gray-400 text-lg px-2">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 text-sm">
              {qaLog.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">아직 질문 없음</p>
              ) : qaLog.map((q, i) => (
                <div key={i} className="border-b border-gray-100 dark:border-gray-700 pb-1">
                  <div className="break-words">
                    <span className="text-gray-500 mr-1">{i + 1}.</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{q.asker_name || "?"}</span>
                    <span className="mx-1">:</span>
                    <span>{q.text}</span>
                  </div>
                  <div className="text-xs ml-5">
                    <span className={`font-bold ${
                      q.answer === "yes" || q.answer === "correct" ? "text-green-600 dark:text-green-400"
                      : q.answer === "no" || q.answer === "wrong" ? "text-red-500"
                      : "text-gray-500"
                    }`}>
                      → {ANSWER_LABEL[q.answer] || q.answer}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drawer card picker — full-screen modal that auto-opens when drawer
          needs to choose. Doesn't disrupt other players' layout. */}
      {showPickerModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 w-full max-w-2xl h-[80vh] md:max-w-3xl md:h-[55vh] flex flex-col">
            <DrawerCardPicker onChoose={(id, name) => { onChooseCard(id, name); setShowPickerModal(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============== sub-components ==============

function DrawerCardPicker({ onChoose }: { onChoose: (cardId: number, name: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const token = localStorage.getItem("access_token") || "";
        const res = await fetch(`/api/search/?q=${encodeURIComponent(t)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) setResults(data.results || []);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border-2 border-blue-300 dark:border-blue-700 flex flex-col flex-1 min-h-0">
      <p className="font-bold mb-2 shrink-0">출제할 카드를 선택하세요</p>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="카드명 검색"
        autoFocus
        className="w-full px-2 py-1.5 border rounded mb-2 bg-white dark:bg-gray-700 text-base shrink-0"
      />
      {loading && <p className="text-xs text-gray-400 text-center py-2 shrink-0">검색 중...</p>}
      <div className="overflow-y-auto flex-1 min-h-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 content-start">
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => onChoose(c.id, c.name)}
            className="text-center p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-gray-200 dark:border-gray-700 self-start"
          >
            {c.image_url ? (
              <img src={c.image_url} alt={c.name} className="w-full aspect-square object-contain rounded bg-gray-100 dark:bg-gray-900" loading="lazy" />
            ) : (
              <div className="w-full aspect-square rounded bg-gray-100 dark:bg-gray-900" />
            )}
            <p className="text-[10px] mt-0.5 break-words leading-tight">{c.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function CardGuessModal({ onClose, onPick }: { onClose: () => void; onPick: (c: CardSearchResult) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setResults([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const token = localStorage.getItem("access_token") || "";
        const res = await fetch(`/api/search/?q=${encodeURIComponent(t)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!cancelled) setResults(data.results || []);
      } catch { if (!cancelled) setResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);
  return (
    <div className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold">🎯 정답 카드 선택</h3>
          <button onClick={onClose} className="text-gray-400 text-lg px-2">✕</button>
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="카드명 검색"
          autoFocus
          className="w-full px-2 py-1.5 border rounded mb-2 bg-white dark:bg-gray-700 text-base"
        />
        <div className="flex-1 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-2">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="text-center p-1 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 border border-gray-200 dark:border-gray-700"
            >
              {c.image_url ? (
                <img src={c.image_url} alt={c.name} className="w-full aspect-square object-contain rounded bg-gray-100 dark:bg-gray-900" loading="lazy" />
              ) : (
                <div className="w-full aspect-square rounded bg-gray-100 dark:bg-gray-900" />
              )}
              <p className="text-[10px] mt-0.5 break-words leading-tight">{c.name}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

