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
        <PieChart>
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
                    width="50%"
                    height="50%"
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
          <div className="text-sm text-gray-800">
            자주 출현하는 덱: <div className="grid grid-cols-3 gap-2 text-xs">
            {metaStats.slice(0, 3).map((deck, idx) => (
              <div key={deck.meta_deck_id} className="bg-white shadow rounded p-2 text-center">
                <div className="text-xl">
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                </div>
                <div className="font-semibold">{deck.meta_deck_name}</div>
                <div className="text-gray-500">{deck.appearance_percent}%</div>
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
            <div className="mt-2 p-4 bg-white shadow rounded">
              <p className="text-xs text-gray-700">
                ※ 지난 일주일간 다이아 ~ 마스터 구간의 전적 기반
              </p>
              <p className="text-xs text-gray-700 mb-3 font-medium">
                총 집계 게임 수: {totalMatches.toLocaleString()}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 왼쪽 빈 칼럼 (모바일에선 안 보임) */}
                <div className="hidden md:block">
                  <MetaDeckPieChart data={metaStats} deckCovers={deckCovers} />
                </div>

                {/* 오른쪽에 있는 메타 통계 표 */}
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
                        <span className="font-medium text-gray-800">{deck.meta_deck_name}</span>
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <div>
                          출현률: <span className="font-semibold">{deck.appearance_percent}%</span>
                        </div>
                        <div>
                          승률:{" "}
                          <span
                            className={`font-semibold ${
                              deck.win_rate >= 50
                                ? "text-blue-600"
                                : deck.win_rate <= 40
                                ? "text-red-500"
                                : "text-gray-700"
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
        <div className="text-sm text-gray-500 mb-4">메타 덱 통계를 불러오는 중입니다...</div>
      )}
      {isLoggedIn ? (
        <button
          onClick={() => setIsModalOpen(true)}
          className="mb-4 px-4 py-2 bg-blue-500 text-white rounded-lg shadow hover:bg-blue-600"
        >
          + 시트 추가하기
        </button>
      ) : (
        <p className="text-sm text-gray-600">로그인 후 사용해주세요.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recordGroups.map((group) => (
          <div
            key={group.id}
            onClick={() => navigate(`/record-groups/${group.id}`)}
            className="p-4 border rounded-lg shadow-sm bg-white cursor-pointer hover:bg-gray-100 transition"
          >
            <h2 className="text-lg font-semibold hover:underline">{group.name}</h2>
            <p className="text-sm text-gray-600">게임 수: {group.totalGames}</p>
            <p className="text-sm text-gray-600">
              총 승률: {group.overallWinRate.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600">
              선공 비율: {group.firstRatio.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600">
              선공 승률: {group.firstWinRate.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600">
              후공 승률: {group.secondWinRate.toFixed(1)}%
            </p>
            <button
              className="mt-4 px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 transition"
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
              삭제
            </button>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-2">새로운 시트 추가</h2>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="시트 이름"
              className="p-2 border rounded w-full bg-white text-black"
            />
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 mr-2 bg-gray-300 rounded"
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
