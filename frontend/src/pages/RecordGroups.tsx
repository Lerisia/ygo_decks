import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteRecordGroup,
  getUserRecordGroups,
  createRecordGroup,
  getRecordGroupStatistics,
  getMetaDeckStats,
  MetaDeckStat,
} from "@/api/toolApi";
import { getDeckData } from "@/api/deckApi";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

type RecordGroupBasic = {
  id: number;
  name: string;
};

type RecordGroupWithStats = RecordGroupBasic & {
  totalGames: number;
  overallWinRate: number;
  firstRatio: number;
  firstWinRate: number;
  secondWinRate: number;
};

type Props = {
  data: MetaDeckStat[];
  deckCovers: Record<number, string>;
};

export const MetaDeckPieChart = ({ data, deckCovers }: Props) => {
  const top10 = data.slice(0, 10);
  const totalPercent = top10.reduce((sum, d) => sum + d.appearance_percent, 0);
  const othersPercent = Math.max(0, 100 - totalPercent);

  const chartData = [
    ...top10.map((deck) => ({
      ...deck,
      id: deck.meta_deck_id,
      label: deck.meta_deck_name,
      cover: deckCovers[deck.meta_deck_id] || "",
    })),
    {
      id: -1,
      label: "기타",
      appearance_percent: othersPercent,
      win_rate: 0,
      cover: "",
    },
  ];

  return (
    <div className="hidden md:block w-full max-w-md">
      <h3 className="text-lg font-semibold mb-2">등장률 차트</h3>
      <ResponsiveContainer width="100%" height={350}>
        <PieChart style={{ overflow: 'visible' }}>
          <Pie
            data={chartData}
            dataKey="appearance_percent"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={160}
            label={false}
            isAnimationActive={false}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.id}
                fill={
                  entry.id === -1
                    ? "#cccccc"
                    : `url(#image-pattern-${entry.id})`
                }
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => `${value.toFixed(1)}%`}
            contentStyle={{ fontSize: "0.875rem" }}
          />
          <defs>
            {chartData.map((entry) =>
              entry.id === -1 ? null : (
                <pattern
                  id={`image-pattern-${entry.id}`}
                  key={entry.id}
                  patternUnits="objectBoundingBox"
                  width={1}
                  height={1}
                >
                  <image
                    href={entry.cover}
                    width="100%"
                    height="100%"
                    preserveAspectRatio="xMidYMid slice"
                  />
                </pattern>
              )
            )}
          </defs>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};


