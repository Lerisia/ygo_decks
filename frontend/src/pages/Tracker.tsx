import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useTracker } from "@/context/TrackerContext";
import { getUserRecordGroups } from "@/api/toolApi";
import { getUserDecks, isAuthenticated } from "@/api/accountApi";
import { RANK_OPTIONS, getValidWinOptions, getRankLabel } from "@/lib/rankUtils";

type RecordGroup = { id: number; name: string };
type Deck = { id: number; name: string };

export default function Tracker() {
  const t = useTracker();
  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [error, setError] = useState("");

  const isNative = Capacitor.isNativePlatform();
  const isLoggedIn = isAuthenticated();

  useEffect(() => {
    if (!isLoggedIn) return;
    getUserRecordGroups().then(setGroups).catch(() => {});
    getUserDecks().then((data) => { if (data.owned_decks) setMyDecks(data.owned_decks); }).catch(() => {});
  }, [isLoggedIn]);

  const handleStart = async () => {
    if (!t.selectedGroup || !t.selectedDeck) { setError("시트와 덱을 선택해주세요."); return; }
    try {
      setError("");
      await t.startTracking();
    } catch (e: any) {
      setError("시작 실패: " + (e.message || JSON.stringify(e)));
    }
  };

  const handleStop = async () => {
    try { await t.stopTracking(); } catch (e: any) { setError(e.message); }
  };

  const selectedDeckName = myDecks.find((d) => d.id === t.selectedDeck)?.name || "선택";
  const winOptions = getValidWinOptions(t.currentRank);

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-center mb-2">듀얼 트래커</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 text-sm">
        마스터 듀얼을 플레이하면 자동으로 전적이 기록됩니다.
      </p>

      {!isLoggedIn && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">로그인 후 사용할 수 있습니다.</p>
        </div>
      )}

      {!isNative && isLoggedIn && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">듀얼 트래커는 Android 앱에서만 사용할 수 있습니다.</p>
        </div>
      )}

      {isLoggedIn && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-3 space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1">기록할 시트</label>
              <select value={t.selectedGroup || ""} onChange={(e) => t.setSelectedGroup(Number(e.target.value) || null)} disabled={t.isTracking}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                <option value="">선택</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={t.useRank} onChange={(e) => t.setUseRank(e.target.checked)} disabled={t.isTracking} className="w-4 h-4" />
              <span className="text-sm font-semibold">랭크 기록</span>
            </label>

            {t.useRank && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">현재 랭크</label>
                  <select value={t.currentRank} onChange={(e) => { t.setCurrentRank(e.target.value); t.setCurrentWins(0); }}
                    disabled={t.isTracking}
                    className="w-full px-2 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                    <option value="">선택</option>
                    {RANK_OPTIONS.slice().reverse().map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">승점</label>
                  <select value={t.currentWins ?? ""} onChange={(e) => t.setCurrentWins(e.target.value === "" ? null : Number(e.target.value))}
                    disabled={t.isTracking}
                    className="w-full px-2 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                    {winOptions.map((w) => <option key={w} value={w}>{w}승</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">내 덱</p>
                <p className="text-lg font-bold mt-1">{selectedDeckName}</p>
              </div>
              <button onClick={() => setShowDeckPicker(!showDeckPicker)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                변경
              </button>
            </div>
            {showDeckPicker && (
              <div className="mt-3 grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {myDecks.map((d) => (
                  <button key={d.id} onClick={() => { t.setSelectedDeck(d.id); setShowDeckPicker(false); }}
                    className={`px-2 py-2 text-xs rounded-lg border transition ${t.selectedDeck === d.id ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"}`}>
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isNative && !t.pendingSave && (
            <div className="mb-4">
              {!t.isTracking ? (
                <button onClick={handleStart} disabled={!t.selectedGroup || !t.selectedDeck}
                  className={`w-full py-4 text-lg font-semibold rounded-xl transition shadow-lg ${!t.selectedGroup || !t.selectedDeck ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                  트래킹 시작
                </button>
              ) : (
                <button onClick={handleStop}
                  className="w-full py-4 bg-red-500 text-white text-lg font-semibold rounded-xl hover:bg-red-600 transition shadow-lg">
                  트래킹 중지
                </button>
              )}
            </div>
          )}

          {t.isTracking && !t.pendingSave && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4 text-center">
              <p className="text-green-700 dark:text-green-300 text-sm">감지 중... 마스터 듀얼로 전환하세요.</p>
              {t.useRank && t.currentRank && (
                <p className="text-green-600 dark:text-green-400 text-xs mt-1">
                  {getRankLabel(t.currentRank)} {t.currentWins !== null ? `${t.currentWins}승` : ""}
                </p>
              )}
              {t.nativeStatus && (
                <p className="text-gray-400 text-xs mt-1">{t.nativeStatus}</p>
              )}
            </div>
          )}

          {t.savedCount > 0 && !t.pendingSave && (
            <p className="text-center text-sm text-green-600 dark:text-green-400">{t.savedCount}전 기록됨</p>
          )}
        </>
      )}

      {error && <p className="text-center text-red-500 mt-4 text-sm">{error}</p>}
    </div>
  );
}
