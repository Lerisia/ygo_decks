import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { isAuthenticated, getUserInfo, claimDailyBonus, isAdmin } from "../api/accountApi";
import { getMyAvatar } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";
import PLogo from "@/components/PLogo";
import { ALL_MENU_PATH, CONTACT_URL, DONATE_URL, MENU_GROUPS, groupOf, itemHref } from "@/lib/siteMenu";
import logo from "/images/logo_big.webp";

// 문의 and 후원 sit at the top right of every page (redesign 2026-10).
function SupportLinks({ compact }: { compact?: boolean }) {
  const pill = "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap transition";
  const size = compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <>
      <a
        href={CONTACT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${pill} ${size} border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500`}
        title="문의 (카카오톡 오픈채팅)"
      >
        💬<span className={compact ? "" : "hidden md:inline"}>문의</span>
      </a>
      <a
        href={DONATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${pill} ${size} bg-rose-600 hover:bg-rose-700 text-white`}
        title="후원 (Buy Me a Coffee)"
      >
        ☕<span className={compact ? "" : "hidden md:inline"}>후원</span>
      </a>
    </>
  );
}

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

  const current = groupOf(location.pathname)?.key;
  // Single light-mode logo + CSS invert in dark mode (avoids the background-colour mismatch between a dark
  // variant and the actual UI background). The logo itself never changes: a friend drew it.
  const logoImg = (cls: string) => <img src={logo} alt="YGO Decks" className={`${cls} w-auto object-contain ${isDark ? "invert" : ""}`} />;

  const pointsLink = userInfo && (
    <Link to="/mypage/points" className="inline-flex items-center gap-1 hover:underline" title="포인트 내역">
      <PLogo size={16} />
      <span className="font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{userInfo.points.toLocaleString()}</span>
    </Link>
  );

  return (
    <header className="bg-transparent text-black dark:text-white">
      {/* Phone: logo, 문의·후원, me */}
      <div className={`sm:hidden ${inMultiplayerRoom ? "hidden" : "flex"} items-center justify-between gap-2 h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-sm px-3`}>
        <Link to="/" className="shrink-0" aria-label="홈">{logoImg("h-10")}</Link>
        <div className="flex items-center gap-1.5 min-w-0">
          <SupportLinks compact />
          {isLoggedIn && userInfo ? (
            <Link to={ALL_MENU_PATH} className="flex items-center gap-1 pl-1 min-w-0" title={userInfo.username}>
              <Avatar icon={avatar?.icon ?? null} border={avatar?.border ?? null} size={26} />
            </Link>
          ) : (
            <Link to="/login" className="pl-1 text-xs font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap hover:underline">로그인</Link>
          )}
        </div>
      </div>
      {isLoggedIn && userInfo && !inMultiplayerRoom && (
        <div className="sm:hidden flex items-center justify-between px-3 h-8 text-xs bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
          <span className="truncate"><span className="font-semibold">{userInfo.username}</span>님</span>
          {pointsLink}
        </div>
      )}

      {/* PC / tablet: logo, the four groups with their menus, 전체, then 문의·후원 and me */}
      <div className={`${inMultiplayerRoom ? "hidden" : "hidden sm:flex"} justify-center bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800`}>
        <div className="w-full max-w-6xl px-4 h-20 flex items-center gap-4 lg:gap-8">
          <Link to="/" className="shrink-0 hover:opacity-80 transition" aria-label="홈">{logoImg("h-14")}</Link>
          <nav className="flex items-center gap-1 flex-1" aria-label="주 메뉴">
            {MENU_GROUPS.map((g) => (
              <div key={g.key} className="relative group">
                <Link
                  to={g.to}
                  className={`flex items-center gap-1 px-3 py-2 rounded-lg text-base lg:text-lg font-semibold whitespace-nowrap transition ${
                    current === g.key ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                  aria-haspopup="true"
                >
                  {g.label}<span className="text-xs text-gray-400" aria-hidden="true">▾</span>
                </Link>
                {/* pt-2 bridges the gap so the menu stays open on the way down */}
                <div className="absolute left-0 top-full pt-2 z-50 hidden group-hover:block group-focus-within:block">
                  <div className="w-64 p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
                    {g.items.map((it) =>
                      it.soon ? (
                        <div key={it.label} className="px-3 py-2 rounded-lg text-gray-400 dark:text-gray-500">
                          <div className="font-semibold">{it.label}</div>
                          <div className="text-xs">{it.desc}</div>
                        </div>
                      ) : it.external ? (
                        <a key={it.label} href={it.to} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                          <div className="font-semibold">{it.label} <span className="text-xs text-gray-400">↗</span></div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{it.desc}</div>
                        </a>
                      ) : (
                        <Link key={it.label} to={itemHref(it, isLoggedIn)} className="block px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                          <div className="font-semibold">{it.label}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{it.desc}</div>
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              </div>
            ))}
            <Link
              to={ALL_MENU_PATH}
              className={`px-3 py-2 rounded-lg text-base lg:text-lg font-semibold whitespace-nowrap transition ${
                location.pathname === ALL_MENU_PATH ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              전체
            </Link>
          </nav>
          <div className="flex items-center gap-2 shrink-0 text-sm">
            <SupportLinks />
            {isLoggedIn && userInfo ? (
              <div className="flex items-center gap-2 pl-2">
                <Link to="/mypage" className="flex items-center gap-2 hover:underline" title="마이페이지">
                  <Avatar icon={avatar?.icon ?? null} border={avatar?.border ?? null} size={28} />
                  <span className="hidden lg:inline font-semibold max-w-[8rem] truncate">{userInfo.username}</span>
                </Link>
                {pointsLink}
                {isAdminUser && (
                  <Link to="/manage" className="text-amber-700 dark:text-amber-300 font-semibold hover:underline">관리</Link>
                )}
              </div>
            ) : (
              <Link to="/login" className="pl-2 font-semibold hover:underline">로그인</Link>
            )}
          </div>
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
