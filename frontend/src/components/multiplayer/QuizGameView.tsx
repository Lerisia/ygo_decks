import { useEffect, useRef, useState } from "react";

type ChoiceImages = Record<string, string>; // "8x8" | "10x10" | ...
type Question = {
  card_id: string | number;
  images: ChoiceImages;
  choices: string[];
};

export type QuizQuestionEvent = {
  round: number;
  total_rounds: number;
  question: Question;
  duration: number;
  stage_seconds: number;
  score_map: Record<string, number>; // {"0": 4, "1": 3, ...}
};

export type QuizMyResult = {
  correct: boolean;
  delta: number;
  stage: number;
  total_score: number;
  cooldown_until?: number;
  cooldown_seconds?: number;
  error?: string;
};

export type QuizRoundReveal = {
  correct_answer: string;
  scores: Record<string, number>; // player_id -> total
  round: number;
};

export type QuizGameEnd = {
  ranked: { player: { id: number; display_name: string }; score: number }[];
};

const SIZE_KEYS = ["8x8", "10x10", "12x12", "16x16"];

interface Props {
  question: QuizQuestionEvent | null;
  myResult: QuizMyResult | null;
  reveal: QuizRoundReveal | null;
  finalResult: QuizGameEnd | null;
  onAnswer: (choice: string) => void;
}

export default function QuizGameView({ question, myResult, reveal, finalResult, onAnswer }: Props) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  const startedAtRef = useRef<number>(0);

  // Reset timer when new question arrives
  useEffect(() => {
    if (question) {
      startedAtRef.current = Date.now() / 1000;
    }
  }, [question]);

  // 100ms tick for smooth countdown / stage updates
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 100);
    return () => clearInterval(id);
  }, []);

  // Final result view
  if (finalResult) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
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
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg w-7 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                </span>
                <span className="font-semibold">{entry.player.display_name}</span>
              </div>
              <span className="font-bold text-lg">{entry.score}점</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Reveal view (between rounds)
  if (reveal && (!question || reveal.round === question.round)) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 text-center">
        <p className="text-sm text-gray-500 mb-2">정답</p>
        <p className="text-2xl font-bold mb-4">{reveal.correct_answer}</p>
        <p className="text-xs text-gray-400">다음 문제로 곧 넘어갑니다...</p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 text-center text-gray-500">
        문제 준비 중...
      </div>
    );
  }

  // Active round
  const elapsed = now - startedAtRef.current;
  const stageIdx = Math.min(Math.floor(elapsed / question.stage_seconds), SIZE_KEYS.length - 1);
  const sizeKey = SIZE_KEYS[stageIdx];
  const imageUrl = question.question.images[sizeKey];
  const remaining = Math.max(0, question.duration - elapsed);
  const currentScore = question.score_map[String(stageIdx)] ?? 1;

  const onCooldown = !!myResult?.cooldown_until && (now < myResult.cooldown_until);
  const cooldownLeft = onCooldown && myResult?.cooldown_until
    ? Math.max(0, myResult.cooldown_until - now)
    : 0;
  const lockedFromCorrect = myResult?.correct === true;
  const disabled = onCooldown || lockedFromCorrect || remaining <= 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
      <div className="flex justify-between items-center mb-3 text-sm">
        <span className="font-semibold">
          라운드 {question.round}/{question.total_rounds}
        </span>
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
        {question.question.choices.map((choice) => (
          <button
            key={choice}
            onClick={() => onAnswer(choice)}
            disabled={disabled}
            className={`py-3 px-4 rounded-lg border-2 font-semibold transition ${
              disabled
                ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-400 cursor-not-allowed"
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
            }`}
          >
            {choice}
          </button>
        ))}
      </div>

      {lockedFromCorrect && (
        <p className="mt-3 text-center text-green-600 dark:text-green-400 font-semibold">
          ✓ 정답! +{myResult?.delta}점 (총 {myResult?.total_score}점)
        </p>
      )}
      {onCooldown && !lockedFromCorrect && (
        <p className="mt-3 text-center text-red-600 dark:text-red-400 font-semibold">
          ✗ 오답 ({myResult?.delta}점) · 다시 답하려면 {cooldownLeft.toFixed(1)}초 대기
        </p>
      )}
    </div>
  );
}
