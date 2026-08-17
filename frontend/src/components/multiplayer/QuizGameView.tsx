import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { PublicCardIcon, Border } from "@/api/avatarApi";

type ChoiceImages = Record<string, string>; // "8x8" | "10x10" | ...
type Question = {
  card_id: string | number;
  images: ChoiceImages;
  choices: string[];
};

export type QuizPlayerLite = {
  id: number;
  display_name: string;
  is_host: boolean;
  is_spectator?: boolean;
  avatar_icon: PublicCardIcon | null;
  border: Border | null;
};

export type QuizQuestionEvent = {
  round: number;
  total_rounds: number;
  question: Question;
  duration: number;
  stage_seconds: number;
  score_map: Record<string, number>; // {"0": 4, "1": 3, ...}
  elapsed_seconds?: number; // server-reported elapsed at message time (for resume)
};

export type QuizMyResult = {
  // Slim ack — the server intentionally hides correctness/delta/score until
  // the round-end reveal so the answering phase stays pure "pick a side".
  locked?: boolean;
  choice?: string;
  round?: number;
  error?: string;
};

export type QuizRoundReveal = {
  correct_answer: string;
  image_url?: string | null;
  scores: Record<string, number>; // player_id -> total
  round: number;
  // Per-player breakdown: who locked in and what happened.
  results: { player_id: string; correct: boolean; delta: number; stage: number; choice?: string }[];
};

export type QuizProgressEvent = {
  round: number;
  answered: number;
  total: number;
};

export type QuizGameEnd = {
  ranked: {
    player: {
      id: number;
      display_name: string;
      avatar_icon: import("@/api/avatarApi").PublicCardIcon | null;
      border: import("@/api/avatarApi").Border | null;
    };
    score: number;
    points_awarded: number;
  }[];
};

const SIZE_KEYS = ["8x8", "10x10", "12x12", "16x16"];

