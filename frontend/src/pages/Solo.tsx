import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PLogo from "@/components/PLogo";
import { isAdmin } from "@/api/accountApi";

type Game = { to: string; icon: string; title: string; desc: string; rewardBadge?: boolean; beta?: boolean; adminOnly?: boolean };

const games: Game[] = [
  { to: "/card-quiz", icon: "🐤", title: "화질구지 퀴즈", desc: "저화질 일러스트 맞히기", rewardBadge: true },
  { to: "/solo-duchmind", icon: "🎨", title: "솔로 듀치마인드", desc: "그리고, 맞히고", rewardBadge: true },
  { to: "/solo-twenty", icon: "🧩", title: "솔로 딱무고개", desc: "20개 질문으로 카드 맞히기", rewardBadge: true, beta: true },
];

function Solo() {
  const navigate = useNavigate();
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isAdmin().then((flag) => { if (!cancelled) setIsAdminUser(!!flag); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const visibleGames = games.filter((g) => !g.adminOnly || isAdminUser);

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 md:py-10 max-w-lg md:max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/playground")}
        className="mb-3 ml-4 sm:ml-0 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← 놀이터
      </button>
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-2">솔로 플레이</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 md:mb-8 text-sm md:text-base">혼자 즐기는 게임들</p>

      <div className="grid grid-cols-2 gap-4 md:gap-6">
        {visibleGames.map((g) => (
          <button
            key={g.to}
            onClick={() => navigate(g.to)}
            className="relative flex flex-col items-center justify-center p-5 md:p-8 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            {g.rewardBadge && (
              <span className="absolute top-1.5 left-1.5">
                <PLogo size={20} />
              </span>
            )}
            {g.beta && (
              <span className="absolute top-1.5 right-1.5 text-[10px] md:text-xs font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">
                BETA
              </span>
            )}
            <span className="text-3xl md:text-5xl mb-2">{g.icon}</span>
            <span className="font-semibold md:text-lg">
              {g.title}
              {g.beta && <span className="text-amber-600 dark:text-amber-400"> (베타)</span>}
            </span>
            <span className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Solo;
