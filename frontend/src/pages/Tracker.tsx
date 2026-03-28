import { useState, useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import DuelTracker from "@/api/trackerApi";
import { getUserRecordGroups, addMatchToRecordGroup } from "@/api/toolApi";
import { getUserDecks } from "@/api/accountApi";
import { isAuthenticated } from "@/api/accountApi";
import { getAllDecks } from "@/api/deckApi";

type RecordGroup = { id: number; name: string };
type Deck = { id: number; name: string };

export default function Tracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [coinToss, setCoinToss] = useState<string | null>(null);
  const [firstSecond, setFirstSecond] = useState<string | null>(null);
  const [duelResult, setDuelResult] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState(0);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<number | null>(null);
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  // Post-duel opponent deck selection
  const [pendingSave, setPendingSave] = useState(false);
  const [opponentSearch, setOpponentSearch] = useState("");
  const [selectedOpponent, setSelectedOpponent] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isNative = Capacitor.isNativePlatform();
  const isLoggedIn = isAuthenticated();

  const coinRef = useRef(coinToss);
  const fsRef = useRef(firstSecond);
  coinRef.current = coinToss;
  fsRef.current = firstSecond;

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

  const saveMatch = useCallback(async (opponentDeckId: number | null) => {
    if (!selectedGroup || !selectedDeck) return;

    try {
      await addMatchToRecordGroup(selectedGroup, {
        deck: selectedDeck,
        opponent_deck: opponentDeckId,
        coin_toss_result: (coinRef.current === "win" ? "win" : "lose") as "win" | "lose",
        first_or_second: (fsRef.current === "first" ? "first" : "second") as "first" | "second",
        result: duelResult as "win" | "lose",
      });
      setSavedCount((c) => c + 1);
    } catch (e) {
      console.error("Auto save failed:", e);
    }

    setPendingSave(false);
    setSelectedOpponent(null);
    setOpponentSearch("");
    setCoinToss(null);
    setFirstSecond(null);
    setDuelResult(null);
  }, [selectedGroup, selectedDeck, duelResult]);

  const startTracking = async () => {
    if (!isNative) {
      setError("이 기능은 앱에서만 사용할 수 있습니다.");
      return;
    }
    if (!selectedGroup || !selectedDeck) {
      setError("시트와 덱을 선택해주세요.");
      return;
    }
    try {
      setError("");
      setCoinToss(null);
      setFirstSecond(null);
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
    if (isTracking && isNative && !pendingSave) {
      pollRef.current = setInterval(async () => {
        try {
          const result = await DuelTracker.getLatestResult();
          if (result.timestamp > lastTimestamp) {
            setLastTimestamp(result.timestamp);
            if (result.coinToss) setCoinToss(result.coinToss);
            if (result.firstSecond) setFirstSecond(result.firstSecond);
            if (result.duelResult) {
              setDuelResult(result.duelResult);
              setPendingSave(true);
            }
          }
        } catch {}
      }, 2000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isTracking, isNative, lastTimestamp, pendingSave]);

  const filteredOpponents = opponentSearch
    ? allDecks.filter((d) => d.name.toLowerCase().includes(opponentSearch.toLowerCase()))
    : [];

  const selectedDeckName = myDecks.find((d) => d.id === selectedDeck)?.name || "선택";

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-center mb-2">듀얼 트래커</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 text-sm">
        마스터 듀얼을 플레이하면 자동으로 전적이 기록됩니다.
      </p>

      {!isLoggedIn && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">
            로그인 후 사용할 수 있습니다.
          </p>
        </div>
      )}

      {!isNative && isLoggedIn && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">
            듀얼 트래커는 Android 앱에서만 사용할 수 있습니다.
          </p>
        </div>
      )}

      {isLoggedIn && (
        <>
          {/* Sheet selector - always visible */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
            <label className="block text-sm font-semibold mb-1">기록할 시트</label>
            <select
              value={selectedGroup || ""}
              onChange={(e) => setSelectedGroup(Number(e.target.value) || null)}
              disabled={isTracking}
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm"
            >
              <option value="">선택</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* My deck - tap to change, works during tracking */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">내 덱</p>
                <p className="text-lg font-bold mt-1">{selectedDeckName}</p>
              </div>
              <button
                onClick={() => setShowDeckPicker(!showDeckPicker)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition"
              >
                변경
              </button>
            </div>
            {showDeckPicker && (
              <div className="mt-3 grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {myDecks.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setSelectedDeck(d.id);
                      setShowDeckPicker(false);
                    }}
                    className={`px-2 py-2 text-xs rounded-lg border transition ${
                      selectedDeck === d.id
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Start/Stop */}
          {isNative && (
            <div className="flex justify-center mb-4">
              {!isTracking ? (
                <button
                  onClick={startTracking}
                  disabled={!selectedGroup || !selectedDeck}
                  className={`w-full py-4 text-lg font-semibold rounded-xl transition shadow-lg ${
                    !selectedGroup || !selectedDeck
                      ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  트래킹 시작
                </button>
              ) : (
                <button
                  onClick={stopTracking}
                  className="w-full py-4 bg-red-500 text-white text-lg font-semibold rounded-xl hover:bg-red-600 transition shadow-lg"
                >
                  트래킹 중지
                </button>
              )}
            </div>
          )}

          {isTracking && !pendingSave && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4 text-center">
              <p className="text-green-700 dark:text-green-300 text-sm">
                감지 중... 마스터 듀얼로 전환하세요.
              </p>
            </div>
          )}

          {/* Detection display */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">현재 듀얼</h2>
              {savedCount > 0 && (
                <span className="text-sm text-green-600 dark:text-green-400">
                  {savedCount}전 기록됨
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">코인토스</p>
                <p className={`text-lg font-bold mt-1 ${
                  coinToss === "win" ? "text-blue-600" : coinToss === "lose" ? "text-red-500" : "text-gray-300 dark:text-gray-600"
                }`}>
                  {coinToss === "win" ? "앞면" : coinToss === "lose" ? "뒷면" : "-"}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">선/후공</p>
                <p className={`text-lg font-bold mt-1 ${
                  firstSecond === "first" ? "text-blue-600" : firstSecond === "second" ? "text-orange-500" : "text-gray-300 dark:text-gray-600"
                }`}>
                  {firstSecond === "first" ? "선공" : firstSecond === "second" ? "후공" : "-"}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400">결과</p>
                <p className={`text-lg font-bold mt-1 ${
                  duelResult === "win" ? "text-blue-600" : duelResult === "lose" ? "text-red-500" : "text-gray-300 dark:text-gray-600"
                }`}>
                  {duelResult === "win" ? "승리" : duelResult === "lose" ? "패배" : "-"}
                </p>
              </div>
            </div>
          </div>

          {/* Post-duel: opponent deck selection */}
          {pendingSave && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5 mb-4">
              <h2 className="font-semibold mb-3">상대 덱 (선택)</h2>
              <input
                type="text"
                placeholder="덱 이름 검색..."
                value={opponentSearch}
                onChange={(e) => {
                  setOpponentSearch(e.target.value);
                  setSelectedOpponent(null);
                }}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {opponentSearch && filteredOpponents.length > 0 && (
                <div className="max-h-36 overflow-y-auto border rounded-lg mb-3">
                  {filteredOpponents.slice(0, 10).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        setSelectedOpponent(d.id);
                        setOpponentSearch(d.name);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        selectedOpponent === d.id ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600" : ""
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => saveMatch(selectedOpponent)}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  {selectedOpponent ? "기록 저장" : "모름/기타로 저장"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="text-center text-red-500 mt-4 text-sm">{error}</p>
      )}
    </div>
  );
}
