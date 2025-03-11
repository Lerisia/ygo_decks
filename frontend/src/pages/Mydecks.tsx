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
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      navigate("/unauthorized");
      return;
    }

    const fetchDecks = async () => {
      try {
        console.log("전체 덱 목록 불러오는 중...");
        const allDecks = await getAllDecks();
        console.log("전체 덱 목록 응답:", allDecks);

        if (allDecks.decks) {
          setDecks(allDecks.decks);
        }
      } catch (error) {
        console.error("전체 덱 목록 API 호출 실패:", error);
      }
    };

    const fetchUserDecks = async () => {
      try {
        console.log("유저 보유 덱 목록 불러오는 중...");
        const userDecks: UserDecksResponse = await getUserDecks();
        console.log("유저 덱 목록 API 응답:", userDecks);

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

  const toggleDeck = (deckId: number) => {
    setOwnedDecks((prev) =>
      prev.includes(deckId) ? prev.filter((id) => id !== deckId) : [...prev, deckId]
    );
  };

  const handleSave = async () => {
    setMessage("저장 중...");
    try {
      const [deckResponse, settingsResponse] = await Promise.all([
        updateUserDecks(ownedDecks),
        updateUserSettings(excludeOwnedDecks ?? false),
      ]);

      console.log("보유 덱 저장 응답:", deckResponse);
      console.log("설정 저장 응답:", settingsResponse);

      setMessage("보유 덱과 설정이 저장되었습니다.");
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      setMessage("저장에 실패했습니다. 다시 시도해주세요.");
    }
  };

  const handleExcludeChange = () => {
    setExcludeOwnedDecks((prev) => !prev);
  };

  const displayedDecks = showOwnedDecksOnly ? decks.filter(deck => ownedDecks.includes(deck.id)) : decks;

  return (
    <div className="h-auto min-h-screen px-4 text-center p-4">
      <h2 className="text-2xl font-semibold text-center mb-4">보유 덱 관리</h2>

      <p className="text-base text-gray-600 mb-4">
        원하는 덱을 찾으려면 <strong>브라우저 검색 기능 (Ctrl+F)</strong>을 사용하세요.
      </p>

      <div className="text-center mb-4">
        <p className="text-lg font-semibold">
          보유한 덱: <span className="text-green-600">{ownedDecks.length}</span>개
        </p>
        <p className="text-lg font-semibold">
          미보유 덱: <span className="text-red-600">{decks.length - ownedDecks.length}</span>개
        </p>
      </div>

      <div className="flex items-center justify-center mb-4">
        <input
          type="checkbox"
          id="showOwnedDecksOnly"
          checked={showOwnedDecksOnly}
          onChange={() => setShowOwnedDecksOnly((prev) => !prev)}
          className="mr-2 w-4 h-4"
        />
        <label htmlFor="showOwnedDecksOnly" className="text-base">
          보유한 덱만 보기
        </label>
      </div>

      {excludeOwnedDecks !== null && (
        <div className="flex items-center justify-center mb-4">
          <input
            type="checkbox"
            id="excludeOwnedDecks"
            checked={excludeOwnedDecks}
            onChange={handleExcludeChange}
            className="mr-2 w-4 h-4"
          />
          <label htmlFor="excludeOwnedDecks" className="text-base">
            성향 테스트에서 보유한 덱 제외
          </label>
        </div>
      )}

      {message && <p className="mt-4 text-green-500">{message}</p>}

      <div className="mb-6 flex justify-center gap-4">
        <button onClick={() => navigate("/mypage")} className="px-4 py-2 bg-gray-500 text-white rounded-lg">
          마이페이지로 돌아가기
        </button>

        <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded-lg">
          저장
        </button>
      </div>

      {/* Filtered decks */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2 md:gap-4 lg:gap-4">
        {displayedDecks.map((deck) => (
          <div key={deck.id} className="text-center cursor-pointer" onClick={() => toggleDeck(deck.id)}>
            <img
              src={deck.cover_image || "/default_cover.png"}
              alt={deck.name}
              className={`w-full h-20 sm:h-24 md:h-28 object-cover rounded-lg ${
                ownedDecks.includes(deck.id) ? "filter-none" : "filter grayscale"
              }`}
            />
            <p className="mt-1 text-sm sm:text-base">{deck.name}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-center">
        <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded-lg">
          저장
        </button>
        {message && <p className="mt-4 text-green-500">{message}</p>}
      </div>
    </div>
  );
};

export default Mydecks;
