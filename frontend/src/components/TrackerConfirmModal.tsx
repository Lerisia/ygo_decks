import { useState, useEffect } from "react";
import { useTracker } from "@/context/TrackerContext";
import { getAllDecks } from "@/api/deckApi";
import { getRankLabel } from "@/utils/rankUtils";

type Deck = { id: number; name: string };

export default function TrackerConfirmModal() {
  const t = useTracker();
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [opponentSearch, setOpponentSearch] = useState("");
  const [selectedOpponent, setSelectedOpponent] = useState<number | null>(null);

  useEffect(() => {
    getAllDecks().then((data) => { if (data.decks) setAllDecks(data.decks); }).catch(() => {});
  }, []);

  if (!t.pendingSave) return null;

  const filteredOpponents = opponentSearch
    ? allDecks.filter((d) => d.name.toLowerCase().includes(opponentSearch.toLowerCase())).slice(0, 8)
    : [];

  const handleResultChange = (r: string) => {
    t.setEditResult(r);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-[100] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 space-y-4">
        <h2 className="font-bold text-lg text-center">듀얼 결과 확인</h2>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">코인토스</label>
            <select value={t.editCoin || "win"} onChange={(e) => t.setEditCoin(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
              <option value="win">앞면</option>
              <option value="lose">뒷면</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">선/후공</label>
            <select value={t.editFS || "first"} onChange={(e) => t.setEditFS(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
              <option value="first">선공</option>
              <option value="second">후공</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 text-center">결과</label>
            <select value={t.editResult || "win"} onChange={(e) => handleResultChange(e.target.value)}
              className="w-full px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 text-black dark:text-white">
              <option value="win">승리</option>
              <option value="lose">패배</option>
            </select>
          </div>
        </div>

        {t.useRank && t.currentRank && (
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">랭크 변동</p>
            <p className="text-base font-bold mt-1">
              {getRankLabel(t.currentRank)} {t.currentWins !== null ? `${t.currentWins}승` : ""}
              <span className="mx-2 text-gray-400">→</span>
              <span className={t.previewRank !== t.currentRank ? "text-blue-600" : ""}>
                {getRankLabel(t.previewRank)} {t.previewWins !== null ? `${t.previewWins}승` : ""}
              </span>
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold mb-1">상대 덱 (선택)</label>
          <input type="text" placeholder="덱 이름 검색..." value={opponentSearch}
            onChange={(e) => { setOpponentSearch(e.target.value); setSelectedOpponent(null); }}
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {opponentSearch && filteredOpponents.length > 0 && (
            <div className="max-h-28 overflow-y-auto border rounded-lg mt-1">
              {filteredOpponents.map((d) => (
                <button key={d.id} onClick={() => { setSelectedOpponent(d.id); setOpponentSearch(d.name); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${selectedOpponent === d.id ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600" : ""}`}>
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => { t.saveMatch(selectedOpponent); setOpponentSearch(""); setSelectedOpponent(null); }}
            className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">
            {selectedOpponent ? "저장" : "모름/기타로 저장"}
          </button>
          <button onClick={() => { t.dismissConfirmation(); setOpponentSearch(""); setSelectedOpponent(null); }}
            className="px-4 py-3 bg-gray-200 dark:bg-gray-600 rounded-lg font-semibold transition">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
