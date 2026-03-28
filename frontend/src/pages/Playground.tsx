import { useNavigate } from "react-router-dom";

const games = [
  { to: "/card-quiz", icon: "🐤", title: "화질구지 퀴즈", desc: "저화질 일러스트 맞추기" },
];

function Playground() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-center mb-2">놀이터</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 text-sm">다양한 미니게임을 즐겨보세요!</p>

      <div className="grid grid-cols-2 gap-4">
        {games.map((g) => (
          <button
            key={g.to}
            onClick={() => navigate(g.to)}
            className="flex flex-col items-center justify-center p-5 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            <span className="text-3xl mb-2">{g.icon}</span>
            <span className="font-semibold">{g.title}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Playground;
