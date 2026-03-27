import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getRecordGroupStatisticsFull } from "@/api/toolApi";

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
  const [activeTab, setActiveTab] = useState<"basic" | "deck">("basic");

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await getRecordGroupStatisticsFull(Number(recordGroupId));
        setStats(res);
      } catch (err) {
        console.error("통계 데이터를 불러오지 못했습니다", err);
      }
    };
    fetchStats();
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

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate(`/record-groups/${recordGroupId}`)}
        className="text-lg font-semibold hover:text-blue-600 mb-4"
      >
        ← {stats.record_group_name}
      </button>

      <div className="flex justify-center gap-4 mb-6 border-b dark:border-gray-700 pb-2">
        <button
          onClick={() => setActiveTab("basic")}
          className={`px-4 py-2 font-semibold ${
            activeTab === "basic" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          요약
        </button>
        <button
          onClick={() => setActiveTab("deck")}
          className={`px-4 py-2 font-semibold ${
            activeTab === "deck" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          덱별 통계
        </button>
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
    </div>
  );
};

export default StatisticsPage;
