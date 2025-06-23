import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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

const StatisticsPage = () => {
  const { recordGroupId } = useParams();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "deck" | "tier">("basic");

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

  const myDecks = [...stats.my_deck_stats]
  .sort((a, b) => b.count - a.count)
  const oppDecks = [...stats.opponent_deck_stats]
  .map((entry) => ({
    ...entry,
    isUnknown: isUnknownDeck(entry),
  }))
  .sort((a, b) => {
    if (a.isUnknown && !b.isUnknown) return 1;
    if (!a.isUnknown && b.isUnknown) return -1;
    return b.count - a.count;
  });
  
  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
        <div className="flex justify-center gap-4 mb-6 border-b pb-2">
        <button
          onClick={() => setActiveTab("basic")}
          className={`px-4 py-2 font-semibold ${
            activeTab === "basic" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"
          }`}
        >
          요약
        </button>
        <button
          onClick={() => setActiveTab("deck")}
          className={`px-4 py-2 font-semibold ${
            activeTab === "deck" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"
          }`}
        >
          덱별 통계
        </button>
      </div>
      {activeTab === "basic" && (
        <div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8 text-center">
          <div>
            <p className="text-gray-500 text-sm">총 게임 수</p>
            <p className="text-xl font-bold">{stats.basic.total_games}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">승률</p>
            <p className="text-xl font-bold">{stats.basic.overall_win_rate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">승리 수</p>
            <p className="text-xl font-bold">{Math.round(stats.basic.total_games * stats.basic.overall_win_rate / 100)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">패배 수</p>
            <p className="text-xl font-bold">{stats.basic.total_games - Math.round(stats.basic.total_games * stats.basic.overall_win_rate / 100)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8 text-center">
          <div>
            <p className="text-gray-500 text-sm">코인토스 승률</p>
            <p className="text-xl font-bold">{stats.basic.coin_toss_win_rate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">앞면 시 승률</p>
            <p className="text-xl font-bold">{stats.basic.coin_toss_win_win_rate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">뒷면 시 승률</p>
            <p className="text-xl font-bold">{stats.basic.coin_toss_lose_win_rate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">선공 비율</p>
            <p className="text-xl font-bold">{stats.basic.first_ratio.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">선공 시 승률</p>
            <p className="text-xl font-bold">{stats.basic.first_win_rate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">후공 시 승률</p>
            <p className="text-xl font-bold">{stats.basic.second_win_rate.toFixed(1)}%</p>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-2">내 덱 사용 비율</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-4 mb-10">
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={myDecks}
                dataKey="ratio"
                nameKey="deck.name"
                cx="50%"
                cy="50%"
                outerRadius={120}
                label={false}
              >
              {myDecks.map((entry) => {
                return (
                  <Cell key={entry.deck.id} fill={`url(#image-${entry.deck.id})`} />
                );
              })}
              </Pie>
              <Tooltip
              formatter={(value: number) => `${value.toFixed(1)}%`}
              contentStyle={{ fontSize: '0.875rem' }}
              />
              <defs>
                {myDecks.map((entry) => {
                
                  return (
                  <pattern
                  id={`image-${entry.deck.id}`}
                  key={entry.deck.id}
                  patternUnits="objectBoundingBox"
                  width={1}
                  height={1}
                  >
                  <image
                      href={entry.deck.cover_image_small || ""}
                      width="70%"
                      height="70%"
                      preserveAspectRatio="xMidYMid slice"
                  />
                  </pattern>
                  );
                })}
              </defs>
            </PieChart>
          </ResponsiveContainer>

          <div>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr>
                  <th className="px-2 w-[70%]">덱</th>
                  <th className="text-right w-[30%]">비율</th>
                </tr>
              </thead>
              <tbody>
                {myDecks.map((entry) => {
                  return (
                    <tr key={entry.deck.id}>
                      <td className="px-2 flex items-center gap-2">
                        {entry.deck.cover_image_small ? (
                          <img
                            src={entry.deck.cover_image_small}
                            alt={entry.deck.name}
                            className="w-6 h-6 rounded object-cover"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded bg-gray-300" />
                        )}
                        {entry.deck.name}
                      </td>
                      <td className="text-right px-2">{entry.ratio.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-2">상대 덱 비율</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-4 mb-10">
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
            <Pie
              data={oppDecks}
              dataKey="ratio"
              nameKey="deck.name"
              cx="50%"
              cy="50%"
              outerRadius={120}
              label={false}
            >
              {oppDecks.map((entry, i) => {
                if (isUnknownDeck(entry)) {
                  return <Cell key={`unknown-${i}`} fill="#000" />;
                }
                return (
                  <Cell key={entry.deck.id} fill={`url(#image-oppo-${entry.deck.id})`} />
                );
              })}
            </Pie>
              <Tooltip
              formatter={(value: number) => `${value.toFixed(1)}%`}
              contentStyle={{ fontSize: '0.875rem' }}
              />
              <defs>
                {oppDecks.map((entry) => {
                  if (isUnknownDeck(entry)) return null;
                  return(
                  <pattern
                  id={`image-oppo-${entry.deck.id}`}
                  key={entry.deck.id}
                  patternUnits="objectBoundingBox"
                  width={1}
                  height={1}
                  >
                  <image
                  href={entry.deck.cover_image_small || ""}
                  width="50%"
                  height="50%"
                  preserveAspectRatio="xMidYMid slice"
                  />
                  </pattern>
                  );
                })}
              </defs>
            </PieChart>
          </ResponsiveContainer>

          <div>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr>
                  <th className="px-2 w-[70%]">덱</th>
                  <th className="text-right w-[30%]">비율</th>
                </tr>
              </thead>
              <tbody>
                {oppDecks.map((entry, i) => (
                  <tr key={entry.deck?.id ?? `unknown-${i}`}>
                    <td className="px-2 flex items-center gap-2">
                      {entry.deck?.cover_image_small ? (
                        <img
                          src={entry.deck.cover_image_small}
                          alt={entry.deck.name}
                          className="w-6 h-6 rounded object-cover"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded bg-black" />
                      )}
                      {entry.deck?.name || "모름/기타"}
                    </td>
                    <td className="text-right px-2">{entry.ratio.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <h2 className="text-lg font-semibold mt-12 mb-2">내 덱 별 승률</h2>
        <table className="w-full table-fixed text-sm mb-8">
          <thead>
            <tr>
              <th className="text-left px-2 w-[60%]">덱</th>
              <th className="text-right px-2 w-[6ch]">횟수</th>
              <th className="text-right px-2 w-[6ch]">승률</th>
            </tr>
          </thead>
          <tbody>
            {myDecks.map((entry) => (
              <tr key={entry.deck.id}>
                <td className="px-2 flex items-center gap-2">
                  <img
                    src={entry.deck.cover_image_small || ""}
                    alt={entry.deck.name}
                    className="w-6 h-6 rounded object-cover"
                  />
                  {entry.deck.name}
                </td>
                <td className="text-right px-2">{entry.total_games}</td>
                <td className="text-right px-2">{entry.win_rate.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
          <h2 className="text-lg font-semibold mb-2">상대 덱 별 승률</h2>
          <table className="w-full table-fixed text-sm mb-12">
            <thead>
              <tr>
                <th className="text-left px-2 w-[60%]">덱</th>
                <th className="text-right px-2 w-[6ch]">횟수</th>
                <th className="text-right px-2 w-[6ch]">승률</th>
              </tr>
            </thead>
            <tbody>
              {oppDecks.map((entry) => {
              
                return (
                  <tr key={entry.deck.id}>
                    <td className="px-2 flex items-center gap-2">
                      {entry.deck?.cover_image_small && !isUnknownDeck(entry) ? (
                        <img
                          src={entry.deck.cover_image_small}
                          alt={entry.deck.name}
                          className="w-6 h-6 rounded object-cover"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded bg-black" />
                      )}
                      {isUnknownDeck(entry) ? "모름/기타" : entry.deck.name}
                    </td>
                    <td className="text-right px-2">{entry.total_games}</td>
                    <td className="text-right px-2">{entry.win_rate.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        {activeTab === "deck" && (
          <div>
            <h2 className="text-lg font-semibold mb-2">상대 덱별 세부 통계</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm mb-8 table-fixed">
                <thead>
                  <tr>
                    <th className="px-2 w-[20%] sm:w-[15%]">덱</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">등장횟수</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">등장률</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">내 승률</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">선공 비율</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">선공 승률</th>
                    <th className="text-right px-2 w-[15%] sm:w-[10%]">후공 승률</th>
                  </tr>
                </thead>
                <tbody>
                  {oppDecks.map((entry) => (
                    <tr key={entry.deck?.id ?? `unknown-${entry.deck?.name}`}>
                      <td className="px-2 flex items-center gap-2">
                        {entry.deck?.cover_image_small && !isUnknownDeck(entry) ? (
                          <img
                            src={entry.deck.cover_image_small}
                            alt={entry.deck.name}
                            className="w-6 h-6 rounded object-cover"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded bg-black" />
                        )}
                        <span className="hidden sm:inline">{isUnknownDeck(entry) ? "모름/기타" : entry.deck?.name}</span>
                        <span className="sm:hidden" data-tip={entry.deck?.name}>
                          <i className="fas fa-info-circle text-gray-500" />
                        </span>
                        </td>
                        <td className="text-right px-2">{entry.count}</td>
                        <td className="text-right px-2">{entry.ratio.toFixed(0)}%</td> {/* 모바일에서는 소수점 없애기 */}
                        <td className="text-right px-2">{entry.win_rate.toFixed(0)}%</td> {/* 모바일에서는 소수점 없애기 */}
                        <td className="text-right px-2">
                          {entry.first_ratio != null ? `${entry.first_ratio.toFixed(0)}%` : "-"} {/* 선공 비율 */}
                        </td>
                        <td className="text-right px-2">
                          {entry.first_win_rate != null ? `${entry.first_win_rate.toFixed(0)}%` : "-"} {/* 선공 승률 */}
                        </td>
                        <td className="text-right px-2">
                          {entry.second_win_rate != null ? `${entry.second_win_rate.toFixed(0)}%` : "-"} {/* 후공 승률 */}
                        </td>
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
