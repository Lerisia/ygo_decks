import { Link, useNavigate } from "react-router-dom";

const tiles = [
  {
    to: "/manage/analytics",
    icon: "📈",
    label: "사이트 통계",
    description: "일 방문자·페이지뷰·체류 시간 요약",
  },
  {
    to: "/manage/card-icons",
    icon: "🎴",
    label: "아이콘 관리",
    description: "카드 아이콘 등록/편집/배포",
  },
  {
    to: "/manage/duchmind-words",
    icon: "📚",
    label: "기본 단어장 관리",
    description: "듀치마인드 기본 팩 단어 관리",
  },
  {
    to: "/manage/points-grant",
    icon: "🪙",
    label: "포인트 지급/회수",
    description: "사용자 포인트 직접 지급 또는 차감",
  },
  {
    to: "/manage/effect-tags",
    icon: "🏷️",
    label: "카드 효과 태그 검수",
    description: "LLM 분류 결과 검수 및 수정 (딱무고개용)",
  },
];

export default function AdminIndex() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 홈
      </button>
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-4 sm:p-5">
        <h1 className="text-xl font-bold mb-4">🛠️ 관리</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tiles.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <span className="text-2xl shrink-0">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">{t.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.description}</div>
              </div>
              <span className="text-gray-400 shrink-0">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
