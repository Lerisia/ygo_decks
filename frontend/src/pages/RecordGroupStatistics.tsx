import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  getRecordGroupStatisticsFull, getRecordGroupRankHistory, getUserStatisticsFull, getUserRecordGroups, getSheetContributors,
  type SheetContributor, type StatsPeriod,
} from "@/api/toolApi";
import { OTHER_DECK_IMAGE, UNKNOWN_DECK_IMAGE } from "@/utils/deckImages";
import { BarStat, CoinSplit, RankIcon, pctText, rateTone } from "@/components/records/SheetBits";
import { rankIconSrc } from "@/utils/rankUtils";

interface DeckInfo {
  id: number;
  name: string;
  cover_image_small: string | null;
}

interface DeckWinRateStatsItem {
  deck: DeckInfo;
  custom_name: string | null;
  count: number;
  ratio: number;
  total_games: number;
  win_rate: number;
  first_ratio: number;
  first_win_rate: number | null;
  second_win_rate: number | null;
  coin_toss_win_win_rate: number | null;
  coin_toss_lose_win_rate: number | null;
}

interface StatisticsData {
  record_group_name?: string;
  record_groups?: { id: number; name: string }[];
  group_count?: number;
  basic: {
    total_games: number;
    overall_win_rate: number;
    first_ratio: number;
    coin_toss_win_rate: number;
    first_win_rate: number;
    second_win_rate: number;
    coin_toss_win_win_rate: number;
    coin_toss_lose_win_rate: number;
  };
  my_deck_stats: DeckWinRateStatsItem[];
  opponent_deck_stats: DeckWinRateStatsItem[];
  /** 덱별 상세 분석: the same statistics for each of my decks alone (기타 = deck null), most-played first. */
  by_deck?: { deck: DeckInfo | null; stats: StatisticsData }[];
}

interface RankHistoryItem {
  index: number;
  rank: string | null;
  wins: number | null;
  score: number | null;
  result: string;
}

const RANK_ORDER = [
  "rookie2", "rookie1",
  "bronze5", "bronze4", "bronze3", "bronze2", "bronze1",
  "silver5", "silver4", "silver3", "silver2", "silver1",
  "gold5", "gold4", "gold3", "gold2", "gold1",
  "platinum5", "platinum4", "platinum3", "platinum2", "platinum1",
  "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
  "master5", "master4", "master3", "master2", "master1",
];

const RANK_LABELS: Record<string, string> = {
  rookie2: "루키 2", rookie1: "루키 1",
  bronze5: "브론즈 5", bronze4: "브론즈 4", bronze3: "브론즈 3", bronze2: "브론즈 2", bronze1: "브론즈 1",
  silver5: "실버 5", silver4: "실버 4", silver3: "실버 3", silver2: "실버 2", silver1: "실버 1",
  gold5: "골드 5", gold4: "골드 4", gold3: "골드 3", gold2: "골드 2", gold1: "골드 1",
  platinum5: "플래 5", platinum4: "플래 4", platinum3: "플래 3", platinum2: "플래 2", platinum1: "플래 1",
  diamond5: "다이아 5", diamond4: "다이아 4", diamond3: "다이아 3", diamond2: "다이아 2", diamond1: "다이아 1",
  master5: "마스터 5", master4: "마스터 4", master3: "마스터 3", master2: "마스터 2", master1: "마스터 1",
};

const rankToNumeric = (rank: string, wins: number | null): number => {
  const idx = RANK_ORDER.indexOf(rank);
  if (idx === -1) return 0;
  return idx + (wins ?? 0) / 8;
};

// Rank axis label with the tier's emblem in front.
const RankTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value?: number } }) => {
  const rank = RANK_ORDER[payload?.value ?? -1];
  if (!rank) return null;
  const icon = rankIconSrc(rank);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      {icon && <image href={icon} x={-60} y={-8} width={16} height={16} />}
      <text x={-2} y={0} dy={3.5} fontSize={10} textAnchor="end" className="fill-gray-500 dark:fill-gray-400">{RANK_LABELS[rank]}</text>
    </g>
  );
};

