import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getRecordGroupMatches, addMatchToRecordGroup, deleteMatchRecord,
         updateRecordGroupName, updateMatchRecord } from "@/api/toolApi";
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

type DeckBase = {
  id: number;
  name: string;
};

type DeckShortData = DeckBase & {
  cover_image_small: string | null;
};

type DeckData = DeckBase & {
  aliases: string[];
};


type MatchRecord = {
  id: number;
  deck: DeckShortData;
  opponent_deck: DeckShortData | null;
  first_or_second: "first" | "second";
  coin_toss_result: "win" | "lose";
  result: "win" | "lose";
  rank: string | null;
  wins: number | null;
  score: number | null;
  notes: string;
};

type OptionType = {
  value: string;
  label: string;
  aliases?: string[];
};

export const getValidWinOptions = (rank: string): { value: number; label: string }[] => {
  if (!rank) return [];

  const onlyZero = [{ value: 0, label: "0승" }];
  const zeroAndOne = [{ value: 0, label: "0승" }, { value: 1, label: "1승" },];
  const zeroToThree = Array.from({ length: 4 }, (_, i) => ({ value: i, label: `${i}승` }));
  const minusThreeToThree = Array.from({ length: 7 }, (_, i) => ({ value: i - 3, label: `${i - 3}승 ` }));
  const minusTwoToThree = Array.from({ length: 6 }, (_, i) => ({ value: i - 2, label: `${i - 2}승` }));
  const zeroToFour = Array.from({ length: 5 }, (_, i) => ({ value: i, label: `${i}승` }));
  const minusTwoToFour = Array.from({ length: 7 }, (_, i) => ({ value: i - 2, label: `${i - 2}승` }));

  if (rank.startsWith("rookie") || rank.startsWith("bronze")) return onlyZero;
  if (rank.startsWith("silver")) return zeroAndOne;
  if (rank.startsWith("gold") || rank === "platinum5" || rank === "diamond5") return zeroToThree;
  if (rank.startsWith("platinum") && rank !== "platinum5") return minusThreeToThree;
  if (rank.startsWith("diamond") && rank !== "diamond5") return minusTwoToThree;
  if (rank === "master5") return zeroToFour;
  if (["master4", "master3", "master2"].includes(rank)) return minusTwoToFour;
  if (rank === "master1") return [];

  return [];
};

