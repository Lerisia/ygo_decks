import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/Avatar";

const RESOLUTION_STEPS = ["8x8", "10x10", "12x12", "16x16"];
const SCORE_MAP: Record<string, number> = { "8x8": 4, "10x10": 3, "12x12": 2, "16x16": 1 };
const INITIAL_TIME = 10;

type QuizCard = {
  card_id: string;
  images: Record<string, string>;
  choices: string[];
};

type LeaderboardEntry = {
  username: string;
  score: number;
  streak: number;
  avatar_icon: import("@/api/avatarApi").PublicCardIcon | null;
  border: import("@/api/avatarApi").Border | null;
};

type ViewerAllTimeBest = { score: number; streak: number } | null;

// Header copy + payout table for the leaderboard. Until the cutover we show
// both the (one-time) May monthly bonus and the upcoming weekly schedule so
// players see why this month is hot. After cutover, only weekly applies.
function RewardInfo({ cadence }: { cadence: "monthly" | "weekly" | "" }) {
  if (cadence === "weekly") {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        매주 월요일 정산 — 1등 500P · 2등 300P · 3등 200P 지급
      </p>
    );
  }
  return (
    <div className="mb-3 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
      <p>이번 달(5월) 한정 — 1등 <span className="font-bold text-amber-600 dark:text-amber-400">1000P</span> · 2등 500P · 3등 300P 지급</p>
      <p>6월 1일부터 → 매주 월요일 정산 1등 500P · 2등 300P · 3등 200P</p>
    </div>
  );
}

