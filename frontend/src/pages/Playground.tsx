import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PLogo from "@/components/PLogo";
import { isAdmin } from "@/api/accountApi";

// Every game sits on this page (특이점 2026-10-13; they used to sit on a 솔로 플레이 page): 멀티플레이 first as one
// tile for its room list (엘리스 2026-10-13), then the 싱글 플레이 games, untagged; the other features follow and
// another site's pages come last.
type Tile = {
  to: string;
  icon: string;
  title: string;
  desc: string;
  rewardBadge?: boolean;
  beta?: boolean;
  adminOnly?: boolean;
  // another site's page: opens in a new tab and says so
  external?: boolean;
};

const tiles: Tile[] = [
  { to: "/multiplayer", icon: "🎮", title: "멀티플레이", desc: "친구들과 함께 즐기는 다양한 미니게임", rewardBadge: true },
  { to: "/card-quiz", icon: "🐤", title: "화질구지 퀴즈", desc: "저화질 일러스트 맞히기", rewardBadge: true },
  { to: "/solo-duchmind", icon: "🎨", title: "솔로 듀치마인드", desc: "그리고, 맞히고", rewardBadge: true },
  { to: "/solo-twenty", icon: "🧩", title: "딱무고개", desc: "20개 질문으로 카드 맞히기", rewardBadge: true },
  { to: "/skill-names", icon: "⌨️", title: "스킬 릴레이", desc: "롤 스킬 이름을 아는 대로 입력하기", beta: true },
  { to: "/packs", icon: "🎴", title: "팩깡 시뮬레이터", desc: "게임과 같은 확률로 팩 열기", beta: true, adminOnly: true },
  { to: "/tier-list-maker", icon: "📊", title: "티어표 만들기", desc: "덱 티어리스트 만들고 이미지로 저장" },
  { to: "/icon-shop", icon: "🛍️", title: "포인트 상점", desc: "포인트로 아이콘·프레임 구매" },
  { to: "https://mdarchive.pages.dev/#climb", icon: "📜", title: "등반 덱 기록", desc: "달마다 사용한 덱을 기록하고 자랑하기", external: true },
];

function Playground() {
  const navigate = useNavigate();
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isAdmin().then((flag) => { if (!cancelled) setIsAdminUser(!!flag); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-lg md:max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-2">놀이터</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 md:mb-8 text-sm md:text-base">다양한 미니게임을 즐겨보세요!</p>

      <div className="grid grid-cols-3 gap-2.5 md:gap-5">
        {tiles.filter((g) => !g.adminOnly || isAdminUser).map((g) => (
          <button
            key={g.to}
            onClick={() => (g.external ? window.open(g.to, "_blank", "noopener,noreferrer") : navigate(g.to))}
            className="relative flex flex-col items-center justify-center px-1.5 pt-7 pb-3 md:px-4 md:pt-9 md:pb-6 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            {g.rewardBadge && (
              <span className="absolute top-1 left-1 md:top-1.5 md:left-1.5">
                <PLogo size={18} />
              </span>
            )}
            {g.beta && (
              <span className="absolute top-1 right-1 md:top-1.5 md:right-1.5 text-[9px] md:text-xs font-bold px-1 md:px-1.5 py-0.5 rounded bg-amber-500 text-white">
                BETA
              </span>
            )}
            {g.external && (
              <span className="absolute top-1 right-1 md:top-1.5 md:right-1.5 text-[9px] md:text-xs font-bold px-1 md:px-1.5 py-0.5 rounded bg-gray-500 text-white">
                외부 사이트 ↗
              </span>
            )}
            <span className="text-2xl md:text-4xl mb-1.5 md:mb-2">{g.icon}</span>
            <span className="font-semibold text-[13px] leading-snug md:text-base break-keep">
              {g.title}
              {g.beta && <span className="text-amber-600 dark:text-amber-400"> (베타)</span>}
            </span>
            <span className="text-[11px] leading-snug md:text-sm text-gray-500 dark:text-gray-400 mt-1 break-keep">{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Playground;
