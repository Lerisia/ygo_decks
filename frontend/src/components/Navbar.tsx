import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";
import logo from "/images/logo_big.png";
import logoDark from "/images/logo_big_dark.png";

function Navbar() {
  const isLoggedIn = isAuthenticated();
  const isHome = useLocation().pathname === "/";
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [moreOpen]);

  return (
    <header className="bg-transparent text-black dark:text-white">
      {!isHome && (
        <div className="sm:hidden flex justify-center py-3">
          <Link to="/" className="hover:opacity-80 transition">
            <img src={isDark ? logoDark : logo} alt="사이트 로고" className="h-12 object-contain" />
          </Link>
        </div>
      )}
      <div className="hidden sm:flex justify-center py-4">
        <div className="flex items-center space-x-8">
          <Link to="/" className="hover:opacity-80 transition shrink-0">
            <img src={isDark ? logoDark : logo} alt="사이트 로고" className="h-24 object-contain" />
          </Link>
          <nav className="flex space-x-6 items-center">
            <Link to="/recommend" className="text-lg md:text-xl font-bold break-keep">
              🔍 성향 테스트
            </Link>
            <Link to="/database" className="text-lg md:text-xl break-keep">
              📚 덱 도감
            </Link>
            <Link to="/records" className="text-lg md:text-xl break-keep">
              📝 전적 시트
            </Link>
            <Link to="/deck-scanner" className="text-lg md:text-xl break-keep">
              🪄 AI 스캐너
            </Link>
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="text-lg md:text-xl break-keep hover:opacity-70 transition"
              >
                ⋯ 더보기
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 z-50">
                  <Link
                    to="/playground"
                    className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    onClick={() => setMoreOpen(false)}
                  >
                    🎮 놀이터
                  </Link>
                  <Link
                    to={isLoggedIn ? "/mypage/mydecks" : "/login"}
                    className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    onClick={() => setMoreOpen(false)}
                  >
                    🃏 보유 덱 관리
                  </Link>
                  <Link
                    to="/terms"
                    className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    onClick={() => setMoreOpen(false)}
                  >
                    📄 이용약관
                  </Link>
                  {isLoggedIn ? (
                    <Link
                      to="/mypage"
                      className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      onClick={() => setMoreOpen(false)}
                    >
                      👤 마이페이지
                    </Link>
                  ) : (
                    <Link
                      to="/login"
                      className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      onClick={() => setMoreOpen(false)}
                    >
                      🔑 로그인
                    </Link>
                  )}
                </div>
              )}
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
