import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getUserRecordGroups,
  createRecordGroup,
  getRecordGroupStatistics,
} from "@/api/toolApi";

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

const RecordGroups = () => {
  const [recordGroups, setRecordGroups] = useState<RecordGroupWithStats[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
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
        console.error("시트를 불러오지 못했습니다:", error);
      }
    };

    fetchGroupsWithStats();
  }, []);

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      await createRecordGroup(newGroupName);
      setNewGroupName("");
      setIsModalOpen(false);

      // ⭐ 강제 새로고침
      window.location.reload();
    } catch (error) {
      console.error("시트 추가 실패:", error);
    }
  };

  // 로그인 여부 확인
  const isLoggedIn = localStorage.getItem("access_token"); // 예시: 로그인 토큰이 저장되어 있는지 확인

  return (
    <div className="p-6 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">시트 관리</h1>

      {/* 로그인한 경우에만 버튼을 보이도록 */}
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
              className="p-2 border rounded w-full"
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
