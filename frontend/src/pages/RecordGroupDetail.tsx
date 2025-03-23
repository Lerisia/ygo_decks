import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getRecordGroupMatches, addMatchToRecordGroup, deleteMatchRecord, updateRecordGroupName } from "@/api/toolApi";
import { getAllDecks } from "@/api/deckApi";
import { getUserDecks } from "@/api/accountApi";
import Select from "react-select";

const customSelectStyles = {
  placeholder: (provided: any) => ({
    ...provided,
    textAlign: "left",
  }),
  singleValue: (provided: any) => ({
    ...provided,
    textAlign: "left",
  }),
};

type DeckShortData = {
  id: number;
  name: string;
  cover_image_small: string | null; 
};

type MatchRecord = {
  id: number;
  deck: DeckShortData;
  opponent_deck: DeckShortData | null;
  first_or_second: "first" | "second";
  coin_toss_result: "win" | "lose";
  result: "win" | "lose";
  rank: string | null;
  score: number | null;
  notes: string;
};

type DeckData = {
  id: number;
  name: string;
};

type OptionType = {
  value: string;
  label: string;
};

const RecordGroupDetailPage = () => {
  const [recordGroupName, setRecordGroupName] = useState("");
  const { recordGroupId } = useParams();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [newMatch, setNewMatch] = useState({
    deck: "",
    opponent_deck: "",
    first_or_second: "first",
    coin_toss_result: "win",
    result: "win",
    rank: "",
    score: "",
    notes: "",
  });
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [owned_decks, setOwnedDecks] = useState<DeckData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [useRankOrScore, setUseRankOrScore] = useState("none");

  const RANK_OPTIONS = [
    { value: "rookie2", label: "루키 2" },
    { value: "rookie1", label: "루키 1" },
  
    { value: "bronze5", label: "브론즈 5" },
    { value: "bronze4", label: "브론즈 4" },
    { value: "bronze3", label: "브론즈 3" },
    { value: "bronze2", label: "브론즈 2" },
    { value: "bronze1", label: "브론즈 1" },
  
    { value: "silver5", label: "실버 5" },
    { value: "silver4", label: "실버 4" },
    { value: "silver3", label: "실버 3" },
    { value: "silver2", label: "실버 2" },
    { value: "silver1", label: "실버 1" },
  
    { value: "gold5", label: "골드 5" },
    { value: "gold4", label: "골드 4" },
    { value: "gold3", label: "골드 3" },
    { value: "gold2", label: "골드 2" },
    { value: "gold1", label: "골드 1" },
  
    { value: "platinum5", label: "플래티넘 5" },
    { value: "platinum4", label: "플래티넘 4" },
    { value: "platinum3", label: "플래티넘 3" },
    { value: "platinum2", label: "플래티넘 2" },
    { value: "platinum1", label: "플래티넘 1" },
  
    { value: "diamond5", label: "다이아 5" },
    { value: "diamond4", label: "다이아 4" },
    { value: "diamond3", label: "다이아 3" },
    { value: "diamond2", label: "다이아 2" },
    { value: "diamond1", label: "다이아 1" },
  
    { value: "master5", label: "마스터 5" },
    { value: "master4", label: "마스터 4" },
    { value: "master3", label: "마스터 3" },
    { value: "master2", label: "마스터 2" },
    { value: "master1", label: "마스터 1" },
  ];

  const handleChangeRankOrScore = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setUseRankOrScore(value);

    if (value === "rank") {
      setNewMatch((prev) => ({ ...prev, score: "", rank: "" }));
    } else if (value === "score") {
      setNewMatch((prev) => ({ ...prev, score: "", rank: "" }));
    } else {
      // none
      setNewMatch((prev) => ({ ...prev, score: "", rank: "" }));
    }
  };

  const handleEditName = async () => {
    const newName = prompt("새로운 시트명을 입력하세요:", recordGroupName);
    if (!newName || newName.trim() === "" || newName === recordGroupName) return;
  
    try {
      await updateRecordGroupName(Number(recordGroupId), newName.trim());
      window.location.reload();
    } catch (error) {
      console.error("시트명 변경 실패:", error);
      alert("시트명 변경에 실패했습니다.");
    }
  };

  useEffect(() => {
    loadMatches();
    loadDecks();
    loadUserDecks();
  }, [page, pageSize]);

  const loadMatches = async () => {
    try {
      const response = await getRecordGroupMatches(Number(recordGroupId), page, pageSize)
      setMatches(response.matches);
      setTotalPages(response.total_pages);
      setRecordGroupName(response.record_group_name); 
    } catch (error) {
      console.error("게임 데이터를 불러오지 못했습니다:", error);
    }
  };
  
  const loadDecks = async () => {
    try {
      setIsLoading(true);
      const response = await getAllDecks();
      console.log("API 응답:", response);
  
      if (response && Array.isArray(response.decks)) {
        setDecks(response.decks);
      } else {
        console.error("덱 데이터가 배열이 아닙니다:", response);
        setDecks([]);
      }
    } catch (error) {
      console.error("덱 목록을 불러오지 못했습니다:", error);
      setDecks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserDecks = async () => {
    try {
      setIsLoading(true);
      const response = await getUserDecks();
  
      if (response && Array.isArray(response.owned_decks)) {
        setOwnedDecks(response.owned_decks);
      } else {
        console.error("덱 데이터가 배열이 아닙니다:", response);
        setOwnedDecks([]);
      }
    } catch (error) {
      console.error("덱 목록을 불러오지 못했습니다:", error);
      setOwnedDecks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (matchId: number) => {
    try {
      await deleteMatchRecord(matchId);
      await loadMatches();
    } catch (error) {
      console.error("삭제 실패:", error);
    }
 };
  
 useEffect(() => {
  if (matches.length > 0 && owned_decks.length > 0) {
    const lastMatch = matches[0];     

    const matchedDeck = owned_decks.find((d) => d.id === lastMatch.deck?.id);
    if (matchedDeck) {
      setNewMatch((prev) => ({
        ...prev,
        deck: String(matchedDeck.id),
      }));
    }

    if (lastMatch.rank) {
      setUseRankOrScore("rank");
      setNewMatch((prev) => ({
        ...prev,
        rank: lastMatch.rank ?? "",
        score: "",
      }));
    } else if (lastMatch.score) {
      setUseRankOrScore("score");
      setNewMatch((prev) => ({
        ...prev,
        score: String(lastMatch.score),
        rank: "",
      }));
    } else {
      setUseRankOrScore("none");
      setNewMatch((prev) => ({
        ...prev,
        rank: "",
        score: "",
      }));
    }
  }
}, [matches, owned_decks]);

  const handleRegisterMatch = async () => {
    if (!newMatch.deck || !newMatch.opponent_deck) return;
    try {
      await addMatchToRecordGroup(Number(recordGroupId), {
        deck: Number(newMatch.deck),
        opponent_deck: newMatch.opponent_deck === "null" ? null : Number(newMatch.opponent_deck),
        coin_toss_result: newMatch.coin_toss_result as "win" | "lose",
        first_or_second: newMatch.first_or_second as "first" | "second",
        result: newMatch.result as "win" | "lose",
        score: Number(newMatch.score),
        rank: newMatch.rank,
        notes: newMatch.notes
      });
      await loadMatches();
      setNewMatch({ deck: "", opponent_deck: "", first_or_second: "first",
                    coin_toss_result: "win", result: "win", score: "", rank:"", notes: "" });
    } catch (error) {
      console.error("기록 추가 실패:", error);
    }
  };

  const handleOpponentDeckChange = (selectedOption: OptionType | null) => {
    setNewMatch((prev) => ({
      ...prev,
      opponent_deck: selectedOption ? selectedOption.value : "",
    }));
  };

  return (
    <div className="px-2 py-4 min-h-screen max-w-screen-sm mx-auto p-4">
      <div className="relative mb-4">
        <h1 className="text-2xl font-bold text-center inline-flex items-center justify-center gap-2 w-full">
          {recordGroupName}
          <button onClick={handleEditName} className="text-gray-500 hover:text-black">
            ✏️
          </button>
        </h1>
        <a
          href={`/record-groups/${recordGroupId}/statistics`}
          className="absolute right-0 top-0 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          통계
        </a>
      </div>
      <div className="text-red-600 mb-4 text-center">
        <span>
          <a href="/mypage/mydecks" className="underline">
            마이페이지
          </a>
          에 등록한 덱만 내 덱에 표시됩니다.
        </span>
      </div>

      <div className="p-4 border rounded-lg shadow bg-white mb-6 max-w-2xl w-full mx-auto">
        <h2 className="text-lg font-semibold mb-2">기록 등록</h2>
        <div className="flex flex-col gap-2">
          <select
            value={newMatch.deck}
            onChange={(e) => setNewMatch({ ...newMatch, deck: e.target.value })}
            className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
            disabled={isLoading}
          >
            {isLoading ? (
              <option>Loading...</option>
            ) : (
              <>
                <option value="">내 덱 선택</option>
                {owned_decks
                  .map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
              </>
            )}
          </select>
          <Select
            options={[
              { value: "null", label: "모름/기타" },
              ...decks.map((deck) => ({ value: String(deck.id), label: deck.name })),
            ]}
            value={
              [{ value: "null", label: "모름/기타" }, ...decks.map((deck) => ({ value: String(deck.id), label: deck.name }))]
                .find((option) => option.value === newMatch.opponent_deck) || null
            }
            onChange={handleOpponentDeckChange}
            isDisabled={isLoading}
            placeholder="상대 덱 선택"
            isClearable
            styles={customSelectStyles}
          />
          <select
            value={newMatch.coin_toss_result}
            onChange={(e) => setNewMatch({ ...newMatch, coin_toss_result: e.target.value })}
            className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
          >
            <option value="win">코인토스 승리</option>
            <option value="lose">코인토스 패배</option>
          </select>
          <select
            value={newMatch.first_or_second}
            onChange={(e) => setNewMatch({ ...newMatch, first_or_second: e.target.value })}
            className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
          >
            <option value="first">선공</option>
            <option value="second">후공</option>
          </select>
          <select
            value={newMatch.result}
            onChange={(e) => setNewMatch({ ...newMatch, result: e.target.value })}
            className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
          >
            <option value="win">승리</option>
            <option value="lose">패배</option>
          </select>
         <div className="flex items-center gap-2">
            <span>랭크/점수:</span>
            <select
              value={useRankOrScore}
              onChange={handleChangeRankOrScore}
              className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
            >
              <option value="none">입력 안 함</option>
              <option value="rank">랭크</option>
              <option value="score">점수</option>
            </select>
          </div>
          {useRankOrScore === "rank" && (
            <select
              value={newMatch.rank}
              onChange={(e) => setNewMatch((prev) => ({ ...prev, rank: e.target.value }))}
              className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
            >
              <option value="">랭크 선택</option>
              {RANK_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {useRankOrScore === "score" && (
            <input
              type="number"
              className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
              placeholder="예: 1612 (레이팅) / 23738 (듀얼리스트 컵)"
              value={newMatch.score}
              onChange={(e) => setNewMatch((prev) => ({ ...prev, score: e.target.value }))}
            />
          )}
          <textarea
            value={newMatch.notes}
            onChange={(e) => setNewMatch((prev) => ({ ...prev, notes: e.target.value }))}
            className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white"
            placeholder="메모. 예: '증식의 G 통과', '패 말림' 등"
          />
          <button onClick={handleRegisterMatch} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            기록 추가
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-4 mb-4">
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="p-2 border rounded"
        >
          <option value="10">10개씩 보기</option>
          <option value="20">20개씩 보기</option>
          <option value="50">50개씩 보기</option>
        </select>
      </div>

      <div className="mt-4">
        {matches.map((match) => {
          const blockColor = match.result === "win" ? "bg-blue-100" : "bg-red-100";
          let coinImg = null;
          if (match.coin_toss_result === "win") {
            coinImg = "/images/coin_front.png";
          } else if (match.coin_toss_result === "lose") {
            coinImg = "/images/coin_back.png";
          }
          
          let rankOrScore = null;
          if (match.rank) {
            const rankLabel = RANK_OPTIONS.find((r) => r.value === match.rank)?.label || match.rank;
            rankOrScore = `${rankLabel}`;
          } else if (match.score) {
            rankOrScore = `${match.score}점`;
          }

          return (
            <div
              key={match.id}
              className={`border rounded-lg shadow-sm mb-2 ${blockColor}`}
            >
              {/* 상단: 전체 정보 flex */}
              <div className="flex items-center justify-between p-2 sm:p-3">
                {/* 코인토스 */}
                <div className="w-12 sm:w-16 flex justify-center">
                  {coinImg && (
                    <img
                      src={coinImg}
                      alt="코인토스"
                      className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                    />
                  )}
                </div>

                {/* 내 덱 */}
                <div className="w-16 sm:w-32 flex flex-col items-center">
                  {match.deck.cover_image_small && (
                    <img
                      src={match.deck.cover_image_small}
                      alt={match.deck.name}
                      className="w-10 h-10 sm:w-16 sm:h-16 object-cover"
                    />
                  )}
                  <p className="text-xs sm:text-sm mt-1 text-center">{match.deck.name}</p>
                </div>

                {/* 가운데 정보 */}
                <div className="flex-1 px-2 text-center">
                  <p className="text-sm sm:text-base font-semibold">
                    {match.result === "win" ? "승리" : "패배"}
                  </p>
                  <p className="text-xs sm:text-sm">
                    {match.first_or_second === "first" ? "선공" : "후공"}
                  </p>
                  {rankOrScore && <p className="text-xs sm:text-sm">{rankOrScore}</p>}
                </div>

                {/* 상대 덱 */}
                <div className="w-16 sm:w-32 flex flex-col items-center">
                  {match.opponent_deck?.cover_image_small && (
                    <img
                      src={match.opponent_deck.cover_image_small}
                      alt={match.opponent_deck.name}
                      className="w-10 h-10 sm:w-16 sm:h-16 object-cover"
                    />
                  )}
                  <p className="text-xs sm:text-sm mt-1 text-center">
                    {match.opponent_deck?.name ?? "모름/기타"}
                  </p>
                </div>

                {/* 삭제 버튼 */}
                <div className="w-12 sm:w-16 flex justify-center">
                  <button
                    onClick={() => handleDelete(match.id)}
                    className="px-2 py-1 text-xs sm:text-sm bg-red-500 text-white rounded hover:bg-red-600 w-full"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 하단: 메모 */}
              {match.notes && (
                <div className="px-4 pb-2 text-xs sm:text-sm text-gray-700 whitespace-pre-wrap break-words">
                  <span className="font-medium"></span> {match.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>


      <div className="flex justify-center mt-4 gap-2">
        <button
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          disabled={page === 1}
          className="px-4 py-2 bg-gray-300 rounded disabled:opacity-50"
        >
          이전
        </button>
        <span className="px-4 py-2 border rounded">{page} / {totalPages}</span>
        <button
          onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
          disabled={page === totalPages}
          className="px-4 py-2 bg-gray-300 rounded disabled:opacity-50"
        >
          다음
        </button>
      </div>
    </div>
  );
};

export default RecordGroupDetailPage;