function ChatPanel({
  chatLog, players, onChat, selfDisplayName, chatLocked,
}: {
  chatLog: { player_id: string; display_name: string; text: string; ts: number }[];
  players: QuizPlayerLite[];
  onChat: (text: string) => void;
  selfDisplayName?: string;
  chatLocked?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [chatLog.length]);
  return (
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-3 mt-2">
      <div ref={ref} className="bg-gray-50 dark:bg-gray-900 rounded p-2 mb-2 text-sm md:text-base overflow-y-auto h-32 md:h-48 space-y-0.5 break-words">
        {chatLog.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">떠들어보세요!</p>
        ) : chatLog.map((m, i) => {
          const isSystem = (m as any).is_system;
          if (isSystem) {
            return (
              <div key={i} className="font-semibold text-gray-500 dark:text-gray-400 text-left break-words">
                [시스템] {m.text}
              </div>
            );
          }
          const sender = players.find((p) => String(p.id) === m.player_id);
          const isSelf = m.display_name === selfDisplayName;
          const isSpec = sender?.is_spectator;
          return (
            <div key={i} className="flex items-start gap-1.5">
              {sender && (
                <>
                  <span className="md:hidden">
                    <Avatar icon={sender.avatar_icon} border={sender.border} size={16} className="mt-0.5 shrink-0" />
                  </span>
                  <span className="hidden md:inline-flex">
                    <Avatar icon={sender.avatar_icon} border={sender.border} size={24} className="shrink-0" />
                  </span>
                </>
              )}
              <div className="min-w-0">
                <span className={`font-semibold ${isSpec ? "text-gray-500 dark:text-gray-400" : isSelf ? "text-blue-600 dark:text-blue-400" : ""}`}>
                  {m.display_name}
                </span>
                <span className="text-gray-400 mx-1">:</span>
                <span>{m.text}</span>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (chatLocked) return; const t = text.trim(); if (!t) return; onChat(t); setText(""); }} className="flex gap-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={chatLocked ? "관전자 채팅이 비활성화되어 있습니다" : "자유 채팅..."}
          disabled={chatLocked}
          maxLength={200}
          className="flex-1 min-w-0 px-2 py-1 md:py-1.5 border rounded bg-white dark:bg-gray-700 text-base sm:text-sm md:text-base disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button type="submit" disabled={!text.trim() || chatLocked} className="shrink-0 px-3 py-1 md:py-1.5 bg-blue-600 text-white rounded text-sm md:text-base font-semibold disabled:opacity-40">전송</button>
      </form>
    </div>
  );
}

interface Props {
  question: QuizQuestionEvent | null;
  myResult: QuizMyResult | null;
  reveal: QuizRoundReveal | null;
  progress: QuizProgressEvent | null;
  finalResult: QuizGameEnd | null;
  onAnswer: (choice: string) => void;
  onChat: (text: string) => void;
  chatLog: { player_id: string; display_name: string; text: string; ts: number }[];
  players: QuizPlayerLite[];
  liveScores: Record<string, number>;
  selfDisplayName?: string;
  selfPlayerId?: number | null;
  isHost?: boolean;
  amSpectator?: boolean;
  amReservedForNext?: boolean;
  onJoinGame?: () => void;
  onKickPlayer?: (playerId: number) => void;
  chatLocked?: boolean;
}

function PlayerStrip({
  players, liveScores, selfDisplayName, roundResults, mySelfDelta,
  isHost, selfPlayerId, onKickPlayer,
}: {
  players: QuizPlayerLite[];
  liveScores: Record<string, number>;
  selfDisplayName?: string;
  // Per-player reveal breakdown — when present, colors each tile by outcome.
  roundResults?: { player_id: string; correct: boolean; delta: number }[];
  mySelfDelta?: { score: number; correct: boolean | null } | null;
  // Host-only: kick button shown on every other player's tile.
  isHost?: boolean;
  selfPlayerId?: number | null;
  onKickPlayer?: (playerId: number) => void;
}) {
  const resultByPid = new Map<string, { correct: boolean; delta: number }>();
  if (roundResults) {
    for (const r of roundResults) resultByPid.set(String(r.player_id), { correct: r.correct, delta: r.delta });
  }
  return (
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
      {players.map((p) => {
        const isSelf = !!selfDisplayName && p.display_name === selfDisplayName;
        const result = resultByPid.get(String(p.id));
        const score = isSelf && mySelfDelta ? mySelfDelta.score : (liveScores[String(p.id)] ?? 0);
        const tileClass = result
          ? result.correct
            ? "border-green-400 bg-green-50 dark:bg-green-900/30"
            : "border-red-300 bg-red-50 dark:bg-red-900/20"
          : isSelf
            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
            : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900";
        const scoreColor = result
          ? result.correct ? "text-green-700 dark:text-green-300" : "text-red-600 dark:text-red-300"
          : "";
        const canKick = !!isHost && !!onKickPlayer && !isSelf && p.id !== selfPlayerId;
        return (
          <div
            key={p.id}
            className={`relative flex flex-col items-center text-center p-2 rounded-lg border-2 transition-colors ${tileClass}`}
          >
            {canKick && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`${p.display_name}님을 강퇴할까요?`)) onKickPlayer!(p.id);
                }}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold leading-none flex items-center justify-center"
                title={`${p.display_name} 강퇴`}
              >✕</button>
            )}
            <Avatar icon={p.avatar_icon} border={p.border} size={48} />
            <span className="text-xs mt-1 truncate max-w-full">
              {p.is_host && "👑 "}{p.display_name}{isSelf && " (나)"}
            </span>
            <span className={`text-sm font-bold ${scoreColor}`}>
              {score}점{result && (result.delta > 0 ? ` (+${result.delta})` : ` (${result.delta})`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function QuizGameView({
  question, myResult, reveal, progress, finalResult, onAnswer, onChat, chatLog,
  players, liveScores, selfDisplayName, selfPlayerId, isHost, amSpectator, amReservedForNext, onJoinGame, onKickPlayer, chatLocked,
}: Props) {
  const activePlayers = players.filter((p) => !p.is_spectator);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const startedAtRef = useRef<number>(0);

  // Reset timer when new question arrives. Account for server elapsed
  // (so reconnecting clients align with the in-flight round).
  useEffect(() => {
    if (question) {
      const elapsedAtArrival = question.elapsed_seconds ?? 0;
      startedAtRef.current = (Date.now() / 1000) - elapsedAtArrival;
    }
  }, [question?.round]);

  // 100ms tick for smooth countdown / stage updates
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 100);
    return () => clearInterval(id);
  }, []);

  // Final result view
  if (finalResult) {
    return (
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-3 sm:p-5">
        <h2 className="text-xl font-bold text-center mb-4">🏆 게임 종료</h2>
        <div className="space-y-2">
          {finalResult.ranked.map((entry, i) => (
            <div
              key={entry.player.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                i === 0 ? "bg-yellow-100 dark:bg-yellow-900/30"
                : i === 1 ? "bg-gray-100 dark:bg-gray-700"
                : i === 2 ? "bg-orange-100 dark:bg-orange-900/30"
                : "bg-gray-50 dark:bg-gray-900"
              }`}
            >
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
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    +{entry.points_awarded}P
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Track the choice this player tapped — survives myResult races / replay
  // and powers the highlight in both phases (round AND reveal). Reset on
  // each new round so a previous round's pick doesn't carry over.
  const [myChoice, setMyChoice] = useState<string | null>(null);
  useEffect(() => { setMyChoice(null); }, [question?.round]);
  const lockedChoice = myChoice || myResult?.choice || null;

  // Reveal view (between rounds) — mirrors the active layout (same image
  // size, same choice grid) so the page height doesn't jump.
  if (reveal && (!question || reveal.round === question.round)) {
    const correctList = (reveal.results || []).filter((r) => r.correct);
    const playerByPid = new Map<string, QuizPlayerLite>();
    for (const p of activePlayers) playerByPid.set(String(p.id), p);
    // Last stage of the round → final low-res image (same shape as active).
    const lastStageKey = SIZE_KEYS[SIZE_KEYS.length - 1];
    const lastStageImage = question ? question.question.images[lastStageKey] : null;
    const totalRounds = question?.total_rounds;
    const revealChoices = question?.question.choices || correctList.map((r) => r.choice).filter((c): c is string => !!c);
    return (
      <>
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
        <PlayerStrip
          players={activePlayers}
          liveScores={reveal.scores}
          selfDisplayName={selfDisplayName}
          roundResults={reveal.results}
          isHost={isHost}
          selfPlayerId={selfPlayerId}
          onKickPlayer={onKickPlayer}
        />
        <div className="flex justify-between items-center mb-3 text-sm gap-2 flex-wrap">
          <span className="font-semibold">
            라운드 {reveal.round}{totalRounds ? `/${totalRounds}` : ""}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
            라운드 종료 · 정답 공개
          </span>
        </div>

        <div className="flex justify-center mb-4">
          <img
            src={reveal.image_url || lastStageImage || undefined}
            alt={reveal.correct_answer}
            className="rounded-lg shadow border-2 border-green-400 dark:border-green-600 object-contain bg-white"
            style={{ width: 168, height: 168 }}
          />
        </div>

        <div className="text-center mb-3">
          <span className="inline-block px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-semibold">
            정답: {reveal.correct_answer}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {revealChoices.map((choice) => {
            const isCorrect = choice === reveal.correct_answer;
            const isMine = lockedChoice === choice;
            const cls = isCorrect
              ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200"
              : isMine
                ? "border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500";
            return (
              <div
                key={choice}
                className={`py-3 px-4 rounded-lg border-2 font-semibold flex items-center justify-between ${cls}`}
              >
                <span>{choice}</span>
                <span className="text-xs">
                  {isCorrect && "✓ 정답"}
                  {!isCorrect && isMine && "✗ 내 선택"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Same fixed footer slot as the active view — keeps page height
            identical between the answering phase and the reveal phase. */}
        <div className="mt-3 min-h-[68px] flex flex-col items-center justify-center text-center">
          {correctList.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {correctList.map((r) => {
                const p = playerByPid.get(String(r.player_id));
                const name = p?.display_name || `플레이어${r.player_id}`;
                return (
                  <span
                    key={r.player_id}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-semibold"
                  >
                    🎉 {name} +{r.delta}점
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="inline-block px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-full text-xs">
              정답자 없음
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">다음 문제로 곧 넘어갑니다...</p>
        </div>
      </div>
      <ChatPanel chatLog={chatLog} players={players} onChat={onChat} selfDisplayName={selfDisplayName} chatLocked={chatLocked} />
      </>
    );
  }

  if (!question) {
    return (
      <>
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-3 sm:p-5 text-center text-gray-500">
        문제 준비 중...
      </div>
      <ChatPanel chatLog={chatLog} players={players} onChat={onChat} selfDisplayName={selfDisplayName} chatLocked={chatLocked} />
      </>
    );
  }

  // Active round
  const elapsed = now - startedAtRef.current;
  const stageIdx = Math.min(Math.floor(elapsed / question.stage_seconds), SIZE_KEYS.length - 1);
  const sizeKey = SIZE_KEYS[stageIdx];
  const imageUrl = question.question.images[sizeKey];
  const remaining = Math.max(0, question.duration - elapsed);
  const currentScore = question.score_map[String(stageIdx)] ?? 1;

  const myLocked = !!myResult?.locked
    || myResult?.error === "already_answered"
    || lockedChoice != null;
  const disabled = myLocked || remaining <= 0 || !!amSpectator;

  return (
    <>
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
      <PlayerStrip
        players={activePlayers}
        liveScores={liveScores}
        selfDisplayName={selfDisplayName}
        isHost={isHost}
        selfPlayerId={selfPlayerId}
        onKickPlayer={onKickPlayer}
      />
      {amSpectator && (
        <div className="mb-3 p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-center text-sm font-semibold flex items-center justify-center gap-2 flex-wrap">
          <span>👀 관전 중</span>
          {amReservedForNext ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">🕐 다음 라운드 참가 예약됨</span>
          ) : onJoinGame ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("다음 라운드부터 참여하시겠습니까? 이번 라운드는 관전을 유지합니다.")) onJoinGame();
              }}
              className="text-xs px-2 py-0.5 rounded-full border border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 font-semibold"
            >
              🎮 다음 라운드 참가 예약
            </button>
          ) : null}
        </div>
      )}
      <div className="flex justify-between items-center mb-3 text-sm gap-2 flex-wrap">
        <span className="font-semibold">
          라운드 {question.round}/{question.total_rounds}
        </span>
        {progress && progress.round === question.round && progress.total > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold">
            답함 {progress.answered}/{progress.total}
          </span>
        )}
        <span className="text-gray-500">{remaining.toFixed(1)}초</span>
      </div>

      <div className="flex justify-center mb-4">
        <img
          src={imageUrl}
          alt="?"
          className="rounded-lg shadow border-2 border-gray-300 dark:border-gray-600"
          style={{ imageRendering: "pixelated", width: 168, height: 168 }}
        />
      </div>

      <div className="text-center mb-3">
        <span className="inline-block px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-semibold">
          현재 화질: {sizeKey} · {currentScore}점
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {question.question.choices.map((choice) => {
          const picked = lockedChoice === choice;
          const baseClass = picked
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
            : disabled
              ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20";
          return (
            <button
              key={choice}
              onClick={() => { if (!disabled) { setMyChoice(choice); onAnswer(choice); } }}
              disabled={disabled}
              className={`py-3 px-4 rounded-lg border-2 font-semibold transition flex items-center justify-between ${baseClass}`}
            >
              <span>{choice}</span>
              {picked && <span className="text-xs">✓ 내 선택</span>}
            </button>
          );
        })}
      </div>

      {/* Fixed footer slot — keeps layout height identical before answer,
          after answer, and during reveal so the page doesn't jump. */}
      <div className="mt-3 min-h-[68px] flex items-center justify-center">
        {myLocked && !amSpectator ? (
          <div className="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-center text-sm">
            ✓ 답 제출됨 — 결과는 라운드 종료 시 공개됩니다
          </div>
        ) : (
          <div className="w-full p-3 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 text-center text-sm">
            화질을 살피며 답을 골라보세요
          </div>
        )}
      </div>
    </div>
    <ChatPanel chatLog={chatLog} players={players} onChat={onChat} selfDisplayName={selfDisplayName} chatLocked={chatLocked} />
    </>
  );
}
