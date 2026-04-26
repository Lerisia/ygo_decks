import { useNavigate } from "react-router-dom";

const games = [
  { to: "/card-quiz", icon: "🐤", title: "화질구지 퀴즈", desc: "저화질 일러스트 맞추기" },
  { to: "/tier-list-maker", icon: "📊", title: "티어표 만들기", desc: "덱 티어리스트 만들고 이미지로 저장" },
  // { to: "/multiplayer", icon: "🎮", title: "멀티플레이", desc: "여러 명이 함께 즐기는 게임" },
];

function Playground() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen px-4 py-6 md:py-10 max-w-lg md:max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-2">놀이터</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 md:mb-8 text-sm md:text-base">다양한 미니게임을 즐겨보세요!</p>

      <div className="grid grid-cols-2 gap-4 md:gap-6">
        {games.map((g) => (
          <button
            key={g.to}
            onClick={() => navigate(g.to)}
            className="flex flex-col items-center justify-center p-5 md:p-8 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            <span className="text-3xl md:text-5xl mb-2">{g.icon}</span>
            <span className="font-semibold md:text-lg">{g.title}</span>
            <span className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Playground;