const RecordGroups = () => {
  const [recordGroups, setRecordGroups] = useState<RecordGroupWithStats[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [metaStats, setMetaStats] = useState<MetaDeckStat[]>([]);
  const [showMetaStats, setShowMetaStats] = useState(false);
  const [deckCovers, setDeckCovers] = useState<Record<number, string>>({});
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchGroupsWithStats = async () => {
      try {
        const baseGroups: RecordGroupBasic[] = await getUserRecordGroups();

        const groupsWithStats: RecordGroupWithStats[] = await Promise.all(
          baseGroups.map(async (group) => {
            try {
              const stats = await getRecordGroupStatistics(group.id);
              return {
                ...group,
                totalGames: stats.total_games,
                overallWinRate: stats.overall_win_rate,
                firstRatio: stats.first_ratio,
                firstWinRate: stats.first_win_rate,
                secondWinRate: stats.second_win_rate,
              };
            } catch (statError) {
              console.warn(`통계 불러오기 실패 (Group ID: ${group.id}):`, statError);
              return {
                ...group,
                totalGames: 0,
                overallWinRate: 0,
                firstRatio: 0,
                firstWinRate: 0,
                secondWinRate: 0,
              };
            }
          })
        );

        setRecordGroups(groupsWithStats);
      } catch (error) {
        console.error("시트를 불러오기 실패:", error);
      }
    };

    fetchGroupsWithStats();
  }, []);

  useEffect(() => {
    getMetaDeckStats()
      .then((data) => {
        setMetaStats(data.meta_decks || []);
        setTotalMatches(data.total_matches || 0);
      })
      .catch((err) => console.error("메타 덱 불러오기 실패:", err));
  }, []);

  useEffect(() => {
    const fetchCovers = async () => {
      const coverMap: Record<number, string> = {};
  
      for (const deck of metaStats) {
        try {
          const data = await getDeckData(deck.meta_deck_id);
          coverMap[deck.meta_deck_id] = data.cover_image_small;
        } catch (e) {
          console.warn(`커버 불러오기 실패: ${deck.meta_deck_name}`);
        }
      }
  
      setDeckCovers(coverMap);
    };
  
    if (metaStats.length > 0) {
      fetchCovers();
    }
  }, [metaStats]);

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      await createRecordGroup(newGroupName);
      setNewGroupName("");
      setIsModalOpen(false);

      window.location.reload();
    } catch (error) {
      console.error("시트 추가 실패:", error);
    }
  };

  const isLoggedIn = localStorage.getItem("access_token");

  return (
    <div className="p-6 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">시트 관리</h1>
      {metaStats?.length > 0 ? (
        <div className="mb-6">
          <div className="text-sm text-gray-800 dark:text-gray-200">
            자주 출현하는 덱: <div className="grid grid-cols-3 gap-2 text-xs">
            {metaStats.slice(0, 3).map((deck, idx) => (
              <div key={deck.meta_deck_id} className="bg-white dark:bg-gray-800 shadow rounded p-2 text-center">
                <div className="text-xl">
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                </div>
                <div className="font-semibold">{deck.meta_deck_name}</div>
                <div className="text-gray-500 dark:text-gray-400">{deck.appearance_percent}%</div>
              </div>
            ))}
          </div>
          </div>
          <button
            onClick={() => setShowMetaStats((prev) => !prev)}
            className="mt-1 text-blue-600 text-sm hover:underline"
          >
            {showMetaStats ? "숨기기 ▲" : "더 보기 ▼"}
          </button>
          {showMetaStats && (
            <div className="mt-2 p-4 bg-white dark:bg-gray-800 shadow rounded">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                ※ 지난 일주일간 랭크(다이아 이상) · 레이팅 · 듀얼리스트 컵 전적 기반
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300">
                ※ 셀렉션 팩 출시 시 초기화
              </p>
              <p className="text-xs text-gray-700 dark:text-gray-300 mb-3 font-medium">
                총 집계 게임 수: {totalMatches.toLocaleString()}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="hidden md:block">
                  <MetaDeckPieChart data={metaStats} deckCovers={deckCovers} />
                </div>
                <div className="space-y-2">
                  {metaStats.map((deck, idx) => (
                    <div
                      key={deck.meta_deck_id}
                      className="flex items-center justify-between border-b pb-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-mono w-6 text-right">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`}
                        </span>
                        {deckCovers[deck.meta_deck_id] && (
                          <img
                            src={deckCovers[deck.meta_deck_id]}
                            alt={deck.meta_deck_name}
                            className="w-10 h-10 rounded object-cover hidden sm:block"
                          />
                        )}
                        <span className="font-medium text-gray-800 dark:text-gray-200">{deck.meta_deck_name}</span>
                      </div>
                      <div className="text-right text-sm text-gray-600 dark:text-gray-400">
                        <div>
                          출현률: <span className="font-semibold">{deck.appearance_percent}%</span>
                        </div>
                        <div>
                          승률:{" "}
                          <span
                            className={`font-semibold ${
                              deck.win_rate >= 55
                                ? "text-blue-600"
                                : deck.win_rate <= 45
                                ? "text-red-500"
                                : "text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {deck.win_rate}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">메타 덱 통계를 불러오는 중입니다...</div>
      )}
      {isLoggedIn ? (
        <button
          onClick={() => setIsModalOpen(true)}
          className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg shadow hover:bg-blue-600"
        >
          + 시트 추가하기
        </button>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">로그인 후 사용해주세요.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recordGroups.map((group) => {
          const wins = Math.round(group.totalGames * group.overallWinRate / 100);
          const losses = group.totalGames - wins;
          return (
            <div
              key={group.id}
              onClick={() => navigate(`/record-groups/${group.id}`)}
              className="relative p-4 border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition group"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">{group.name}</h2>
                <button
                  className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="삭제"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("이 시트를 삭제할까요?")) {
                      deleteRecordGroup(group.id)
                        .then(() => {
                          alert("삭제 완료");
                          window.location.reload();
                        })
                        .catch((err) => alert("삭제 실패: " + err.message));
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              <div className="text-2xl font-bold mb-1">
                {group.overallWinRate.toFixed(1)}%
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {group.totalGames}전 {wins}승 {losses}패
              </p>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-gray-50 dark:bg-gray-700 rounded py-1.5">
                  <p className="text-gray-500 dark:text-gray-400">선공률</p>
                  <p className="font-semibold">{group.firstRatio.toFixed(0)}%</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded py-1.5">
                  <p className="text-gray-500 dark:text-gray-400">선공 승</p>
                  <p className="font-semibold">{group.firstWinRate.toFixed(0)}%</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded py-1.5">
                  <p className="text-gray-500 dark:text-gray-400">후공 승</p>
                  <p className="font-semibold">{group.secondWinRate.toFixed(0)}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm mx-4">
            <h2 className="text-lg font-semibold mb-2">새로운 시트 추가</h2>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="시트 이름"
              className="p-2 border rounded w-full bg-white dark:bg-gray-800 text-black dark:text-white"
            />
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 mr-2 bg-gray-300 dark:bg-gray-600 rounded"
              >
                취소
              </button>
              <button
                onClick={handleAddGroup}
                className="px-4 py-2 bg-blue-500 text-white rounded"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecordGroups;