export const EditMatchModal = ({
  match,
  onClose,
  onUpdated,
  rankOptions,
}: {
  match: any;
  onClose: () => void;
  onUpdated: () => void;
  ownedDecks: any[];
  allOptions: any[];
  rankOptions: { value: string; label: string }[];
}) => {
  const [form, setForm] = useState({
    coin_toss_result: match.coin_toss_result,
    first_or_second: match.first_or_second,
    result: match.result,
    rank: match.rank || "",
    wins: match.wins || null,
    score: match.score?.toString() || "",
    notes: match.notes || "",
  });

  const [useRankOrScore, setUseRankOrScore] = useState("none");

  useEffect(() => {
    if (match.rank) setUseRankOrScore("rank");
    else if (match.score) setUseRankOrScore("score");
  }, [match]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    try {
      await updateMatchRecord(match.id, {
        ...form,
        score: form.score ? Number(form.score) : null,
        rank: form.rank || null,
      });
      alert("수정 완료!");
      onUpdated();
      onClose();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg w-[400px] max-h-[90vh] overflow-y-auto shadow-lg space-y-4">
        <h2 className="text-lg font-bold">기록 수정</h2>
        <div>
          <label className="block text-sm font-medium">코인토스</label>
          <select
            name="coin_toss_result"
            value={form.coin_toss_result}
            onChange={handleChange}
            className="w-full border rounded p-2 bg-white text-black"
          >
            <option value="win">앞면</option>
            <option value="lose">뒷면</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">선공/후공</label>
          <select
            name="first_or_second"
            value={form.first_or_second}
            onChange={handleChange}
            className="w-full border rounded p-2 bg-white text-black"
          >
            <option value="first">선공</option>
            <option value="second">후공</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">결과</label>
          <select
            name="result"
            value={form.result}
            onChange={handleChange}
            className="w-full border rounded p-2 bg-white text-black"
          >
            <option value="win">승리</option>
            <option value="lose">패배</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">랭크/점수 입력 방식</label>
          <select
            value={useRankOrScore}
            onChange={(e) => {
              setUseRankOrScore(e.target.value);
              setForm((prev) => ({ ...prev, rank: "", score: "" }));
            }}
            className="w-full border rounded p-2 bg-white text-black"
          >
            <option value="none">입력 안 함</option>
            <option value="rank">랭크</option>
            <option value="score">점수</option>
          </select>
        </div>

        {useRankOrScore === "rank" && (
          <>
            <div>
              <label className="block text-sm font-medium">랭크</label>
              <select
                name="rank"
                value={form.rank}
                onChange={handleChange}
                className="w-full border rounded p-2 bg-white text-black"
              >
                <option value="">선택</option>
                {rankOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium">승수</label>
              <select
                name="wins"
                value={form.wins ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    wins: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full border rounded p-2 bg-white text-black"
              >
                <option value="">입력 안 함</option>
                {getValidWinOptions(form.rank).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {useRankOrScore === "score" && (
          <div>
            <label className="block text-sm font-medium">점수</label>
            <input
              name="score"
              value={form.score}
              onChange={handleChange}
              type="number"
              className="w-full border rounded p-2 bg-white text-black"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium">메모</label>
          <input
            name="notes"
            value={form.notes}
            onChange={handleChange}
            className="w-full border rounded p-2 bg-white text-black"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1 rounded border">
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
};


const RecordGroupDetailPage = () => {
  const [recordGroupName, setRecordGroupName] = useState("");
  const { recordGroupId } = useParams();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  interface MatchForm {
    deck: string;
    opponent_deck: string;
    first_or_second: string;
    coin_toss_result: string;
    result: string;
    rank: string;
    wins: number | null;
    score: string;
    notes: string;
  }
  const [newMatch, setNewMatch] = useState<MatchForm>({
    deck: "",
    opponent_deck: "",
    first_or_second: "first",
    coin_toss_result: "win",
    result: "win",
    rank: "",
    wins: null,
    score: "",
    notes: "",
  });
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [owned_decks, setOwnedDecks] = useState<DeckData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [useRankOrScore, setUseRankOrScore] = useState("none");
  const [editingMatch, setEditingMatch] = useState<any | null>(null);
  const [winOptions, setWinOptions] = useState<{ value: number; label: string }[]>([]);

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

  const allOptions: OptionType[] = [
    { value: "null", label: "모름/기타", aliases: [] },
    ...decks.map((deck) => ({
      value: String(deck.id),
      label: deck.name,
      aliases: deck.aliases || [],
    })),
  ];

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

  const getRecentOpponentDeckOptions = (): OptionType[] => {
    const seen = new Set<number>();
    const recent: OptionType[] = [];
  
    for (const match of matches) {
      const opp = match.opponent_deck;
      if (opp && !seen.has(opp.id)) {
        seen.add(opp.id);
        const full = decks.find((d) => d.id === opp.id);
        recent.push({
          value: String(opp.id),
          label: opp.name,
          aliases: full?.aliases || [],
        });
      }
      if (recent.length >= 5) break;
    }
  
    return recent;
  };

  const recentOptions = getRecentOpponentDeckOptions();
  const recentIds = new Set(recentOptions.map((o) => o.value));
  const otherOptions = allOptions.filter((opt) => !recentIds.has(opt.value));
  const prioritizedOptions = [...recentOptions, ...otherOptions];

  const handleDelete = async (matchId: number) => {
    try {
      await deleteMatchRecord(matchId);
      await loadMatches();
    } catch (error) {
      console.error("삭제 실패:", error);
    }
  };

  const getInitials = (text: string): string => {
    const initials = [
      'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ',
      'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ',
      'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
    ];
    return Array.from(text).map(char => {
      const code = char.charCodeAt(0) - 44032;
      if (code >= 0 && code <= 11171) {
        return initials[Math.floor(code / 588)];
      }
      if (initials.includes(char)) return char;
      return '';
    }).join('');
  };

  const getValidWinOptions = (rank: string): { value: number; label: string }[] => {
    if (!rank) return [];
    const onlyZero = [{ value: 0, label: "0승 " }];
    const zeroAndOne = [{ value: 0, label: "0승 " }, { value: 1, label: "1승 " },];
    const zeroToThree = Array.from({ length: 4 }, (_, i) => ({ value: i, label: `${i}승 ` }));
    const minusThreeToThree = Array.from({ length: 7 }, (_, i) => ({ value: i - 3, label: `${i - 3}승  ` }));
    const minusTwoToThree = Array.from({ length: 6 }, (_, i) => ({ value: i - 2, label: `${i - 2}승 ` }));
    const zeroToFour = Array.from({ length: 5 }, (_, i) => ({ value: i, label: `${i}승 ` }));
    const minusTwoToFour = Array.from({ length: 7 }, (_, i) => ({ value: i - 2, label: `${i - 2}승 ` }));
    if (rank.startsWith("rookie") || rank.startsWith("bronze")) return onlyZero;
    if (rank.startsWith("silver")) return zeroAndOne;
    if (rank.startsWith("gold") || rank === "platinum5" || rank === "diamond5") return zeroToThree;
    if (rank.startsWith("platinum") && rank !== "platinum5") return minusThreeToThree;
    if (rank.startsWith("diamond") && rank !== "diamond5") return minusTwoToThree;
    if (rank === "master5") return zeroToFour;
    if (["master4", "master3", "master2"].includes(rank)) return minusTwoToFour;
    if (rank === "master1") return [];
    return [];
  };

  const getUpperRank = (currentRank: string): string => {
    const index = RANK_OPTIONS.findIndex((r) => r.value === currentRank);
    if (index < 0 || index === RANK_OPTIONS.length - 1) return currentRank;
    return RANK_OPTIONS[index + 1].value;
  };
  
  const getLowerRank = (currentRank: string): string => {
    const index = RANK_OPTIONS.findIndex((r) => r.value === currentRank);
    if (index <= 0) return currentRank;
    return RANK_OPTIONS[index - 1].value;
  };

  const getNextRankAndWins = (
    rank: string,
    currentWins: number | null,
    result: "win" | "lose"
  ): { nextRank: string; nextWins: number | null } => {
    if (rank === "master1") return { nextRank: rank, nextWins: null };
  
    if (rank === "rookie2" || rank === "rookie1") {
      const next = getUpperRank(rank);
      return { nextRank: next, nextWins: 0 };
    }
  
    const options = getValidWinOptions(rank).map((o) => o.value);
    const max = Math.max(...options);
    const min = Math.min(...options);

    if (currentWins === null) {
      return { nextRank: rank, nextWins: null };
    }
  
    let newWins = result === "win" ? currentWins + 1 : currentWins - 1;
  
    if (currentWins < 0 && result === "win") {
      newWins = 1;
    }
 
    if (
      result === "lose" &&
      (
        (currentWins === -2 && !options.includes(-3)) ||
        currentWins === -3
      )
    ) {
      const next = getLowerRank(rank);
      return { nextRank: next, nextWins: 0 };
    } 
  
    if (newWins > max) {
      const next = getUpperRank(rank);
      return { nextRank: next, nextWins: 0 };
    }
  
    if (newWins < min) {
      newWins = min;
    }
  
    return { nextRank: rank, nextWins: newWins };
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
      const { nextRank, nextWins } = getNextRankAndWins(
        lastMatch.rank,
        lastMatch.wins ?? null,
        lastMatch.result === "win" ? "win" : "lose"
      );
      setNewMatch((prev) => ({
        ...prev,
        rank: nextRank,
        wins: nextWins,
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
        wins: newMatch.wins,
        notes: newMatch.notes
      });
      await loadMatches();
      setNewMatch({ deck: "", opponent_deck: "", first_or_second: "first",
                    coin_toss_result: "win", result: "win", rank: "", wins: null, score: "", notes: "" });
    } catch (error) {
      console.error("기록 추가 실패:", error);
    }
  };

  const deckOptions = owned_decks.map((deck) => ({
    value: String(deck.id),
    label: deck.name,
  }));

  const handleOpponentDeckChange = (selectedOption: OptionType | null) => {
    setNewMatch((prev) => ({
      ...prev,
      opponent_deck: selectedOption ? selectedOption.value : "",
    }));
  };

  useEffect(() => {
    const options = getValidWinOptions(newMatch.rank);
    setWinOptions(options);
  }, [newMatch.rank]);
  
  useEffect(() => {
    if (
      useRankOrScore === "rank" &&
      newMatch.rank &&
      newMatch.wins != null &&
      winOptions.length > 0
    ) {
      const valid = winOptions.find((opt) => opt.value === newMatch.wins);
      if (!valid) {
        setNewMatch((prev) => ({ ...prev, wins: null }));
      }
    }
  }, [winOptions, newMatch.wins, newMatch.rank, useRankOrScore]);

  const getMobileRankOrScoreDisplay = (
    rank: string | null,
    wins: number | null,
    score: number | null
  ): string | null => {
    if (rank) {
      const match = rank.match(/^([a-z]+)(\d)$/);
      if (!match) return rank;
  
      const tierMap: Record<string, string> = {
        rookie: "루", bronze: "브", silver: "실",
        gold: "골", platinum: "플", diamond: "다", master: "마",
      };
  
      const tier = tierMap[match[1]];
      const level = match[2];
  
      const short = tier ? `${tier}${level}` : rank;
      return wins !== null ? `${short}·${wins}` : short;
    }
  
    if (score !== null) {
      return `${score}`;
    }
  
    return null;
  };
  
  const getRankOrScoreDisplay = (
    rank: string | null,
    wins: number | null,
    score: number | null
  ): string | null => {
    if (rank) {
      const label = RANK_OPTIONS.find((r) => r.value === rank)?.label || rank;
      return wins !== null ? `${label} / ${wins}승` : label;
    }
  
    if (score !== null) {
      return `${score}점`;
    }
  
    return null;
  };

  const coinOptions = [
    { value: "win", label: "앞면" },
    { value: "lose", label: "뒷면" },
  ];
  
  const firstSecondOptions = [
    { value: "first", label: "선공" },
    { value: "second", label: "후공" },
  ];

  const resultOptions = [
    { value: "win", label: "승리" },
    { value: "lose", label: "패배" },
  ];

  const rankTypeOptions = [
    { value: "none", label: "입력 안 함" },
    { value: "rank", label: "랭크" },
    { value: "score", label: "점수" },
  ];

  const rankOptions = RANK_OPTIONS.map((r) => ({
    value: r.value,
    label: r.label,
  }));

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
        <p>
          <a href="/mypage/mydecks" className="underline">
            마이페이지(링크)
          </a>
          에 등록한 덱만 내 덱에 표시됩니다.
        </p>
        <p>
          내 덱이 없다면{" "}
          <a href="/" className="underline">
            메인 화면</a>
          의 오픈채팅방으로 문의주세요.
        </p>
      </div>
      <div className="text-red-600 mb-4 text-center">
        승수 옵션이 새로 추가되어 아직 테스트 중입니다. 버그 제보 주세요!
      </div>

      <div className="p-4 border rounded-lg shadow bg-white mb-6 max-w-2xl w-full mx-auto">
        <h2 className="text-lg font-semibold mb-2">기록 등록</h2>
        <div className="flex flex-col gap-2">
          <Select
            options={deckOptions}
            value={deckOptions.find((d) => d.value === newMatch.deck) || null}
            onChange={(selected) =>
              setNewMatch((prev) => ({
                ...prev,
                deck: selected?.value || "",
              }))
            }
            isDisabled={isLoading}
            placeholder="내 덱 선택"
            isClearable
            styles={customSelectStyles}
            menuPortalTarget={typeof window !== "undefined" ? document.body : null}
          />
          <Select<OptionType>
            options={prioritizedOptions}
            value={prioritizedOptions.find((option) => option.value === newMatch.opponent_deck) || null}
            onChange={handleOpponentDeckChange}
            isDisabled={isLoading}
            placeholder="상대 덱 선택 (초성 검색 가능)"
            isClearable
            styles={customSelectStyles}
            filterOption={(option, input) => {
              const lowered = input.toLowerCase();
              const label = option.label.toLowerCase();
              const isAllInitials = /^[ㄱ-ㅎ]+$/.test(lowered);
              const labelInitials = getInitials(label);

              const labelMatch = label.includes(lowered);
              const aliasMatch = Array.isArray(option.data.aliases)
                ? option.data.aliases.some((alias) =>
                    alias.toLowerCase().includes(lowered)
                  )
                : false;

              if (isAllInitials) {
                const initialsMatch =
                  labelInitials.startsWith(lowered) ||
                  (Array.isArray(option.data.aliases) &&
                    option.data.aliases.some((alias) =>
                      getInitials(alias.toLowerCase()).startsWith(lowered)
                    ));
                return initialsMatch;
              }

              return labelMatch || aliasMatch;
            }}
          />
          <div>
            <label className="block text-sm font-medium mb-1 text-left">코인토스</label>
            <div className="flex gap-2">
              {coinOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setNewMatch((prev) => ({
                      ...prev,
                      coin_toss_result: opt.value,
                      first_or_second: opt.value === "win" ? "first" : "second",
                    }))
                  }
                  className={`px-3 py-1 rounded border ${
                    newMatch.coin_toss_result === opt.value
                      ? "bg-blue-500 text-white"
                      : "bg-white text-black"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-left">선공/후공</label>
            <div className="flex gap-2">
              {firstSecondOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setNewMatch((prev) => ({ ...prev, first_or_second: opt.value }))
                  }
                  className={`px-3 py-1 rounded border ${
                    newMatch.first_or_second === opt.value
                      ? "bg-blue-500 text-white"
                      : "bg-white text-black"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-left">결과</label>
            <div className="flex gap-2">
              {resultOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setNewMatch((prev) => ({ ...prev, result: opt.value }))
                  }
                  className={`px-3 py-1 rounded border ${
                    newMatch.result === opt.value
                      ? "bg-blue-500 text-white"
                      : "bg-white text-black"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <label className="block text-sm font-medium text-left">랭크/점수 입력 방식</label>
              <Select
                options={rankTypeOptions}
                value={rankTypeOptions.find((opt) => opt.value === useRankOrScore)}
                onChange={(selected) => {
                  const value = selected?.value || "none";
                  setUseRankOrScore(value);
                  setNewMatch((prev) => ({ ...prev, rank: "", score: "" }));
                }}
                styles={customSelectStyles}
                menuPortalTarget={typeof window !== "undefined" ? document.body : null}
              />
            </div>

            {useRankOrScore === "rank" && (
            <>
              <div>
                <label className="block text-sm font-medium text-left">랭크</label>
                <Select
                  options={rankOptions.slice().reverse()} // 역순으로 표시
                  value={rankOptions.find((r) => r.value === newMatch.rank)}
                  onChange={(selected) =>
                    setNewMatch((prev) => ({
                      ...prev,
                      rank: selected?.value || "",
                    }))
                  }
                  isClearable
                  styles={customSelectStyles}
                  menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-left">승점</label>
                <Select
                  options={[
                    { value: null, label: "선택 안 함" },
                    ...winOptions,
                  ]}
                  value={
                    winOptions.find((opt) => opt.value === newMatch.wins) ??
                    (newMatch.wins === null ? { value: null, label: "선택 안 함" } : null)
                  }
                  onChange={(selected) =>
                    setNewMatch((prev) => ({
                      ...prev,
                      wins: selected?.value ?? null,
                    }))
                  }
                  isClearable
                  styles={customSelectStyles}
                  placeholder={
                    winOptions.length > 0
                      ? "선택 항목입니다"
                      : "해당 랭크는 승수를 입력하지 않습니다"
                  }
                  isDisabled={winOptions.length === 0}
                />
              </div>
              </>
             )}
            {useRankOrScore === "score" && (
              <div>
                <label className="block text-sm font-medium text-left">점수</label>
                <input
                  type="number"
                  className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white w-full"
                  placeholder="예: 1612 (레이팅) / 23738 (듀얼리스트 컵)"
                  value={newMatch.score}
                  onChange={(e) =>
                    setNewMatch((prev) => ({ ...prev, score: e.target.value }))
                  }
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-left">메모</label>
              <textarea
                value={newMatch.notes}
                onChange={(e) => setNewMatch((prev) => ({ ...prev, notes: e.target.value }))}
                className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white w-full"
                placeholder="메모. 예: '증식의 G 통과', '패 말림' 등"
              />
            </div>
          </div>
          <button onClick={handleRegisterMatch} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            기록 추가
          </button>
        </div>
      </div>
      
      <div className="flex justify-end gap-4 mb-4">
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="p-2 border rounded bg-white text-black"
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

          return (
            <div
              key={match.id}
              className={`border rounded-lg shadow-sm mb-2 ${blockColor}`}
            >
              <div className="flex items-center justify-between p-2 sm:p-3">
                <div className="w-12 sm:w-16 flex justify-center">
                  {coinImg && (
                    <img
                      src={coinImg}
                      alt="코인토스"
                      className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                    />
                  )}
                </div>

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

                <div className="flex-1 px-2 text-center">
                  <p className="text-sm sm:text-base font-semibold">
                    {match.result === "win" ? "승리" : "패배"}
                  </p>
                  <p className="text-xs sm:text-sm">
                    {match.first_or_second === "first" ? "선공" : "후공"}
                  </p>
                  <span className="hidden sm:inline text-sm">
                    {getRankOrScoreDisplay(match.rank, match.wins, match.score)}
                  </span>
                  <span className="inline sm:hidden text-sm">
                    {getMobileRankOrScoreDisplay(match.rank, match.wins, match.score)}
                  </span>
                </div>

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

                <div className="w-12 sm:w-16 flex flex-col items-center gap-1">
                <button
                  onClick={() => {
                    if (confirm("이 기록을 삭제할까요?")) {
                      handleDelete(match.id);
                    }
                  }}
                  className="px-2 py-1 text-xs sm:text-sm bg-red-500 text-white rounded hover:bg-red-600 w-full"
                >
                  삭제
                </button>
                <button
                  onClick={() => setEditingMatch(match)}
                  className="px-2 py-1 text-xs sm:text-sm bg-green-500 text-white rounded hover:bg-green-600 w-full"
                >
                  수정
                </button>
                </div>
              </div>

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
      {editingMatch && (
        <EditMatchModal
          match={editingMatch}
          ownedDecks={owned_decks}
          allOptions={allOptions}
          rankOptions={RANK_OPTIONS}
          onClose={() => setEditingMatch(null)}
          onUpdated={() => {
            loadMatches();
            setEditingMatch(null);
          }}
        />
      )}
    </div>
  );
};

export default RecordGroupDetailPage;
