import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { getRecordGroupStatisticsFull, getRecordGroupRankHistory } from "@/api/toolApi";

interface DeckInfo {
  id: number;
  name: string;
  cover_image_small: string | null;
}

interface DeckWinRateStatsItem {
  deck: DeckInfo;
  count: number;
  ratio: number;
  total_games: number;
  total_wins: number;
  win_rate: number;
  first_ratio: number;
  first_win_rate: number | null;
  second_win_rate: number | null;
  coin_toss_win_win_rate: number | null;
  coin_toss_lose_win_rate: number | null;
}

interface StatisticsData {
  record_group_name: string;
  basic: {
    total_games: number;
    total_wins: number;
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

const isUnknownDeck = (entry: { deck: DeckInfo | null }) =>
  !entry.deck || !entry.deck.name?.trim();

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
    <p className="text-lg font-bold">{value}</p>
  </div>
);

const DeckRow = ({ image, name, children }: { image: string | null; name: string; children: React.ReactNode }) => (
  <tr>
    <td className="px-2 py-1.5">
      <div className="flex items-center gap-2">
        {image ? (
          <img src={image} alt={name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-6 h-6 rounded bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
        )}
        <span className="truncate">{name}</span>
      </div>
    </td>
    {children}
  </tr>
);

const StatisticsPage = () => {
  const { recordGroupId } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [rankHistory, setRankHistory] = useState<RankHistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"basic" | "deck" | "rankChange">("basic");
  const [rankSubTab, setRankSubTab] = useState<"rank" | "score">("rank");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, rankRes] = await Promise.all([
          getRecordGroupStatisticsFull(Number(recordGroupId)),
          getRecordGroupRankHistory(Number(recordGroupId)),
        ]);
        setStats(statsRes);
        setRankHistory(rankRes.matches || []);
      } catch (err) {
        console.error("통계 데이터를 불러오지 못했습니다", err);
      }
    };
    fetchData();
  }, [recordGroupId]);

  if (!stats) return <div className="p-6">로딩 중...</div>;

  const totalWins = Math.round(stats.basic.total_games * stats.basic.overall_win_rate / 100);
  const totalLosses = stats.basic.total_games - totalWins;

  const myDecks = [...stats.my_deck_stats].sort((a, b) => b.count - a.count);
  const oppDecks = [...stats.opponent_deck_stats]
    .map((entry) => ({ ...entry, isUnknown: isUnknownDeck(entry) }))
    .sort((a, b) => {
      if (a.isUnknown && !b.isUnknown) return 1;
      if (!a.isUnknown && b.isUnknown) return -1;
      return b.count - a.count;
    });

  const rankData = rankHistory
    .filter((m) => m.rank)
    .map((m) => ({
      index: m.index,
      value: rankToNumeric(m.rank!, m.wins),
      result: m.result,
      label: `${RANK_LABELS[m.rank!] || m.rank}${m.wins != null ? ` / ${m.wins}승` : ""}`,
    }));

  const scoreData = rankHistory
    .filter((m) => m.score != null)
    .map((m) => ({
      index: m.index,
      value: m.score!,
      result: m.result,
      label: `${m.score}점`,
    }));

  // Y축에 표시할 랭크 틱 계산
  const rankTicks = (() => {
    if (rankData.length === 0) return [];
    const values = rankData.map((d) => d.value);
    const minVal = Math.floor(Math.min(...values));
    const maxVal = Math.ceil(Math.max(...values));
    const ticks: number[] = [];
    for (let i = Math.max(0, minVal - 1); i <= Math.min(RANK_ORDER.length - 1, maxVal + 1); i++) {
      ticks.push(i);
    }
    return ticks;
  })();

  const tabClass = (tab: string) =>
    `px-4 py-2 font-semibold ${activeTab === tab ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 dark:text-gray-400"}`;

  const subTabClass = (tab: string) =>
    `px-3 py-1.5 text-sm rounded-full ${rankSubTab === tab ? "bg-blue-500 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`;

  return (
    <div className="min-h-screen px-4 py-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate(`/record-groups/${recordGroupId}`)}
        className="text-lg font-semibold hover:text-blue-600 mb-4"
      >
        ← {stats.record_group_name}
      </button>

      <div className="flex justify-center gap-4 mb-6 border-b dark:border-gray-700 pb-2">
        <button onClick={() => setActiveTab("basic")} className={tabClass("basic")}>요약</button>
        <button onClick={() => setActiveTab("deck")} className={tabClass("deck")}>덱별 통계</button>
        <button onClick={() => setActiveTab("rankChange")} className={tabClass("rankChange")}>랭크 변화</button>
      </div>

      {activeTab === "basic" && (
        <div className="space-y-8">
          {/* 전적 요약 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">전적</h2>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              <StatCard label="총 게임" value={stats.basic.total_games} />
              <StatCard label="승률" value={`${stats.basic.overall_win_rate.toFixed(1)}%`} />
              <StatCard label="승리" value={totalWins} />
              <StatCard label="패배" value={totalLosses} />
            </div>
          </section>

          {/* 선후공 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">선후공</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <StatCard label="선공 비율" value={`${stats.basic.first_ratio.toFixed(1)}%`} />
              <StatCard label="선공 승률" value={`${stats.basic.first_win_rate.toFixed(1)}%`} />
              <StatCard label="후공 승률" value={`${stats.basic.second_win_rate.toFixed(1)}%`} />
            </div>
          </section>

          {/* 코인토스 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">코인토스</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <StatCard label="코인 승률" value={`${stats.basic.coin_toss_win_rate.toFixed(1)}%`} />
              <StatCard label="앞면 시 승률" value={`${stats.basic.coin_toss_win_win_rate.toFixed(1)}%`} />
              <StatCard label="뒷면 시 승률" value={`${stats.basic.coin_toss_lose_win_rate.toFixed(1)}%`} />
            </div>
          </section>

          {/* 내 덱 사용 비율 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">내 덱 사용 비율</h2>
            <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-4">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart style={{ overflow: 'visible' }}>
                  <Pie data={myDecks} dataKey="ratio" nameKey="deck.name" cx="50%" cy="50%" outerRadius={110} label={false}>
                    {myDecks.map((entry) => (
                      <Cell key={entry.deck.id} fill={`url(#image-${entry.deck.id})`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} contentStyle={{ fontSize: '0.875rem' }} />
                  <defs>
                    {myDecks.map((entry) => (
                      <pattern id={`image-${entry.deck.id}`} key={entry.deck.id} patternUnits="objectBoundingBox" width={1} height={1}>
                        <image href={entry.deck.cover_image_small || ""} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
                      </pattern>
                    ))}
                  </defs>
                </PieChart>
              </ResponsiveContainer>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left px-2 pb-2 w-[70%]">덱</th>
                    <th className="text-right px-2 pb-2 w-[30%]">비율</th>
                  </tr>
                </thead>
                <tbody>
                  {myDecks.map((entry) => (
                    <DeckRow key={entry.deck.id} image={entry.deck.cover_image_small} name={entry.deck.name}>
                      <td className="text-right px-2 py-1.5">{entry.ratio.toFixed(1)}%</td>
                    </DeckRow>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 상대 덱 비율 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">상대 덱 비율</h2>
            <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-4">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart style={{ overflow: 'visible' }}>
                  <Pie data={oppDecks} dataKey="ratio" nameKey="deck.name" cx="50%" cy="50%" outerRadius={110} label={false}>
                    {oppDecks.map((entry, i) =>
                      isUnknownDeck(entry)
                        ? <Cell key={`unknown-${i}`} fill="#000" />
                        : <Cell key={entry.deck.id} fill={`url(#image-oppo-${entry.deck.id})`} />
                    )}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} contentStyle={{ fontSize: '0.875rem' }} />
                  <defs>
                    {oppDecks.map((entry) => {
                      if (isUnknownDeck(entry)) return null;
                      return (
                        <pattern id={`image-oppo-${entry.deck.id}`} key={entry.deck.id} patternUnits="objectBoundingBox" width={1} height={1}>
                          <image href={entry.deck.cover_image_small || ""} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
                        </pattern>
                      );
                    })}
                  </defs>
                </PieChart>
              </ResponsiveContainer>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left px-2 pb-2 w-[70%]">덱</th>
                    <th className="text-right px-2 pb-2 w-[30%]">비율</th>
                  </tr>
                </thead>
                <tbody>
                  {oppDecks.map((entry, i) => (
                    <DeckRow
                      key={entry.deck?.id ?? `unknown-${i}`}
                      image={isUnknownDeck(entry) ? null : entry.deck?.cover_image_small}
                      name={isUnknownDeck(entry) ? "모름/기타" : entry.deck?.name}
                    >
                      <td className="text-right px-2 py-1.5">{entry.ratio.toFixed(1)}%</td>
                    </DeckRow>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 내 덱 별 승률 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">내 덱별 승률</h2>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700">
                  <th className="text-left px-2 pb-2 w-[60%]">덱</th>
                  <th className="text-right px-2 pb-2 w-[20%]">횟수</th>
                  <th className="text-right px-2 pb-2 w-[20%]">승률</th>
                </tr>
              </thead>
              <tbody>
                {myDecks.map((entry) => (
                  <DeckRow key={entry.deck.id} image={entry.deck.cover_image_small} name={entry.deck.name}>
                    <td className="text-right px-2 py-1.5">{entry.total_games}</td>
                    <td className="text-right px-2 py-1.5">{entry.win_rate.toFixed(1)}%</td>
                  </DeckRow>
                ))}
              </tbody>
            </table>
          </section>

          {/* 상대 덱 별 승률 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">상대 덱별 승률</h2>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700">
                  <th className="text-left px-2 pb-2 w-[60%]">덱</th>
                  <th className="text-right px-2 pb-2 w-[20%]">횟수</th>
                  <th className="text-right px-2 pb-2 w-[20%]">승률</th>
                </tr>
              </thead>
              <tbody>
                {oppDecks.map((entry, i) => (
                  <DeckRow
                    key={entry.deck?.id ?? `unknown-${i}`}
                    image={isUnknownDeck(entry) ? null : entry.deck?.cover_image_small}
                    name={isUnknownDeck(entry) ? "모름/기타" : entry.deck?.name}
                  >
                    <td className="text-right px-2 py-1.5">{entry.total_games}</td>
                    <td className="text-right px-2 py-1.5">{entry.win_rate.toFixed(1)}%</td>
                  </DeckRow>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {activeTab === "deck" && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">상대 덱별 세부 통계</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm table-fixed">
              <thead>
                <tr className="border-b dark:border-gray-700">
                  <th className="text-left px-2 pb-2 w-[20%] sm:w-[15%]">덱</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">등장</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">등장률</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">승률</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">선공률</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">선공 승</th>
                  <th className="text-right px-2 pb-2 w-[13%] sm:w-[12%]">후공 승</th>
                </tr>
              </thead>
              <tbody>
                {oppDecks.map((entry, i) => (
                  <tr key={entry.deck?.id ?? `unknown-${i}`}>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {entry.deck?.cover_image_small && !isUnknownDeck(entry) ? (
                          <img src={entry.deck.cover_image_small} alt={entry.deck.name} className="w-5 h-5 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
                        )}
                        <span className="hidden sm:inline truncate">{isUnknownDeck(entry) ? "모름/기타" : entry.deck?.name}</span>
                      </div>
                    </td>
                    <td className="text-right px-2 py-1.5">{entry.count}</td>
                    <td className="text-right px-2 py-1.5">{entry.ratio.toFixed(0)}%</td>
                    <td className="text-right px-2 py-1.5">{entry.win_rate.toFixed(0)}%</td>
                    <td className="text-right px-2 py-1.5">{entry.first_ratio != null ? `${entry.first_ratio.toFixed(0)}%` : "-"}</td>
                    <td className="text-right px-2 py-1.5">{entry.first_win_rate != null ? `${entry.first_win_rate.toFixed(0)}%` : "-"}</td>
                    <td className="text-right px-2 py-1.5">{entry.second_win_rate != null ? `${entry.second_win_rate.toFixed(0)}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "rankChange" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setRankSubTab("rank")} className={subTabClass("rank")}>랭크</button>
            <button onClick={() => setRankSubTab("score")} className={subTabClass("score")}>점수</button>
          </div>

          {rankSubTab === "rank" && (
            rankData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={rankData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 12 }}
                    label={{ value: "게임 수", position: "insideBottomRight", offset: -5, fontSize: 12 }}
                  />
                  <YAxis
                    domain={[Math.max(0, Math.floor(Math.min(...rankData.map(d => d.value))) - 1), Math.min(RANK_ORDER.length - 1, Math.ceil(Math.max(...rankData.map(d => d.value))) + 1)]}
                    ticks={rankTicks}
                    tickFormatter={(v: number) => RANK_LABELS[RANK_ORDER[v]] || ""}
                    tick={{ fontSize: 11 }}
                    width={70}
                  />
                  <Tooltip
                    formatter={(_: number, __: string, props: any) => [props.payload.label, "랭크"]}
                    labelFormatter={(v: number) => `${v}번째 게임`}
                    contentStyle={{ fontSize: "0.875rem" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400 py-16">
                랭크 데이터가 없습니다.
              </div>
            )
          )}

          {rankSubTab === "score" && (
            scoreData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={scoreData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 12 }}
                    label={{ value: "게임 수", position: "insideBottomRight", offset: -5, fontSize: 12 }}
                  />
                  <YAxis
                    domain={["dataMin - 50", "dataMax + 50"]}
                    tick={{ fontSize: 12 }}
                    width={50}
                  />
                  <Tooltip
                    formatter={(_: number, __: string, props: any) => [props.payload.label, "점수"]}
                    labelFormatter={(v: number) => `${v}번째 게임`}
                    contentStyle={{ fontSize: "0.875rem" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-gray-500 dark:text-gray-400 py-16">
                점수 데이터가 없습니다.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default StatisticsPage;
