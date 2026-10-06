import { Link, useLocation } from "react-router-dom";
import { ALL_MENU_PATH, MENU_GROUPS, groupOf } from "@/lib/siteMenu";

// Pages that live under 전체 rather than under one of the four groups.
const ALL_MENU_PATHS = [ALL_MENU_PATH, "/mypage", "/changelog", "/terms", "/login", "/register", "/manage"];

function BottomTabBar() {
  const location = useLocation();
  const path = location.pathname;

  // Hide entirely while inside a multiplayer room (games need full screen).
  if (path.startsWith("/multiplayer/rooms/")) return null;

  const current = groupOf(path)?.key;
  const inAll = !current && ALL_MENU_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const tabClass = (on: boolean) =>
    `flex flex-col items-center justify-center flex-1 h-full text-xs ${
      on ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-gray-500 dark:text-gray-400"
    }`;

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50">
      <nav className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around items-center h-16 safe-bottom">
        {MENU_GROUPS.map((g) => (
          <Link key={g.key} to={g.to} className={tabClass(current === g.key)} aria-current={current === g.key ? "page" : undefined}>
            <span className="text-xl">{g.icon}</span>
            <span className="mt-1">{g.label}</span>
          </Link>
        ))}
        <Link to={ALL_MENU_PATH} className={tabClass(inAll)} aria-current={inAll ? "page" : undefined}>
          <span className="text-xl">☰</span>
          <span className="mt-1">전체</span>
        </Link>
      </nav>
    </div>
  );
}

export default BottomTabBar;
