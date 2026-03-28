import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import DuelTracker from "@/api/trackerApi";
import { getUserRecordGroups, addMatchToRecordGroup } from "@/api/toolApi";
import { getUserDecks, isAuthenticated } from "@/api/accountApi";
import { getAllDecks } from "@/api/deckApi";
import { RANK_OPTIONS, getNextRankAndWins, getValidWinOptions, getRankLabel } from "@/lib/rankUtils";

type RecordGroup = { id: number; name: string };
type Deck = { id: number; name: string };

export default function Tracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [coinToss, setCoinToss] = useState<string | null>(null);
  const [firstSecond, setFirstSecond] = useState<string | null>(null);
  const [, setDuelResult] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState(0);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<number | null>(null);
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  // Rank tracking
  const [useRank, setUseRank] = useState(false);
  const [currentRank, setCurrentRank] = useState("");
  const [currentWins, setCurrentWins] = useState<number | null>(null);

  // Post-duel confirmation
  const [pendingSave, setPendingSave] = useState(false);
  const [opponentSearch, setOpponentSearch] = useState("");
  const [selectedOpponent, setSelectedOpponent] = useState<number | null>(null);
  const [previewRank, setPreviewRank] = useState("");
  const [previewWins, setPreviewWins] = useState<number | null>(null);

  // Editable detection values for confirmation
  const [editCoin, setEditCoin] = useState<string | null>(null);
  const [editFS, setEditFS] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isNative = Capacitor.isNativePlatform();
  const isLoggedIn = isAuthenticated();

  useEffect(() => {
    if (!isLoggedIn) return;
    getUserRecordGroups().then(setGroups).catch(() => {});
    getUserDecks().then((data) => {
      if (data.owned_decks) setMyDecks(data.owned_decks);
    }).catch(() => {});
    getAllDecks().then((data) => {
      if (data.decks) setAllDecks(data.decks);
    }).catch(() => {});
  }, [isLoggedIn]);

  const startTracking = async () => {
    if (!isNative) { setError("이 기능은 앱에서만 사용할 수 있습니다."); return; }
    if (!selectedGroup || !selectedDeck) { setError("시트와 덱을 선택해주세요."); return; }
    try {
      setError("");
      resetDetection();
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

  const resetDetection = () => {
    setCoinToss(null);
    setFirstSecond(null);
    setDuelResult(null);
    setEditCoin(null);
    setEditFS(null);
    setEditResult(null);
  };

  // When duel result detected, calculate rank preview and show confirmation
  const onDuelDetected = (coin: string | null, fs: string | null, result: string) => {
    setEditCoin(coin);
    setEditFS(fs);
    setEditResult(result);

    if (useRank && currentRank) {
      const { nextRank, nextWins } = getNextRankAndWins(
        currentRank, currentWins, result as "win" | "lose"
      );
      setPreviewRank(nextRank);
      setPreviewWins(nextWins);
    }

    setPendingSave(true);
  };

  const saveMatch = async () => {
    if (!selectedGroup || !selectedDeck || !editResult) return;

    try {
      await addMatchToRecordGroup(selectedGroup, {
        deck: selectedDeck,
        opponent_deck: selectedOpponent,
        coin_toss_result: (editCoin === "win" ? "win" : "lose") as "win" | "lose",
        first_or_second: (editFS === "first" ? "first" : "second") as "first" | "second",
        result: editResult as "win" | "lose",
        rank: useRank ? currentRank : undefined,
        wins: useRank ? currentWins : undefined,
      });

      setSavedCount((c) => c + 1);

      // Update rank after save
      if (useRank && previewRank) {
        setCurrentRank(previewRank);
        setCurrentWins(previewWins);
      }
    } catch (e) {
      console.error("Save failed:", e);
    }

    setPendingSave(false);
    setSelectedOpponent(null);
    setOpponentSearch("");
    resetDetection();
  };

  useEffect(() => {
    if (isTracking && isNative && !pendingSave) {
      pollRef.current = setInterval(async () => {
        try {
          const result = await DuelTracker.getLatestResult();
          if (result.timestamp > lastTimestamp) {
            setLastTimestamp(result.timestamp);
            if (result.coinToss) setCoinToss(result.coinToss);
            if (result.firstSecond) setFirstSecond(result.firstSecond);
            if (result.duelResult) {
              onDuelDetected(result.coinToss || coinToss, result.firstSecond || firstSecond, result.duelResult);
            }
          }
        } catch {}
      }, 2000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isTracking, isNative, lastTimestamp, pendingSave, coinToss, firstSecond]);

  const filteredOpponents = opponentSearch
    ? allDecks.filter((d) => d.name.toLowerCase().includes(opponentSearch.toLowerCase())).slice(0, 10)
    : [];

  const selectedDeckName = myDecks.find((d) => d.id === selectedDeck)?.name || "선택";
  const winOptions = getValidWinOptions(currentRank);

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
          {/* Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-3 space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1">기록할 시트</label>
              <select value={selectedGroup || ""} onChange={(e) => setSelectedGroup(Number(e.target.value) || null)} disabled={isTracking}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                <option value="">선택</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>

            {/* Rank toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useRank} onChange={(e) => setUseRank(e.target.checked)} disabled={isTracking} className="w-4 h-4" />
              <span className="text-sm font-semibold">랭크 기록</span>
            </label>

            {useRank && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">현재 랭크</label>
                  <select value={currentRank} onChange={(e) => { setCurrentRank(e.target.value); setCurrentWins(0); }}
                    disabled={isTracking}
                    className="w-full px-2 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                    <option value="">선택</option>
                    {RANK_OPTIONS.slice().reverse().map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">승점</label>
                  <select value={currentWins ?? ""} onChange={(e) => setCurrentWins(e.target.value === "" ? null : Number(e.target.value))}
                    disabled={isTracking}
                    className="w-full px-2 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm">
                    {winOptions.map((w) => <option key={w} value={w}>{w}승</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* My deck */}
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
                  <button key={d.id} onClick={() => { setSelectedDeck(d.id); setShowDeckPicker(false); }}
                    className={`px-2 py-2 text-xs rounded-lg border transition ${selectedDeck === d.id ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"}`}>
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Start/Stop */}
          {isNative && !pendingSave && (
            <div className="mb-4">
              {!isTracking ? (
                <button onClick={startTracking} disabled={!selectedGroup || !selectedDeck}
                  className={`w-full py-4 text-lg font-semibold rounded-xl transition shadow-lg ${!selectedGroup || !selectedDeck ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                  트래킹 시작
                </button>
              ) : (
                <button onClick={stopTracking}
                  className="w-full py-4 bg-red-500 text-white text-lg font-semibold rounded-xl hover:bg-red-600 transition shadow-lg">
                  트래킹 중지
                </button>
              )}
            </div>
          )}

          {isTracking && !pendingSave && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4 text-center">
              <p className="text-green-700 dark:text-green-300 text-sm">감지 중... 마스터 듀얼로 전환하세요.</p>
              {useRank && currentRank && (
                <p className="text-green-600 dark:text-green-400 text-xs mt-1">
                  {getRankLabel(currentRank)} {currentWins !== null ? `${currentWins}승` : ""}
                </p>
              )}
            </div>
          )}

          {/* Post-duel confirmation */}
          {pendingSave && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4 space-y-4">
              <h2 className="font-bold text-lg text-center">듀얼 결과 확인</h2>

              {/* Editable detection results */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">코인토스</label>
                  <select value={editCoin || ""} onChange={(e) => setEditCoin(e.target.value || null)}
                    className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
                    <option value="win">앞면</option>
                    <option value="lose">뒷면</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">선/후공</label>
                  <select value={editFS || ""} onChange={(e) => setEditFS(e.target.value || null)}
                    className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
                    <option value="first">선공</option>
                    <option value="second">후공</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">결과</label>
                  <select value={editResult || ""} onChange={(e) => {
                    const r = e.target.value;
                    setEditResult(r);
                    if (useRank && currentRank) {
                      const { nextRank, nextWins } = getNextRankAndWins(currentRank, currentWins, r as "win" | "lose");
                      setPreviewRank(nextRank);
                      setPreviewWins(nextWins);
                    }
                  }}
                    className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
                    <option value="win">승리</option>
                    <option value="lose">패배</option>
                  </select>
                </div>
              </div>

              {/* Rank change preview */}
              {useRank && currentRank && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">랭크 변동</p>
                  <p className="text-lg font-bold mt-1">
                    {getRankLabel(currentRank)} {currentWins !== null ? `${currentWins}승` : ""}
                    <span className="mx-2 text-gray-400">→</span>
                    <span className={previewRank !== currentRank ? "text-blue-600" : ""}>
                      {getRankLabel(previewRank)} {previewWins !== null ? `${previewWins}승` : ""}
                    </span>
                  </p>
                </div>
              )}

              {/* Opponent deck search */}
              <div>
                <label className="block text-sm font-semibold mb-1">상대 덱 (선택)</label>
                <input type="text" placeholder="덱 이름 검색..." value={opponentSearch}
                  onChange={(e) => { setOpponentSearch(e.target.value); setSelectedOpponent(null); }}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {opponentSearch && filteredOpponents.length > 0 && (
                  <div className="max-h-32 overflow-y-auto border rounded-lg mt-1">
                    {filteredOpponents.map((d) => (
                      <button key={d.id} onClick={() => { setSelectedOpponent(d.id); setOpponentSearch(d.name); }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${selectedOpponent === d.id ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600" : ""}`}>
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={saveMatch}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">
                {selectedOpponent ? "기록 저장" : "모름/기타로 저장"}
              </button>
            </div>
          )}

          {savedCount > 0 && !pendingSave && (
            <p className="text-center text-sm text-green-600 dark:text-green-400">{savedCount}전 자동 기록됨</p>
          )}
        </>
      )}

      {error && <p className="text-center text-red-500 mt-4 text-sm">{error}</p>}
    </div>
  );
}
