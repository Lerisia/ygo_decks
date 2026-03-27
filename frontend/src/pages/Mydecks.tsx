import { useState, useEffect } from "react";
import { getAllDecks } from "../api/deckApi";
import { getUserDecks, updateUserDecks, updateUserSettings } from "../api/accountApi";
import { useNavigate } from "react-router-dom";

interface Deck {
  id: number;
  name: string;
  cover_image?: string;
}

interface UserDecksResponse {
  owned_decks: Deck[];
  use_custom_lookup: boolean;
}

const Mydecks = () => {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [ownedDecks, setOwnedDecks] = useState<number[]>([]);
  const [showOwnedDecksOnly, setShowOwnedDecksOnly] = useState(false);
  const [excludeOwnedDecks, setExcludeOwnedDecks] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      navigate("/unauthorized");
      return;
    }

    const fetchDecks = async () => {
      try {
        const allDecks = await getAllDecks();
        if (allDecks.decks) setDecks(allDecks.decks);
      } catch (error) {
        console.error("전체 덱 목록 API 호출 실패:", error);
      }
    };

    const fetchUserDecks = async () => {
      try {
        const userDecks: UserDecksResponse = await getUserDecks();
        if (userDecks.owned_decks) {
          setOwnedDecks(userDecks.owned_decks.map((deck: Deck) => deck.id));
        }
        setExcludeOwnedDecks(userDecks.use_custom_lookup);
      } catch (error) {
        console.error("유저 덱 목록 API 호출 실패:", error);
        setOwnedDecks([]);
        setExcludeOwnedDecks(false);
      }
    };

    fetchDecks();
    fetchUserDecks();
  }, [navigate]);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleDeck = (deckId: number) => {
    setOwnedDecks((prev) =>
      prev.includes(deckId) ? prev.filter((id) => id !== deckId) : [...prev, deckId]
    );
  };

  const handleSave = async () => {
    setMessage("저장 중...");
    try {
      await Promise.all([
        updateUserDecks(ownedDecks),
        updateUserSettings(excludeOwnedDecks ?? false),
      ]);
      setMessage("저장되었습니다.");
      setTimeout(() => setMessage(""), 2000);
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      setMessage("저장에 실패했습니다.");
    }
  };

  const displayedDecks = decks
    .filter(deck => !showOwnedDecksOnly || ownedDecks.includes(deck.id))
    .filter(deck => !searchQuery || deck.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="min-h-screen px-4 pt-4 pb-24">
      <h2 className="text-2xl font-semibold text-center mb-4">보유 덱 관리</h2>

      <input
        type="text"
        placeholder="덱 이름 검색..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full max-w-md mx-auto block mb-4 px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-3 text-sm">
        <span>
          보유 <span className="font-semibold text-green-600">{ownedDecks.length}</span>개
        </span>
        <span>
          미보유 <span className="font-semibold text-red-500">{decks.length - ownedDecks.length}</span>개
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mb-4 text-sm">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showOwnedDecksOnly}
            onChange={() => setShowOwnedDecksOnly((prev) => !prev)}
            className="w-4 h-4"
          />
          보유한 덱만 보기
        </label>
        {excludeOwnedDecks !== null && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeOwnedDecks}
              onChange={() => setExcludeOwnedDecks((prev) => !prev)}
              className="w-4 h-4"
            />
            테스트에서 제외
          </label>
        )}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-4">
        {displayedDecks.map((deck) => (
          <div key={deck.id} className="text-center cursor-pointer" onClick={() => toggleDeck(deck.id)}>
            <img
              src={deck.cover_image || "/default_cover.png"}
              alt={deck.name}
              className={`w-full h-20 sm:h-24 md:h-28 object-cover rounded-lg transition ${
                ownedDecks.includes(deck.id) ? "" : "grayscale opacity-50"
              }`}
            />
            <p className="mt-1 text-xs sm:text-sm">{deck.name}</p>
          </div>
        ))}
      </div>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-4 sm:bottom-8 w-10 h-10 bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center text-lg hover:bg-gray-600 transition z-40"
        >
          ↑
        </button>
      )}

      <div className="fixed bottom-16 sm:bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 z-40">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={handleSave}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            저장
          </button>
          {message && (
            <span className="text-sm text-green-600 dark:text-green-400 shrink-0">{message}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default Mydecks;
