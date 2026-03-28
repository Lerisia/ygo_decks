import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";

const mainTabs = [
  { to: "/recommend", icon: "🔍", label: "테스트" },
  { to: "/database", icon: "📚", label: "도감" },
  { to: "/records", icon: "📝", label: "전적" },
  { to: "/deck-scanner", icon: "🪄", label: "AI스캔" },
];

const moreTabs = [
  { to: "/", icon: "🏠", label: "홈" },
  { to: "/playground", icon: "🎮", label: "놀이터" },
  { to: "/mypage/mydecks", icon: "🃏", label: "보유 덱", auth: true },
  { to: "/terms", icon: "📄", label: "이용약관" },
];

function BottomTabBar() {
  const location = useLocation();
  const isLoggedIn = isAuthenticated();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        moreRef.current && !moreRef.current.contains(e.target as Node) &&
        moreButtonRef.current && !moreButtonRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [moreOpen]);

  const isActive = (path: string) => location.pathname === path;
  const morePaths = moreTabs.map((t) => t.to);
  const isMoreActive = moreOpen || morePaths.includes(location.pathname);

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
      {moreOpen && (
        <div ref={moreRef} className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-3 grid grid-cols-4 gap-3">
          {moreTabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.auth && !isLoggedIn ? "/login" : tab.to}
              className={`flex flex-col items-center text-xs py-2 rounded-lg ${
                isActive(tab.to)
                  ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              <span className="mt-1">{tab.label}</span>
            </Link>
          ))}
          <Link
            to={isLoggedIn ? "/mypage" : "/login"}
            className={`flex flex-col items-center text-xs py-2 rounded-lg ${
              isActive("/mypage") || isActive("/login")
                ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <span className="text-lg">{isLoggedIn ? "👤" : "🔑"}</span>
            <span className="mt-1">{isLoggedIn ? "마이페이지" : "로그인"}</span>
          </Link>
        </div>
      )}

      <nav className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around items-center h-16 safe-bottom">
        {mainTabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={`flex flex-col items-center justify-center flex-1 h-full text-xs ${
              isActive(tab.to)
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <span className="mt-1">{tab.label}</span>
          </Link>
        ))}
        <button
          ref={moreButtonRef}
          onClick={() => setMoreOpen((v) => !v)}
          className={`flex flex-col items-center justify-center flex-1 h-full text-xs ${
            isMoreActive
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          <span className="text-xl">⋯</span>
          <span className="mt-1">더보기</span>
        </button>
      </nav>
    </div>
  );
}

export default BottomTabBar;