const isUnknownDeck = (entry: { deck: DeckInfo | null; custom_name?: string | null }) => !entry.deck && !entry.custom_name;
const getOppDeckName = (entry: { deck: DeckInfo | null; custom_name?: string | null }) => entry.deck?.name || entry.custom_name || "모름/기타";

type PeriodKey = "all" | "7d" | "today" | "range";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "7d", label: "최근 7일" },
  { key: "today", label: "오늘" },
  { key: "range", label: "날짜 고르기" },
];
type SortKey = "count" | "win_rate" | "first_win_rate" | "second_win_rate";
const OPP_SHOWN = 12;

const Card = ({ title, aside, children, flush = false }: { title: string; aside?: React.ReactNode; children: React.ReactNode; flush?: boolean }) => (
  <section className={`rounded-xl border border-gray-200 dark:border-gray-700 ${flush ? "" : "px-3.5 py-3"} flex flex-col gap-2.5`}>
    <div className={`flex justify-between items-baseline gap-2 ${flush ? "px-3.5 pt-3" : ""}`}>
      <h2 className="font-bold text-[15px]">{title}</h2>
      {aside && <span className="text-xs text-gray-500 dark:text-gray-400 text-right">{aside}</span>}
    </div>
    {children}
  </section>
);

// 덱별 상세 분석 (특이점 2026-10-07): one sheet with several decks, each read on its own so their numbers don't mix.
const BY_DECK_KEY = "stats_by_deck";

/** 승률 · 듀얼 · 선공 비율, the first/second bars and the coin block for one set of statistics. */
const Overview = ({ stats }: { stats: StatisticsData }) => {
  const b = stats.basic;
  const games = b.total_games;
  // basic carries rates; the counts behind them come back exactly from rate × games
  const count = (ratePct: number, of: number) => Math.round((ratePct * of) / 100);
  const wins = count(b.overall_win_rate, games);
  const firstGames = count(b.first_ratio, games);
  const secondGames = games - firstGames;
  const coinWinGames = count(b.coin_toss_win_rate, games);
  const coinLoseGames = games - coinWinGames;
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">승률</span>
            <b className="text-2xl leading-tight">{pctText(b.overall_win_rate, 1)}</b>
            <small className="text-xs text-gray-500 dark:text-gray-400">{wins}승 {games - wins}패</small>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">듀얼</span>
            <b className="text-2xl leading-tight">{games}</b>
            <small className="text-xs text-gray-500 dark:text-gray-400">선공 {firstGames} · 후공 {secondGames}</small>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">선공 비율</span>
            <b className="text-2xl leading-tight">{pctText(b.first_ratio)}</b>
            <small className="text-xs text-gray-500 dark:text-gray-400">{firstGames}번 선공</small>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-gray-200 dark:border-gray-700">
          <BarStat label="선공 승률" value={firstGames ? b.first_win_rate : null} sub={`${firstGames}판`} />
          <BarStat label="후공 승률" value={secondGames ? b.second_win_rate : null} sub={`${secondGames}판`} />
        </div>
      </div>

      <CoinSplit
        winGames={coinWinGames}
        winWins={count(b.coin_toss_win_win_rate, coinWinGames)}
        loseGames={coinLoseGames}
        loseWins={count(b.coin_toss_lose_win_rate, coinLoseGames)}
      />
    </>
  );
};

