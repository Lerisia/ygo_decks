import { useNavigate } from "react-router-dom";

const features = [
  { to: "/recommend", icon: "🔍", title: "성향 테스트", desc: "나와 맞는 덱은?" },
  { to: "/database", icon: "📚", title: "덱 도감", desc: "덱 검색 및 상세 정보" },
  { to: "/records", icon: "📝", title: "전적 시트", desc: "승률 및 통계 관리" },
  { to: "/deck-scanner", icon: "🪄", title: "AI 스캔", desc: "카드 이미지 인식" },
];

function Info() {
  const navigate = useNavigate();

  return (
    <div className="p-6 h-auto min-h-screen max-w-xl mx-auto text-gray-900 dark:text-white">
      <div className="text-center mb-8">
        <img src="/images/logo_big.png" alt="YGO Decks" className="h-28 sm:hidden mx-auto mb-2" />
        <h1 className="text-2xl font-bold hidden sm:block">YGO Decks</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">유희왕 마스터 듀얼 전적 관리 및 덱 추천</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {features.map((f) => (
          <button
            key={f.to}
            onClick={() => navigate(f.to)}
            className="flex flex-col items-center justify-center p-5 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            <span className="text-3xl mb-2">{f.icon}</span>
            <span className="font-semibold">{f.title}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">{f.desc}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-center gap-4 text-sm">
        <a
          href="https://open.kakao.com/o/sDIT5F2c"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 dark:text-gray-400 hover:text-blue-500 transition"
        >
          💬 문의
        </a>
        <a
          href="https://www.buymeacoffee.com/elyss"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 dark:text-gray-400 hover:text-red-500 transition"
        >
          ☕ 후원
        </a>
      </div>
    </div>
  );
}

export default Info;
