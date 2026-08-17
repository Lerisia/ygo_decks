import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { isAuthenticated, logout, getUserInfo, claimDailyBonus, isAdmin } from "../api/accountApi";
import { getMyAvatar } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";
import PLogo from "@/components/PLogo";
import logo from "/images/logo_big.png";

function Navbar() {
  const isLoggedIn = isAuthenticated();
  const location = useLocation();
  const inMultiplayerRoom = location.pathname.startsWith("/multiplayer/rooms/");
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [userInfo, setUserInfo] = useState<{ username: string; points: number } | null>(null);
  const [avatar, setAvatar] = useState<{
    icon: import("@/api/avatarApi").PublicCardIcon | null;
    border: import("@/api/avatarApi").Border | null;
  } | null>(null);
  const [bonusToast, setBonusToast] = useState<number | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) { setUserInfo(null); setAvatar(null); return; }
    let cancelled = false;
    (async () => {
      const info = await getUserInfo();
      if (!info || cancelled) return;
      const bonus = await claimDailyBonus();
      if (cancelled) return;
      const finalPoints = bonus && bonus.claimed ? bonus.points : (info.points ?? 0);
      setUserInfo({ username: info.username, points: finalPoints });
      if (bonus && bonus.claimed && bonus.points_added > 0) {
        setBonusToast(bonus.points_added);
        setTimeout(() => setBonusToast(null), 3500);
      }
    })();
    getMyAvatar().then((d) => { if (!cancelled) setAvatar({ icon: d.icon, border: d.border }); }).catch(() => {});
    isAdmin().then((flag) => { if (!cancelled) setIsAdminUser(!!flag); }).catch(() => { if (!cancelled) setIsAdminUser(false); });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  // Refetch points balance when something elsewhere awards points.
  useEffect(() => {
    if (!isLoggedIn) return;
    const refresh = () => {
      getUserInfo().then((d) => {
        if (d) setUserInfo((prev) => prev ? { ...prev, points: d.points ?? 0 } : { username: d.username, points: d.points ?? 0 });
      });
    };
    window.addEventListener("user-points-updated", refresh);
    return () => window.removeEventListener("user-points-updated", refresh);
  }, [isLoggedIn]);

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
      <div className={`sm:hidden ${inMultiplayerRoom ? "hidden" : "flex"} items-center justify-between bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-sm px-4 py-1.5`}>
        <div className="flex items-center gap-2 min-w-0">
          {isLoggedIn && userInfo ? (
            <>
              <Avatar icon={avatar?.icon ?? null} border={avatar?.border ?? null} size={24} />
              <span className="font-semibold truncate">{userInfo.username}</span>
            </>
          ) : (
            <span />
          )}
        </div>
        <div className="shrink-0">
          {isLoggedIn && userInfo ? (
            <Link to="/mypage/points" className="inline-flex items-center gap-1 hover:underline" title="포인트 내역">
              <PLogo size={18} />
              <span className="font-semibold text-blue-600 dark:text-blue-400">{userInfo.points.toLocaleString()}</span>
            </Link>
          ) : (
            <Link to="/login" className="hover:underline">로그인</Link>
          )}
        </div>
      </div>
      <div className={`${inMultiplayerRoom ? "hidden" : "hidden sm:flex"} justify-center bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-sm`}>
        <div className="w-full max-w-6xl px-4 py-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {isLoggedIn && userInfo && (
              <>
                <Avatar icon={avatar?.icon ?? null} border={avatar?.border ?? null} size={24} />
                <span className="truncate">
                  <span className="font-semibold">{userInfo.username}</span>님 환영합니다
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isLoggedIn && userInfo ? (
              <>
                <Link to="/mypage/points" className="inline-flex items-center gap-1 hover:underline" title="포인트 내역">
                  <PLogo size={18} />
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{userInfo.points.toLocaleString()}</span>
                </Link>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <Link to="/mypage" className="hover:underline">마이페이지</Link>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <button onClick={() => logout()} className="hover:underline">로그아웃</button>
              </>
            ) : (
              <Link to="/login" className="hover:underline">로그인</Link>
            )}
          </div>
        </div>
      </div>
      <div className={`${inMultiplayerRoom ? "hidden" : "hidden sm:flex"} justify-center py-4`}>
        <div className="flex items-center space-x-8">
          <Link to="/" className="hover:opacity-80 transition shrink-0">
            {/* Single light-mode logo + CSS invert in dark mode (avoids the
                background-color mismatch between the dark variant PNG and
                the actual UI background). */}
            <img src={logo} alt="사이트 로고" className={`h-24 object-contain ${isDark ? "invert" : ""}`} />
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
            <Link to="/playground" className="text-lg md:text-xl break-keep">
              🎮 놀이터
            </Link>
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="text-lg md:text-xl break-keep hover:opacity-70 transition"
              >
                ⋯ 더보기
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 z-50">
                  <Link
                    to="/deck-scanner"
                    className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    onClick={() => setMoreOpen(false)}
                  >
                    🪄 AI 스캐너
                  </Link>
                  <Link
                    to="/icon-shop"
                    className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    onClick={() => setMoreOpen(false)}
                  >
                    🛍️ 아이콘 샵
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
                  {isAdminUser && (
                    <>
                      <div className="border-t border-gray-200 dark:border-gray-700 my-1.5" />
                      <Link
                        to="/manage"
                        className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-amber-700 dark:text-amber-300 font-semibold"
                        onClick={() => setMoreOpen(false)}
                      >
                        🛠️ 관리
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </nav>
        </div>
      </div>
      {bonusToast !== null && (
        <div className="fixed top-4 right-4 z-[100] bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-lg animate-pulse">
          🎁 출석 보너스 +{bonusToast}P
        </div>
      )}
    </header>
  );
}

export default Navbar;