const MyDecksCard = ({ stats }: { stats: StatisticsData }) => {
  const myDecks = [...stats.my_deck_stats]
    .map((s) => (s.deck ? s : { ...s, deck: { id: -1, name: "기타", cover_image_small: OTHER_DECK_IMAGE } as DeckInfo }))
    .sort((a, c) => c.count - a.count);
  return (
    <Card title="내 덱" aside="판수 · 승률">
      <div className="flex flex-col gap-2">
        {myDecks.map((e) => (
          <div key={e.deck.id} className="flex items-center gap-2 text-[13px]">
            <img src={e.deck.cover_image_small || UNKNOWN_DECK_IMAGE} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
            <span className="w-24 shrink-0 break-words leading-tight">{e.deck.name}</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${e.ratio}%` }} />
            </div>
            <b className="w-10 text-right">{e.count}판</b>
            <span className={`w-10 text-right ${rateTone(e.win_rate)}`}>{pctText(e.win_rate)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

const OppDeckTable = ({ stats, sortKey, onSort }: { stats: StatisticsData; sortKey: SortKey; onSort: (k: SortKey) => void }) => {
  const [showAll, setShowAll] = useState(false);
  const sortValue = (e: DeckWinRateStatsItem) => (sortKey === "count" ? e.count : e[sortKey] ?? -1);
  const oppDecks = [...stats.opponent_deck_stats]
    .map((entry) => ({ ...entry, isUnknown: isUnknownDeck(entry), displayName: getOppDeckName(entry) }))
    .sort((a, c) => {
      if (a.isUnknown !== c.isUnknown && sortKey === "count") return a.isUnknown ? 1 : -1;
      return sortValue(c) - sortValue(a) || c.count - a.count;
    });
  const shown = showAll ? oppDecks : oppDecks.slice(0, OPP_SHOWN);
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`px-2 py-1.5 text-right font-semibold ${cls}`}>
      <button type="button" onClick={() => onSort(key)} className={`whitespace-nowrap ${sortKey === key ? "text-gray-900 dark:text-white" : ""}`}>
        {label}{sortKey === key ? " ▾" : ""}
      </button>
    </th>
  );
  return (
    <Card title="상대 덱별" aside={`${oppDecks.length}개 덱 · 제목을 누르면 정렬`} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-y border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-2 pl-3.5 py-1.5 text-left font-semibold">상대 덱</th>
              {th("count", "판")}
              {th("win_rate", "승률")}
              {th("first_win_rate", "선공")}
              {th("second_win_rate", "후공", "pr-3.5")}
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={e.deck?.id ?? `${e.displayName}-${i}`} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="px-2 pl-3.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <img src={(!e.isUnknown && e.deck?.cover_image_small) || UNKNOWN_DECK_IMAGE} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                    <span className="break-words leading-tight">{e.displayName}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right">{e.count}<span className="block text-[10px] text-gray-400">{e.ratio.toFixed(0)}%</span></td>
                <td className={`px-2 py-1.5 text-right ${rateTone(e.win_rate)}`}>{pctText(e.win_rate)}</td>
                <td className={`px-2 py-1.5 text-right text-xs ${rateTone(e.first_win_rate)}`}>{pctText(e.first_win_rate)}</td>
                <td className={`px-2 pr-3.5 py-1.5 text-right text-xs ${rateTone(e.second_win_rate)}`}>{pctText(e.second_win_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {oppDecks.length > OPP_SHOWN && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          {showAll ? "접기" : `나머지 ${oppDecks.length - OPP_SHOWN}개 덱 보기`}
        </button>
      )}
    </Card>
  );
};

const StatisticsPage = () => {
  const { recordGroupId } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [rankHistory, setRankHistory] = useState<RankHistoryItem[]>([]);
  const [curve, setCurve] = useState<"rank" | "score">("rank");
  const [byDeck, setByDeckState] = useState(() => localStorage.getItem(BY_DECK_KEY) === "1");
  const setByDeck = (on: boolean) => {
    setByDeckState(on);
    try { localStorage.setItem(BY_DECK_KEY, on ? "1" : "0"); } catch { /* storage off: the switch just won't stick */ }
  };
  const [mySheets, setMySheets] = useState<{ id: number; name: string }[]>([]);
  const [contributors, setContributors] = useState<SheetContributor[]>([]);
  const [memberFilter, setMemberFilter] = useState<number | null>(null);
  const [rankMember, setRankMember] = useState<number | null>(null);
  const [periodKey, setPeriodKey] = useState<PeriodKey>("all");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const isAggregate = !recordGroupId;

  const period: StatsPeriod | undefined = useMemo(() => {
    if (periodKey === "7d" || periodKey === "today") return { period: periodKey };
    if (periodKey === "range" && (range.from || range.to)) return { date_from: range.from || undefined, date_to: range.to || undefined };
    return undefined;
  }, [periodKey, range]);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) return;
    getUserRecordGroups()
      .then((groups: { id: number; name: string }[]) => setMySheets(groups))
      .catch(() => {});
  }, []);

  // Switching sheets (or to 전체) resets per-sheet state.
  useEffect(() => {
    setStats(null);
  }, [recordGroupId]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!recordGroupId) {
          const statsRes = await getUserStatisticsFull(undefined, period, byDeck);
          setStats(statsRes);
          setRankHistory([]);
          return;
        }
        const [statsRes, rankRes] = await Promise.all([
          getRecordGroupStatisticsFull(Number(recordGroupId), undefined, memberFilter, period, byDeck),
          getRecordGroupRankHistory(Number(recordGroupId), rankMember, period).catch(() => ({ matches: [], member: null })),
        ]);
        setStats(statsRes);
        setRankHistory(rankRes.matches || []);
        // the server decides whose curve to show when nobody is picked; follow it
        if (rankMember === null && rankRes.member?.id) setRankMember(rankRes.member.id);
      } catch (err) {
        console.error("통계 데이터를 불러오지 못했습니다", err);
        if (!recordGroupId) navigate("/unauthorized");
      }
    };
    fetchData();
  }, [recordGroupId, byDeck, memberFilter, rankMember, period, navigate]);

  useEffect(() => {
    if (!recordGroupId) { setContributors([]); return; }
    getSheetContributors(Number(recordGroupId))
      .then((r) => setContributors(r.contributors.filter((c) => c.user)))
      .catch(() => setContributors([]));
  }, [recordGroupId]);

  const rankData = rankHistory.filter((m) => m.rank).map((m, i) => ({
    index: i + 1,
    value: rankToNumeric(m.rank!, m.wins),
    label: `${RANK_LABELS[m.rank!] || m.rank}${m.wins != null ? ` · ${m.wins}승` : ""}`,
  }));
  const scoreData = rankHistory.filter((m) => m.score != null).map((m, i) => ({ index: i + 1, value: m.score!, label: `${m.score}점` }));
  useEffect(() => {
    if (curve === "rank" && rankData.length === 0 && scoreData.length > 0) setCurve("score");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankHistory]);

  const backTo = isAggregate ? "/records" : `/record-groups/${recordGroupId}`;
  const header = (
    <div className="flex items-center justify-between gap-2">
      <button onClick={() => navigate(backTo)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 truncate">
        ← {isAggregate ? "시트 목록" : stats?.record_group_name ?? "시트"}
      </button>
      {mySheets.length > 0 && (isAggregate || mySheets.some((g) => g.id === Number(recordGroupId))) && (
        <select
          value={isAggregate ? "all" : recordGroupId}
          onChange={(e) => navigate(e.target.value === "all" ? "/record-groups/statistics" : `/record-groups/${e.target.value}/statistics`)}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100 max-w-[55%]"
        >
          <option value="all">전체 (모든 시트)</option>
          {mySheets.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}
    </div>
  );

  if (!stats) {
    return (
      <div className="min-h-screen px-4 py-6 max-w-screen-sm mx-auto flex flex-col gap-5" aria-busy>
        {header}
        <div className="h-8 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-8 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-[72px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-[150px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-[260px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  const games = stats.basic.total_games;
  const deckParts = byDeck ? stats.by_deck : undefined;
  // The switch is offered once a sheet holds two or more decks (기타 counts), and stays while it is on.
  const showDeckSwitch = stats.my_deck_stats.length > 1 || byDeck;

  const curveData = curve === "rank" ? rankData : scoreData;
  const yDomain: [number, number] = (() => {
    if (curveData.length === 0) return [0, 1];
    const vals = curveData.map((d) => d.value);
    if (curve === "rank") return [Math.max(0, Math.floor(Math.min(...vals))), Math.min(RANK_ORDER.length - 1, Math.ceil(Math.max(...vals)) + 0)];
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(10, (hi - lo) * 0.1);
    return [Math.floor((lo - pad) / 10) * 10, Math.ceil((hi + pad) / 10) * 10];
  })();
  const rankTicks = curve === "rank" ? Array.from({ length: yDomain[1] - yDomain[0] + 1 }, (_, i) => yDomain[0] + i) : undefined;
  const firstRank = rankHistory.find((m) => m.rank)?.rank;
  const lastRank = [...rankHistory].reverse().find((m) => m.rank)?.rank;

  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-full text-[13px] border whitespace-nowrap transition ${
      on ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
    }`;
  const PersonChips = ({ value, onPick, withAll }: { value: number | null; onPick: (id: number | null) => void; withAll: boolean }) => {
    if (contributors.length < 2) return null;
    const pchip = (on: boolean) =>
      `px-2.5 py-1 rounded-full text-sm border flex items-center gap-1.5 ${
        on ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
      }`;
    return (
      <div className="flex flex-wrap gap-2">
        {withAll && <button type="button" onClick={() => onPick(null)} className={pchip(value === null)}>전체</button>}
        {contributors.map((c) => (
          <button key={c.user!.id} type="button" onClick={() => onPick(c.user!.id)} className={pchip(value === c.user!.id)}>
            {c.user!.icon ? <img src={c.user!.icon} alt="" className="w-5 h-5 rounded-full object-cover" /> : <span className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600" />}
            {c.user!.username}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen px-4 py-6 max-w-screen-sm mx-auto flex flex-col gap-5 tabular-nums">
      {header}
      <div>
        <h1 className="text-2xl font-bold">{isAggregate ? "내 전적 통계" : "통계"}</h1>
        {isAggregate && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">시트 {stats.group_count ?? 0}개에서 내가 기록한 듀얼</p>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" role="tablist" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={periodKey === p.key} onClick={() => setPeriodKey(p.key)} className={chip(periodKey === p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {periodKey === "range" && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" aria-label="시작 날짜" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100" />
            <span className="text-gray-400">~</span>
            <input type="date" aria-label="끝 날짜" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100" />
          </div>
        )}
        {showDeckSwitch && (
          <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-2.5 cursor-pointer">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">덱별 상세 분석</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">여러 덱을 한 시트에 기록했다면, 덱마다 통계를 따로 봅니다</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={byDeck}
              aria-label="덱별 상세 분석"
              onClick={() => setByDeck(!byDeck)}
              className={`relative shrink-0 w-11 h-6 rounded-full p-0 border-0 transition ${byDeck ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${byDeck ? "translate-x-5" : ""}`} />
            </button>
          </label>
        )}
        <PersonChips value={memberFilter} onPick={setMemberFilter} withAll />
      </div>

      {games === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">이 기간에 기록한 듀얼이 없습니다.</p>
      ) : byDeck ? (
        <>
          {deckParts ? (
            <>
              <div className="flex flex-wrap gap-1.5" aria-label="덱 바로 가기">
                {deckParts.map((part, i) => (
                  <button
                    key={part.deck?.id ?? "other"}
                    type="button"
                    onClick={() => document.getElementById(`deck-part-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full text-[13px] bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <img src={part.deck?.cover_image_small || OTHER_DECK_IMAGE} alt="" className="w-5 h-5 rounded-full object-cover" />
                    {part.deck?.name ?? "기타"}
                    <span className="text-gray-500 dark:text-gray-400">{part.stats.basic.total_games}</span>
                  </button>
                ))}
              </div>
              {deckParts.map((part, i) => (
                <section key={part.deck?.id ?? "other"} id={`deck-part-${i}`} className="scroll-mt-24 flex flex-col gap-4 rounded-2xl border border-gray-200 dark:border-gray-700 p-3.5">
                  <header className="flex items-center gap-2.5">
                    <img src={part.deck?.cover_image_small || OTHER_DECK_IMAGE} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold leading-tight break-words">{part.deck?.name ?? "기타"}</h2>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {part.stats.basic.total_games}판 · {isAggregate ? "전체 듀얼의" : "이 시트 듀얼의"} {(() => { const share = (part.stats.basic.total_games / games) * 100; return pctText(share, share < 10 ? 1 : 0); })()}
                      </p>
                    </div>
                  </header>
                  <Overview stats={part.stats} />
                  <OppDeckTable stats={part.stats} sortKey={sortKey} onSort={setSortKey} />
                </section>
              ))}
            </>
          ) : (
            <div className="flex flex-col gap-3" aria-busy>
              <div className="h-7 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
              <div className="h-[320px] rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
          )}
          {!isAggregate && (rankData.length > 0 || scoreData.length > 0) && (
            <Card
              title={curve === "rank" ? "랭크 변화 · 모든 덱" : "점수 변화 · 모든 덱"}
              aside={curve === "rank" && firstRank && lastRank ? (
                <span className="inline-flex items-center gap-1">
                  <RankIcon rank={firstRank} className="w-4 h-4" />{RANK_LABELS[firstRank]} → <RankIcon rank={lastRank} className="w-4 h-4" />{RANK_LABELS[lastRank]}
                </span>
              ) : `${curveData.length}판`}
            >
              <PersonChips value={rankMember} onPick={(id) => id !== null && setRankMember(id)} withAll={false} />
              {rankData.length > 0 && scoreData.length > 0 && (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setCurve("rank")} className={chip(curve === "rank")}>랭크</button>
                  <button type="button" onClick={() => setCurve("score")} className={chip(curve === "score")}>점수</button>
                </div>
              )}
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={curveData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e5e7eb" strokeOpacity={0.7} />
                  <XAxis dataKey="index" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    domain={yDomain}
                    ticks={rankTicks}
                    allowDecimals={curve !== "rank"}
                    tickFormatter={(v: number) => (curve === "rank" ? RANK_LABELS[RANK_ORDER[v]] || "" : String(v))}
                    tick={curve === "rank" ? <RankTick /> : { fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={curve === "rank" ? 64 : 42}
                  />
                  <Tooltip
                    formatter={(_: number, __: string, props: { payload?: { label?: string } }) => [props.payload?.label ?? "", curve === "rank" ? "랭크" : "점수"]}
                    labelFormatter={(v: number) => `${v}번째 듀얼`}
                    contentStyle={{ fontSize: "0.8rem" }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="#2563eb" fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">가로는 듀얼 순서{curve === "rank" ? ", 세로는 랭크 (칸 사이는 승수)" : ""}</p>
            </Card>
          )}

        </>
      ) : (
        <>
          <Overview stats={stats} />
          {!isAggregate && (rankData.length > 0 || scoreData.length > 0) && (
            <Card
              title={curve === "rank" ? "랭크 변화" : "점수 변화"}
              aside={curve === "rank" && firstRank && lastRank ? (
                <span className="inline-flex items-center gap-1">
                  <RankIcon rank={firstRank} className="w-4 h-4" />{RANK_LABELS[firstRank]} → <RankIcon rank={lastRank} className="w-4 h-4" />{RANK_LABELS[lastRank]}
                </span>
              ) : `${curveData.length}판`}
            >
              <PersonChips value={rankMember} onPick={(id) => id !== null && setRankMember(id)} withAll={false} />
              {rankData.length > 0 && scoreData.length > 0 && (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setCurve("rank")} className={chip(curve === "rank")}>랭크</button>
                  <button type="button" onClick={() => setCurve("score")} className={chip(curve === "score")}>점수</button>
                </div>
              )}
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={curveData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e5e7eb" strokeOpacity={0.7} />
                  <XAxis dataKey="index" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    domain={yDomain}
                    ticks={rankTicks}
                    allowDecimals={curve !== "rank"}
                    tickFormatter={(v: number) => (curve === "rank" ? RANK_LABELS[RANK_ORDER[v]] || "" : String(v))}
                    tick={curve === "rank" ? <RankTick /> : { fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={curve === "rank" ? 64 : 42}
                  />
                  <Tooltip
                    formatter={(_: number, __: string, props: { payload?: { label?: string } }) => [props.payload?.label ?? "", curve === "rank" ? "랭크" : "점수"]}
                    labelFormatter={(v: number) => `${v}번째 듀얼`}
                    contentStyle={{ fontSize: "0.8rem" }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="#2563eb" fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">가로는 듀얼 순서{curve === "rank" ? ", 세로는 랭크 (칸 사이는 승수)" : ""}</p>
            </Card>
          )}

          <MyDecksCard stats={stats} />
          <OppDeckTable stats={stats} sortKey={sortKey} onSort={setSortKey} />
        </>
      )}
    </div>
  );
};

export default StatisticsPage;
