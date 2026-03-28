import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import DuelTracker from "@/api/trackerApi";

export default function Tracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [coinToss, setCoinToss] = useState<string | null>(null);
  const [duelResult, setDuelResult] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState(0);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isNative = Capacitor.isNativePlatform();

  const startTracking = async () => {
    if (!isNative) {
      setError("이 기능은 앱에서만 사용할 수 있습니다.");
      return;
    }

    try {
      setError("");
      setCoinToss(null);
      setDuelResult(null);
      await DuelTracker.startTracking();
      setIsTracking(true);
    } catch (e: any) {
      setError(e.message || "트래킹을 시작할 수 없습니다.");
    }
  };

  const stopTracking = async () => {
    try {
      await DuelTracker.stopTracking();
      setIsTracking(false);
    } catch (e: any) {
      setError(e.message || "트래킹을 중지할 수 없습니다.");
    }
  };

  useEffect(() => {
    if (isTracking && isNative) {
      pollRef.current = setInterval(async () => {
        try {
          const result = await DuelTracker.getLatestResult();
          if (result.timestamp > lastTimestamp) {
            setLastTimestamp(result.timestamp);
            if (result.coinToss) setCoinToss(result.coinToss);
            if (result.duelResult) setDuelResult(result.duelResult);
          }
        } catch {}
      }, 2000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isTracking, isNative, lastTimestamp]);

  const coinLabel = coinToss === "win" ? "앞면 (선공권)" : coinToss === "lose" ? "뒷면" : "-";
  const resultLabel = duelResult === "win" ? "승리" : duelResult === "lose" ? "패배" : "-";

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-center mb-2">듀얼 트래커</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 text-sm">
        마스터 듀얼을 플레이하면 자동으로 전적이 기록됩니다.
      </p>

      {!isNative && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">
            듀얼 트래커는 Android 앱에서만 사용할 수 있습니다.
          </p>
        </div>
      )}

      {isNative && (
        <>
          <div className="flex justify-center mb-6">
            {!isTracking ? (
              <button
                onClick={startTracking}
                className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg"
              >
                트래킹 시작
              </button>
            ) : (
              <button
                onClick={stopTracking}
                className="px-8 py-4 bg-red-500 text-white text-lg font-semibold rounded-xl hover:bg-red-600 transition shadow-lg"
              >
                트래킹 중지
              </button>
            )}
          </div>

          {isTracking && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-6 text-center">
              <p className="text-green-700 dark:text-green-300 text-sm">
                감지 중... 마스터 듀얼로 전환하세요.
              </p>
            </div>
          )}
        </>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 space-y-4">
        <h2 className="font-semibold text-lg">감지된 정보</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">코인토스</p>
            <p className={`text-2xl font-bold mt-1 ${
              coinToss === "win" ? "text-blue-600" : coinToss === "lose" ? "text-red-500" : "text-gray-300 dark:text-gray-600"
            }`}>
              {coinLabel}
            </p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">듀얼 결과</p>
            <p className={`text-2xl font-bold mt-1 ${
              duelResult === "win" ? "text-blue-600" : duelResult === "lose" ? "text-red-500" : "text-gray-300 dark:text-gray-600"
            }`}>
              {resultLabel}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-center text-red-500 mt-4 text-sm">{error}</p>
      )}
    </div>
  );
}
