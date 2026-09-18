import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getRecordGroupMatches, addMatchToRecordGroup, deleteMatchRecord,
         updateRecordGroupName, updateMatchRecord, updateRecordGroupVisibility } from "@/api/toolApi";
import { getTrackerPending, discardTrackerPending } from "@/api/trackerPendingApi";
import type { TrackerPendingMatch } from "@/api/trackerPendingApi";
import TrackerPendingPanel from "@/components/TrackerPendingPanel";
import PcTrackerBanner from "@/components/PcTrackerBanner";
import SheetMembersPanel from "@/components/SheetMembersPanel";
import { getAllDecks } from "@/api/deckApi";
import { getUserDecks } from "@/api/accountApi";
import Select from "react-select";
import { getNextRankState, RANK_OPTIONS, RANK_ORDER, getValidWinOptions as getValidWinOpts } from "@/utils/rankUtils";
import { UNKNOWN_DECK_IMAGE } from "@/utils/deckImages";
import { matchesDeckQuery } from "@/utils/hangul";

const isDark = () => document.documentElement.classList.contains("dark");

const TIER_LABEL: Record<string, string> = { rookie: "루키", bronze: "브론즈", silver: "실버", gold: "골드", platinum: "플래티넘", diamond: "다이아", master: "마스터" };
const tierOf = (rank: string) => rank.replace(/\d+$/, "");
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// local calendar day, matching the server's day totals
const localDayKey = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayLabel = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const thisYear = new Date().getFullYear() === y;
  return `${thisYear ? "" : `${y}년 `}${m}월 ${d}일 (${WEEKDAY[date.getDay()]})`;
};
const timeLabel = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const customSelectStyles = {
  control: (provided: any) => ({
    ...provided,
    backgroundColor: isDark() ? "#374151" : "#fff",
    borderColor: isDark() ? "#4b5563" : "#d1d5db",
    color: isDark() ? "#fff" : "#000",
  }),
  menu: (provided: any) => ({
    ...provided,
    backgroundColor: isDark() ? "#374151" : "#fff",
  }),
  option: (provided: any, state: any) => ({
    ...provided,
    backgroundColor: state.isFocused
      ? (isDark() ? "#4b5563" : "#e5e7eb")
      : (isDark() ? "#374151" : "#fff"),
    color: isDark() ? "#fff" : "#000",
  }),
  singleValue: (provided: any) => ({
    ...provided,
    textAlign: "left",
    color: isDark() ? "#fff" : "#000",
  }),
  placeholder: (provided: any) => ({
    ...provided,
    textAlign: "left",
    color: isDark() ? "#9ca3af" : "#6b7280",
  }),
  input: (provided: any) => ({
    ...provided,
    color: isDark() ? "#fff" : "#000",
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


type Contributor = { id: number; username: string; icon: string | null; border: string | null };

type MatchRecord = {
  id: number;
  recorded_by?: Contributor | null;
  deck: DeckShortData;
  opponent_deck: DeckShortData | null;
  opponent_deck_name: string | null;
  first_or_second: "first" | "second";
  coin_toss_result: "win" | "lose";
  result: "win" | "lose";
  rank: string | null;
  wins: number | null;
  score: number | null;
  score_type: string | null;
  notes: string;
  created_at: string;
};

type DayTotals = Record<string, { count: number; wins: number }>;

type OptionType = {
  value: string;
  label: string;
  aliases?: string[];
};

export const getValidWinOptions = (rank: string): { value: number; label: string }[] => {
  if (!rank) return [];
  return getValidWinOpts(rank).map((w) => ({ value: w, label: `${w}승` }));
};

export const EditMatchModal = ({
  match,
  onClose,
  onUpdated,
  allOptions,
  rankOptions,
}: {
  match: any;
  onClose: () => void;
  onUpdated: () => void;
  ownedDecks: any[];
  allOptions: { value: string; label: string }[];
  rankOptions: { value: string; label: string }[];
}) => {
  const [form, setForm] = useState({
    coin_toss_result: match.coin_toss_result,
    first_or_second: match.first_or_second,
    result: match.result,
    opponent_deck: match.opponent_deck?.id?.toString() || "",
    opponent_deck_name: match.opponent_deck_name || "",
    rank: match.rank || "",
    wins: match.wins || null,
    score: match.score?.toString() || "",
    score_type: match.score_type || "",
    notes: match.notes || "",
  });

  const [useRankOrScore, setUseRankOrScore] = useState("none");

  useEffect(() => {
    if (match.rank) setUseRankOrScore("rank");
    else if (match.score) setUseRankOrScore(match.score_type || "rating");
  }, [match]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    try {
      await updateMatchRecord(match.id, {
        ...form,
        opponent_deck: form.opponent_deck || null,
        opponent_deck_name: form.opponent_deck ? null : (form.opponent_deck_name || null),
        score: form.score ? Number(form.score) : null,
        score_type: form.score ? (form.score_type || null) : null,
        rank: form.rank || null,
      });
      alert("수정 완료!");
      onUpdated();
      onClose();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-[400px] max-w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-5 pt-5 pb-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-bold">기록 수정</h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className={labelClass}>상대 덱</label>
            <select
              value={form.opponent_deck}
              onChange={(e) => setForm({ ...form, opponent_deck: e.target.value })}
              className={selectClass}
            >
              {allOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {(!form.opponent_deck || form.opponent_deck === "null") && (
              <input
                type="text"
                placeholder="상대 덱 이름 직접 입력 (선택)"
                value={form.opponent_deck_name}
                onChange={(e) => setForm({ ...form, opponent_deck_name: e.target.value })}
                className="w-full mt-2 px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>코인토스</label>
              <select name="coin_toss_result" value={form.coin_toss_result} onChange={handleChange} className={selectClass}>
                <option value="win">앞면</option>
                <option value="lose">뒷면</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>선/후공</label>
              <select name="first_or_second" value={form.first_or_second} onChange={handleChange} className={selectClass}>
                <option value="first">선공</option>
                <option value="second">후공</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>결과</label>
              <select name="result" value={form.result} onChange={handleChange} className={selectClass}>
                <option value="win">승리</option>
                <option value="lose">패배</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>랭크/점수</label>
            <select
              value={useRankOrScore}
              onChange={(e) => {
                const value = e.target.value;
                setUseRankOrScore(value);
                setForm((prev) => ({
                  ...prev,
                  rank: "",
                  score: "",
                  wins: null,
                  score_type: ["rating", "duelist_cup", "other"].includes(value) ? value : "",
                }));
              }}
              className={selectClass}
            >
              <option value="none">입력 안 함</option>
              <option value="rank">랭크</option>
              <option value="rating">레이팅</option>
              <option value="duelist_cup">듀얼리스트 컵</option>
              <option value="other">기타</option>
            </select>
          </div>

          {useRankOrScore === "rank" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>랭크</label>
                <select name="rank" value={form.rank} onChange={handleChange} className={selectClass}>
                  <option value="">선택</option>
                  {rankOptions.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>승수</label>
                <select
                  name="wins"
                  value={form.wins ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      wins: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className={selectClass}
                >
                  <option value="">입력 안 함</option>
                  {getValidWinOptions(form.rank).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {["rating", "duelist_cup", "other"].includes(useRankOrScore) && (
            <div>
              <label className={labelClass}>점수</label>
              <input name="score" value={form.score} onChange={handleChange} type="number" className={selectClass} />
            </div>
          )}

          <div>
            <label className={labelClass}>메모</label>
            <input name="notes" value={form.notes} onChange={handleChange} className={selectClass} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">
            취소
          </button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
  const navigate = useNavigate();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [days, setDays] = useState<DayTotals>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  interface MatchForm {
    deck: string;
    opponent_deck: string;
    opponent_deck_name: string;
    first_or_second: string;
    coin_toss_result: string;
    result: string;
    rank: string;
    wins: number | null;
    score: string;
    score_type: string;
    notes: string;
  }
  const [newMatch, setNewMatch] = useState<MatchForm>({
    deck: "",
    opponent_deck: "",
    opponent_deck_name: "",
    first_or_second: "first",
    coin_toss_result: "win",
    result: "win",
    rank: "",
    wins: null,
    score: "",
    score_type: "",
    notes: "",
  });
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [owned_decks, setOwnedDecks] = useState<DeckData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [useRankOrScore, setUseRankOrScore] = useState("none");
  const [editingMatch, setEditingMatch] = useState<any | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [sheetKind, setSheetKind] = useState<"solo" | "shared">("solo");
  const [memberFilter, setMemberFilter] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [winOptions, setWinOptions] = useState<{ value: number; label: string }[]>([]);
  const [lastMatch, setLastMatch] = useState<MatchRecord | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(true);
  const [pending, setPending] = useState<TrackerPendingMatch[]>([]);
  const [activePendingId, setActivePendingId] = useState<number | null>(null);
  const [extraDeck, setExtraDeck] = useState<DeckData | null>(null);

  // RANK_OPTIONS imported from utils/rankUtils

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

  const loadLastMatch = async () => {
    try {
      const data = await getRecordGroupMatches(Number(recordGroupId), 1, 1);
      const list = data.matches || [];
      if (list.length > 0) setLastMatch(list[0]);
    } catch {}
  };

  const loadPending = async () => {
    try {
      setPending(await getTrackerPending());
    } catch {}
  };

  useEffect(() => {
    loadMatches();
    loadDecks();
    loadUserDecks();
    loadLastMatch();
    loadPending();
  }, [page, pageSize, memberFilter]);

  // Games deferred from the tracker overlay show up without a reload.
  useEffect(() => {
    if (!isOwner) return;
    const id = setInterval(loadPending, 15000);
    return () => clearInterval(id);
  }, [isOwner]);

  // Records the tracker saves while this page is open appear on their own. Paused while the tab is hidden
  // or a record is being edited, so nothing shifts under the person's hands.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || editingMatch) return;
      loadMatches();
      loadLastMatch();
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, memberFilter, editingMatch]);

  // Tracker capture → register form. A suggested deck not in the owned list is added to the options for this pick.
  const fillFromPending = (p: TrackerPendingMatch, oppDeckId?: number) => {
    const deckId = p.suggested_deck?.deck_id ?? null;
    if (deckId && !owned_decks.some((d) => d.id === deckId)) {
      const d = decks.find((x) => x.id === deckId);
      if (d) setExtraDeck(d);
    }
    const isRate = p.game_mode === 19;
    setUseRankOrScore(isRate ? "rating" : "rank");
    setNewMatch((prev) => ({
      ...prev,
      deck: deckId ? String(deckId) : "",
      opponent_deck: oppDeckId ? String(oppDeckId) : p.suggested_opp_deck ? String(p.suggested_opp_deck.deck_id) : "null",
      opponent_deck_name: "",
      coin_toss_result: p.coin_win ? "win" : "lose",
      first_or_second: p.first ? "first" : "second",
      result: p.result === "lose" ? "lose" : "win",
      rank: isRate ? "" : p.rank_code || "",
      wins: isRate ? null : p.wins,
      score: isRate && p.rating_after != null ? String(Math.round(p.rating_after)) : "",
      score_type: isRate ? "rating" : "",
      notes: "",
    }));
    setActivePendingId(p.id);
    setShowRegisterForm(true);
  };

  const discardPending = async (id: number) => {
    try {
      await discardTrackerPending(id);
      setPending((list) => list.filter((p) => p.id !== id));
      if (activePendingId === id) setActivePendingId(null);
    } catch (error) {
      console.error("버리기 실패:", error);
    }
  };

  const loadMatches = async () => {
    try {
      const response = await getRecordGroupMatches(Number(recordGroupId), page, pageSize, memberFilter)
      setMatches(response.matches);
      setDays(response.days ?? {});
      setTotalPages(response.total_pages);
      setRecordGroupName(response.record_group_name);
      setIsPublic(response.is_public);
      setIsOwner(response.is_owner);
      setCanWrite(response.can_write ?? response.is_owner);
      setMyRole(response.my_role ?? null);
      setSheetKind(response.kind === "shared" ? "shared" : "solo");
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
  const unknownOption = allOptions.find((opt) => opt.value === "null")!;
  const otherOptions = allOptions.filter(
    (opt) => !recentIds.has(opt.value) && opt.value !== "null"
  );
  const prioritizedOptions = [unknownOption, ...recentOptions, ...otherOptions];

  const handleDelete = async (matchId: number) => {
    try {
      await deleteMatchRecord(matchId);
      await loadMatches();
    } catch (error) {
      console.error("삭제 실패:", error);
    }
  };

  const getValidWinOptions = (rank: string): { value: number; label: string }[] => {
    return getValidWinOpts(rank).map((w) => ({ value: w, label: `${w}승` }));
  };

  
  
 useEffect(() => {
  if (!lastMatch || owned_decks.length === 0) return;

  const matchedDeck = owned_decks.find((d) => d.id === lastMatch.deck?.id);

  const base: Partial<MatchForm> = {
    deck: matchedDeck ? String(matchedDeck.id) : "",
    opponent_deck: "",
    opponent_deck_name: "",
    first_or_second: "first",
    coin_toss_result: "win",
    result: "win",
    notes: "",
  };

  if (lastMatch.rank) {
    setUseRankOrScore("rank");
    const next = getNextRankState(lastMatch.rank, lastMatch.wins ?? null, "win");
    setNewMatch((prev) => ({
      ...prev,
      ...base,
      rank: next.rank,
      wins: next.wins,
      score: "",
      score_type: "",
    }));
  } else if (lastMatch.score) {
    const st = lastMatch.score_type || "rating";
    setUseRankOrScore(st);
    setNewMatch((prev) => ({
      ...prev,
      ...base,
      score: String(lastMatch.score),
      score_type: st,
      rank: "",
      wins: null,
    }));
  } else {
    setUseRankOrScore("none");
    setNewMatch((prev) => ({
      ...prev,
      ...base,
      rank: "",
      score: "",
      score_type: "",
      wins: null,
    }));
  }
}, [lastMatch, owned_decks]);

  const handleRegisterMatch = async () => {
    if (!newMatch.deck) return;
    const oppDeck = newMatch.opponent_deck || "null";
    try {
      await addMatchToRecordGroup(Number(recordGroupId), {
        deck: Number(newMatch.deck),
        opponent_deck: oppDeck === "null" ? null : Number(oppDeck),
        opponent_deck_name: newMatch.opponent_deck_name || null,
        coin_toss_result: newMatch.coin_toss_result as "win" | "lose",
        first_or_second: newMatch.first_or_second as "first" | "second",
        result: newMatch.result as "win" | "lose",
        score: Number(newMatch.score),
        score_type: newMatch.score_type || null,
        rank: newMatch.rank,
        wins: newMatch.wins,
        notes: newMatch.notes,
        tracker_pending_id: activePendingId,
      });
      if (activePendingId) {
        setPending((list) => list.filter((p) => p.id !== activePendingId));
        setActivePendingId(null);
      }
      await loadMatches();
      await loadLastMatch();
    } catch (error) {
      console.error("기록 추가 실패:", error);
    }
  };

  // Any deck can be picked; the ones marked as owned just come first in the list.
  const ownedIds = new Set(owned_decks.map((d) => d.id));
  const deckSource = [...decks.filter((d) => ownedIds.has(d.id)), ...decks.filter((d) => !ownedIds.has(d.id))];
  if (extraDeck && !deckSource.some((d) => d.id === extraDeck.id)) deckSource.push(extraDeck);
  const deckOptions: OptionType[] = deckSource.map((deck) => ({
    value: String(deck.id),
    label: deck.name,
    aliases: decks.find((d) => d.id === deck.id)?.aliases || [],
  }));

  // Shared search for both deck selects: name/alias substring, or initials
  // (with compound jamo expanded) when the query is all consonants.
  const deckFilterOption = (option: { label: string; data: OptionType }, input: string) =>
    matchesDeckQuery(input, option.label, Array.isArray(option.data.aliases) ? option.data.aliases : []);

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

  const getRankOrScoreDisplay = (
    rank: string | null,
    wins: number | null,
    score: number | null
  ): string | null => {
    if (rank) {
      const label = RANK_OPTIONS.find((r) => r.value === rank)?.label || rank;
      return wins !== null ? `${label} · ${wins}승` : label;
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
    { value: "rating", label: "레이팅" },
    { value: "duelist_cup", label: "듀얼리스트 컵" },
    { value: "other", label: "기타" },
  ];

  const rankOptions = RANK_OPTIONS.map((r) => ({
    value: r.value,
    label: r.label,
  }));

  return (
    <div className="px-0 sm:px-4 py-4 min-h-screen max-w-screen-sm mx-auto">
      {myRole && myRole !== "public" && (
        <button
          onClick={() => navigate("/records")}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-2"
        >
          ← 시트 목록
        </button>
      )}
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-1 min-w-0">
          <span className="truncate">{recordGroupName}</span>
          <button onClick={handleEditName} className="shrink-0 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white">
            ✏️
          </button>
        </h1>
        <a
          href={`/record-groups/${recordGroupId}/statistics`}
          className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-semibold hover:bg-blue-700 transition"
        >
          통계
        </a>
      </div>
      {isOwner && (
        <div className="flex items-center gap-3 mb-4 text-sm">
          <button
            onClick={async () => {
              const next = !isPublic;
              await updateRecordGroupVisibility(Number(recordGroupId), next);
              setIsPublic(next);
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              isPublic
                ? "bg-green-500 text-white hover:bg-green-600"
                : "bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            }`}
          >
            {isPublic ? "공개 중" : "비공개"}
          </button>
          {isPublic && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/record-groups/${recordGroupId}`);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
              }}
              className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/50 transition"
            >
              {copiedLink ? "복사됨!" : "링크 복사"}
            </button>
          )}
        </div>
      )}
      {canWrite && <PcTrackerBanner dismissible />}
      {canWrite && (
        <TrackerPendingPanel items={pending} activeId={activePendingId} onFill={fillFromPending} onDiscard={discardPending} />
      )}
      {sheetKind === "shared" && (
        <SheetMembersPanel
          recordGroupId={Number(recordGroupId)}
          memberFilter={memberFilter}
          onFilterChange={(id) => { setMemberFilter(id); setPage(1); }}
          onLeft={() => navigate("/records")}
        />
      )}
      {canWrite && <div className="mb-6 max-w-2xl w-full mx-auto bg-gray-50 dark:bg-gray-800 border-y sm:border border-gray-200 dark:border-gray-700 sm:rounded-xl sm:shadow px-3 py-2 sm:px-4 sm:py-3">
        <button
          type="button"
          onClick={() => setShowRegisterForm((v) => !v)}
          className="w-full flex items-center justify-between py-1 text-left font-semibold text-lg"
        >
          <span>기록 등록</span>
          <span className="text-gray-400 text-sm">{showRegisterForm ? "접기 ▲" : "펼치기 ▼"}</span>
        </button>
        {showRegisterForm && <div className="mt-2 pb-1">
        <div className="flex flex-col gap-2">
          <Select<OptionType>
            options={deckOptions}
            value={deckOptions.find((d) => d.value === newMatch.deck) || null}
            onChange={(selected) =>
              setNewMatch((prev) => ({
                ...prev,
                deck: selected?.value || "",
              }))
            }
            isDisabled={isLoading}
            placeholder="내 덱 선택 (초성·별칭 검색 가능)"
            isClearable
            styles={customSelectStyles}
            filterOption={deckFilterOption}
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
            filterOption={deckFilterOption}
          />
          {newMatch.opponent_deck === "null" && (
            <input
              type="text"
              placeholder="상대 덱 이름 직접 입력 (선택)"
              value={newMatch.opponent_deck_name}
              onChange={(e) => setNewMatch((prev) => ({ ...prev, opponent_deck_name: e.target.value }))}
              className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-left">코인토스</label>
              <div className="flex gap-1">
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
                    className={`flex-1 px-2 py-1.5 rounded border text-sm ${
                      newMatch.coin_toss_result === opt.value
                        ? "bg-blue-500 text-white"
                        : "bg-white dark:bg-gray-800 text-black dark:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-left">선/후공</label>
              <div className="flex gap-1">
                {firstSecondOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setNewMatch((prev) => ({ ...prev, first_or_second: opt.value }))
                    }
                    className={`flex-1 px-2 py-1.5 rounded border text-sm ${
                      newMatch.first_or_second === opt.value
                        ? "bg-blue-500 text-white"
                        : "bg-white dark:bg-gray-800 text-black dark:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium mb-1 text-left">결과</label>
              <div className="flex gap-1">
                {resultOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setNewMatch((prev) => {
                        const updated = { ...prev, result: opt.value };
                        if (lastMatch?.rank && useRankOrScore === "rank") {
                          const next = getNextRankState(
                            lastMatch.rank,
                            lastMatch.wins ?? null,
                            opt.value as "win" | "lose"
                          );
                          updated.rank = next.rank;
                          updated.wins = next.wins;
                        }
                        return updated;
                      });
                    }}
                    className={`flex-1 px-2 py-1.5 rounded border text-sm ${
                      newMatch.result === opt.value
                        ? "bg-blue-500 text-white"
                        : "bg-white dark:bg-gray-800 text-black dark:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
                  setNewMatch((prev) => ({
                    ...prev,
                    rank: "",
                    score: "",
                    score_type: ["rating", "duelist_cup", "other"].includes(value) ? value : "",
                  }));
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
            {["rating", "duelist_cup", "other"].includes(useRankOrScore) && (
              <div>
                <label className="block text-sm font-medium text-left">점수</label>
                <input
                  type="number"
                  className="p-2 border rounded bg-white text-black dark:bg-gray-800 dark:text-white w-full"
                  placeholder={
                    useRankOrScore === "rating" ? "예: 1612" :
                    useRankOrScore === "duelist_cup" ? "예: 23738" : "점수 입력"
                  }
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
          <button onClick={handleRegisterMatch} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
            기록 추가
          </button>
        </div>
        </div>}
      </div>}

      <div className="flex justify-end mb-2">
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
        >
          <option value="10">10개씩 보기</option>
          <option value="20">20개씩 보기</option>
          <option value="50">50개씩 보기</option>
        </select>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 tabular-nums">
        {matches.map((match, i) => {
          const isWin = match.result === "win";
          const dayKey = localDayKey(match.created_at);
          const older = matches[i + 1];
          const showDay = i === 0 || localDayKey(matches[i - 1].created_at) !== dayKey;
          const tally = days[dayKey];
          // rank climbed since the previous record of the same day → ↑, and a tier change gets its own line
          const prevRank = older && localDayKey(older.created_at) === dayKey ? older.rank : null;
          const climbed = isWin && !!match.rank && !!prevRank && RANK_ORDER.indexOf(match.rank) > RANK_ORDER.indexOf(prevRank);
          const promoted = climbed && tierOf(match.rank!) !== tierOf(prevRank!);
          const oppName = match.opponent_deck?.name ?? match.opponent_deck_name ?? "모름/기타";

          return (
            <div key={match.id}>
              {showDay && (
                <div className="flex items-baseline gap-2 pt-4 pb-1.5 text-xs text-gray-400 dark:text-gray-500">
                  <span className="font-semibold text-gray-500 dark:text-gray-400">{dayLabel(dayKey)}</span>
                  {tally && <span className="ml-auto">{tally.count}전 {tally.wins}승 {tally.count - tally.wins}패</span>}
                </div>
              )}
              <div
                className={`group relative grid items-center gap-x-2 sm:gap-x-2.5 px-2 pr-1 border-l-[3px] mb-px
                  grid-cols-[1fr_auto_28px] sm:grid-cols-[1fr_96px_28px_44px_48px] py-2 sm:py-0 sm:min-h-[58px]
                  ${isWin ? "border-l-blue-500 bg-blue-50/70 dark:bg-blue-950/40" : "border-l-red-400 bg-red-50/80 dark:bg-red-950/30"}`}
              >
                <div className="flex items-center gap-2 min-w-0 col-span-2 sm:col-span-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {match.deck.cover_image_small ? (
                      <img src={match.deck.cover_image_small} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
                    )}
                    <span className="truncate text-[15px] font-medium">{match.deck.name}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">vs</span>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img src={match.opponent_deck?.cover_image_small || UNKNOWN_DECK_IMAGE} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                    <span className="truncate text-[15px]">{oppName}</span>
                  </div>
                </div>

                <div className="flex sm:flex-col gap-x-2 gap-y-0.5 text-[13px] leading-tight text-gray-500 dark:text-gray-400 row-start-2 sm:row-start-auto">
                  {sheetKind === "shared" && match.recorded_by && (
                    <span className="flex items-center gap-1 sm:hidden">
                      {match.recorded_by.icon ? (
                        <img src={match.recorded_by.icon} alt="" className={`w-4 h-4 rounded-full object-cover ${match.recorded_by.border ? "ring-2 ring-blue-400" : ""}`} />
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600" />
                      )}
                      {match.recorded_by.username}
                    </span>
                  )}
                  <span className={match.first_or_second === "first" ? "font-semibold text-gray-900 dark:text-gray-100" : "font-medium"}>
                    {match.first_or_second === "first" ? "선공" : "후공"}
                  </span>
                  <span>
                    {getRankOrScoreDisplay(match.rank, match.wins, match.score)}
                    {climbed && <span className="ml-1 font-semibold text-green-700 dark:text-green-400">↑</span>}
                  </span>
                </div>

                <div className="flex justify-center row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto">
                  {match.coin_toss_result && (
                    <img
                      src={match.coin_toss_result === "win" ? "/images/coin_front.png" : "/images/coin_back.png"}
                      alt={match.coin_toss_result === "win" ? "앞면" : "뒷면"}
                      title={match.coin_toss_result === "win" ? "앞면" : "뒷면"}
                      className="w-6 h-6 object-contain"
                    />
                  )}
                </div>

                <div className="text-xs text-gray-400 dark:text-gray-500 text-right row-start-2 col-start-2 sm:row-start-auto sm:col-start-auto">
                  {timeLabel(match.created_at)}
                </div>

                <div className="flex justify-end gap-0.5 row-start-2 col-start-3 sm:row-start-auto sm:col-start-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                  {canWrite && (
                    <>
                      <button onClick={() => setEditingMatch(match)} title="수정" aria-label="수정"
                        className="w-6 h-6 grid place-items-center rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </button>
                      <button onClick={() => { if (confirm("이 기록을 삭제할까요?")) handleDelete(match.id); }} title="삭제" aria-label="삭제"
                        className="w-6 h-6 grid place-items-center rounded text-gray-500 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                      </button>
                    </>
                  )}
                </div>

                {sheetKind === "shared" && match.recorded_by && (
                  <div className="hidden sm:flex absolute right-[132px] top-1 items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 pointer-events-none">
                    {match.recorded_by.icon ? (
                      <img src={match.recorded_by.icon} alt="" className={`w-3.5 h-3.5 rounded-full object-cover ${match.recorded_by.border ? "ring-1 ring-blue-400" : ""}`} />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                    )}
                    {match.recorded_by.username}
                  </div>
                )}

                {match.notes && (
                  <div className="col-span-full text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words pb-1.5 sm:pb-2 sm:-mt-2">
                    {match.notes}
                  </div>
                )}
              </div>
              {promoted && (
                <div className="flex items-center gap-2 pl-3 py-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {TIER_LABEL[tierOf(match.rank!)] ?? match.rank} 승급
                </div>
              )}
            </div>
          );
        })}
        {matches.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">아직 기록이 없습니다.</p>
        )}
      </div>

      <div className="flex justify-center mt-4 gap-2">
        <button
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          disabled={page === 1}
          className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50"
        >
          이전
        </button>
        <span className="px-4 py-2 border rounded">{page} / {totalPages}</span>
        <button
          onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
          disabled={page === totalPages}
          className="px-4 py-2 bg-gray-300 dark:bg-gray-600 rounded disabled:opacity-50"
        >
          다음
        </button>
      </div>
      {editingMatch && (
        <EditMatchModal
          match={editingMatch}
          ownedDecks={deckSource}
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