function CardQuiz() {
  const [card, setCard] = useState<QuizCard | null>(null);
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [period, setPeriod] = useState("");
  const [cadence, setCadence] = useState<"monthly" | "weekly" | "">("");
  const [allTimeBest, setAllTimeBest] = useState<ViewerAllTimeBest>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gameOverRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          gameOverRef.current = true;
          setGameOver(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopTimer]);

  const fetchLeaderboard = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    const res = await fetch("/api/quiz/leaderboard/", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    setLeaderboard(data.leaderboard || []);
    setPeriod(data.period || "");
    setCadence(data.cadence || "");
    setAllTimeBest(data.viewer_all_time_best || null);
  }, []);

  const fetchNextCard = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/quiz/next/");
    const data = await res.json();
    setCard(data);
    setResolutionIndex(0);
    setLastAnswer(null);
    setIsCorrect(null);
    setTimeLeft(INITIAL_TIME);
    setLoading(false);
    gameOverRef.current = false;
    startTimer();
  }, [startTimer]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const startGame = () => {
    setScore(0);
    setStreak(0);
    setGameOver(false);
    setSubmitted(false);
    setIsNewRecord(false);
    gameOverRef.current = false;
    fetchNextCard();
  };

  const handleAnswer = async (choice: string) => {
    if (!card || isCorrect !== null || gameOverRef.current) return;

    stopTimer();

    const res = await fetch("/api/quiz/check/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: card.card_id, answer: choice }),
    });
    const data = await res.json();

    setLastAnswer(choice);
    setCorrectAnswer(data.correct_answer);
    setIsCorrect(data.correct);

    if (data.correct) {
      const currentRes = RESOLUTION_STEPS[resolutionIndex];
      const gained = SCORE_MAP[currentRes];
      setScore((prev) => prev + gained);
      setStreak((prev) => prev + 1);

      setTimeout(() => {
        fetchNextCard();
      }, 1200);
    } else {
      setGameOver(true);
      const token = localStorage.getItem("access_token");
      if (token && score > 0) {
        fetch("/api/quiz/submit-score/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ score, streak }),
        })
          .then((r) => r.json())
          .then((d) => { setSubmitted(true); setIsNewRecord(d.is_new_record); fetchLeaderboard(); });
      }
    }
  };

  const handleReveal = () => {
    if (resolutionIndex < RESOLUTION_STEPS.length - 1) {
      setResolutionIndex((prev) => prev + 1);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore
  const handleSubmitScore = async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const res = await fetch("/api/quiz/submit-score/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ score, streak }),
    });
    const data = await res.json();
    setSubmitted(true);
    setIsNewRecord(data.is_new_record);
    fetchLeaderboard();
  };

  const currentRes = RESOLUTION_STEPS[resolutionIndex];
  const currentPoints = SCORE_MAP[currentRes];
  const isLoggedIn = !!localStorage.getItem("access_token");
  const timerPercent = (timeLeft / INITIAL_TIME) * 100;
  const timerColor = timeLeft <= 5 ? "bg-red-500" : timeLeft <= 10 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 md:py-10 max-w-lg md:max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/playground")}
        className="text-lg font-semibold hover:text-blue-600 mb-4"
      >
        ← 놀이터
      </button>
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-6">화질구지 퀴즈</h1>

      {!card && !gameOver && (
        <div className="text-center space-y-6">
          <p className="text-gray-600 dark:text-gray-400 md:text-lg">
            저화질 카드 일러스트를 보고 이름을 맞혀보세요!
          </p>
          <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 md:p-6 text-base md:text-base text-left space-y-1.5 md:space-y-2">
            <p>• 4개의 선택지 중 정답을 고르세요</p>
            <p>• 제한시간 {INITIAL_TIME}초</p>
            <p>• 해상도를 올릴수록 획득 점수가 줄어듭니다</p>
            <p className="text-sm text-gray-400 mt-2">
              8×8: 4점 → 10×10: 3점 → 12×12: 2점 → 16×16: 1점
            </p>
            <p>• 틀리거나 시간 초과 시 게임 오버!</p>
          </div>
          {!isLoggedIn && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              로그인하지 않으면 리더보드에 기록이 남지 않습니다
            </p>
          )}
          <button
            onClick={startGame}
            className="w-full py-3 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            게임 시작
          </button>

          {leaderboard.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-1">리더보드 ({period})</h2>
              <RewardInfo cadence={cadence} />
              {allTimeBest && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  내 역대 최고: <span className="font-semibold">{allTimeBest.score}점</span> <span className="text-gray-400">({allTimeBest.streak}연승)</span>
                </p>
              )}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                {leaderboard.map((entry, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-4 py-2 text-base gap-3 ${
                      i === 0 ? "bg-yellow-50 dark:bg-yellow-900/20 font-bold" : ""
                    } ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 text-center shrink-0">{i === 0 ? "👑" : `${i + 1}.`}</span>
                      <Avatar icon={entry.avatar_icon} border={entry.border} size={32} />
                      <span className="truncate">{entry.username}</span>
                    </div>
                    <span className="font-semibold shrink-0">{entry.score}점 <span className="text-gray-400 font-normal">{entry.streak}연승</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {card && !gameOver && (
        <div className="space-y-4">
          <div className="flex justify-between text-base text-gray-500 dark:text-gray-400">
            <span>연승: <span className="font-bold text-blue-500">{streak}</span></span>
            <span className={`font-bold ${isCorrect ? "text-green-500" : timeLeft <= 5 ? "text-red-500" : ""}`}>
              {isCorrect ? `정답! +${SCORE_MAP[currentRes]}점` : `${timeLeft}초`}
            </span>
            <span>점수: <span className="font-bold text-green-500">{score}</span></span>
          </div>

          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-1000 ${isCorrect ? "bg-green-500" : timerColor}`}
              style={{ width: isCorrect ? "100%" : `${Math.min(timerPercent, 100)}%` }}
            />
          </div>

          <div className="flex justify-center">
            <img
              src={isCorrect ? card.images["original"] : card.images[currentRes]}
              alt="quiz card"
              className="w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 object-contain rounded-lg border dark:border-gray-700 transition-all duration-300"
              style={isCorrect ? {} : { imageRendering: "pixelated" }}
            />
          </div>

          <div className="text-center">
            <span className="text-sm text-gray-400">
              {isCorrect ? correctAnswer : `현재 해상도: ${currentRes} (${currentPoints}점)`}
            </span>
          </div>

          {(() => {
            const canReveal = resolutionIndex < RESOLUTION_STEPS.length - 1 && isCorrect === null;
            return (
              <button
                onClick={handleReveal}
                disabled={!canReveal}
                className={`w-full py-2 rounded-lg text-base transition ${
                  canReveal
                    ? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                }`}
              >
                {canReveal
                  ? `해상도 올리기 → ${RESOLUTION_STEPS[resolutionIndex + 1]} (${SCORE_MAP[RESOLUTION_STEPS[resolutionIndex + 1]]}점)`
                  : "최대 해상도"}
              </button>
            );
          })()}

          <div className="grid grid-cols-1 gap-2">
            {card.choices.map((choice) => {
              let btnClass = "w-full py-3 md:py-4 px-4 rounded-lg text-base font-medium transition text-left ";
              if (isCorrect !== null) {
                if (choice === lastAnswer && !isCorrect) {
                  btnClass += "bg-red-500 text-white";
                } else if (choice === lastAnswer && isCorrect) {
                  btnClass += "bg-green-500 text-white";
                } else {
                  btnClass += "bg-gray-100 dark:bg-gray-700 text-gray-400";
                }
              } else {
                btnClass += "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-gray-700";
              }

              return (
                <button
                  key={choice}
                  onClick={() => handleAnswer(choice)}
                  disabled={isCorrect !== null || loading}
                  className={btnClass}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {gameOver && (
        <div className="text-center space-y-4">
          <h2 className="text-xl font-bold text-red-500">
            {timeLeft <= 0 ? "시간 초과!" : "게임 오버!"}
          </h2>

          {card && (
            <div className="space-y-2">
              <img
                src={card.images["original"]}
                alt="answer"
                className="w-32 h-32 mx-auto rounded-lg border dark:border-gray-700"
                style={{ imageRendering: "pixelated" }}
              />
              <p className="text-base text-gray-500 dark:text-gray-400">
                정답: <span className="font-semibold text-gray-900 dark:text-white">{correctAnswer}</span>
              </p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
            <p className="text-lg">
              최종 점수: <span className="font-bold text-2xl text-blue-500">{score}</span>점
            </p>
            <p className="text-base text-gray-500 dark:text-gray-400">
              연속 {streak}문제 정답
            </p>
          </div>

          {submitted && isNewRecord && (
            <p className="text-yellow-500 font-bold">🎉 새로운 기록!</p>
          )}

          {!isLoggedIn && score > 0 && (
            <p className="text-xs text-gray-400">로그인하면 리더보드에 기록됩니다</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={startGame}
              className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              다시 하기
            </button>
            <button
              onClick={() => { setCard(null); setGameOver(false); fetchLeaderboard(); }}
              className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
            >
              홈으로
            </button>
          </div>

          {leaderboard.length > 0 && (
            <div className="mt-4">
              <h2 className="text-lg font-semibold mb-1">리더보드 ({period})</h2>
              <RewardInfo cadence={cadence} />
              {allTimeBest && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  내 역대 최고: <span className="font-semibold">{allTimeBest.score}점</span> <span className="text-gray-400">({allTimeBest.streak}연승)</span>
                </p>
              )}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                {leaderboard.map((entry, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-4 py-2 text-base gap-3 ${
                      i === 0 ? "bg-yellow-50 dark:bg-yellow-900/20 font-bold" : ""
                    } ${i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 text-center shrink-0">{i === 0 ? "👑" : `${i + 1}.`}</span>
                      <Avatar icon={entry.avatar_icon} border={entry.border} size={32} />
                      <span className="truncate">{entry.username}</span>
                    </div>
                    <span className="font-semibold shrink-0">{entry.score}점 <span className="text-gray-400 font-normal">{entry.streak}연승</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CardQuiz;
