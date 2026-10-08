import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getUserInfo, isAdmin, isAuthenticated, logout } from "@/api/accountApi";
import { getMyAvatar, type Border, type PublicCardIcon } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";
import PLogo from "@/components/PLogo";
import { CONTACT_PATH, DONATE_URL, ETC_ITEMS, ME_ITEMS, MENU_GROUPS, itemHref, type MenuItem } from "@/lib/siteMenu";

function readDark() {
  return document.documentElement.classList.contains("dark");
}

function setTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    /* private mode: the choice lasts until the tab closes */
  }
}

function Row({ item, loggedIn }: { item: MenuItem; loggedIn: boolean }) {
  const inner = (
    <>
      <span className="font-medium">{item.label}</span>
      {item.desc && <span className="text-xs text-gray-500 dark:text-gray-400 text-right">{item.desc}{item.external && " ↗"}</span>}
    </>
  );
  const cls = "flex items-center justify-between gap-3 px-4 py-3 border-t first:border-t-0 border-gray-100 dark:border-gray-700";
  if (item.soon) return <div className={`${cls} text-gray-400 dark:text-gray-500`}>{inner}</div>;
  if (item.external)
    return <a href={item.to} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>{inner}</a>;
  return <Link to={itemHref(item, loggedIn)} className={`${cls} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>{inner}</Link>;
}

/** 더보기 (was 전체 until 2026-10-08): every part of the site in one place, with 문의·후원 first. */
export default function AllMenu() {
  const loggedIn = isAuthenticated();
  const [me, setMe] = useState<{ username: string; points: number } | null>(null);
  const [avatar, setAvatar] = useState<{ icon: PublicCardIcon | null; border: Border | null } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [dark, setDark] = useState(readDark);

  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    getUserInfo().then((d) => alive && d && setMe({ username: d.username, points: d.points ?? 0 })).catch(() => {});
    getMyAvatar().then((d) => alive && setAvatar({ icon: d.icon, border: d.border })).catch(() => {});
    isAdmin().then((f) => alive && setAdmin(!!f)).catch(() => {});
    return () => { alive = false; };
  }, [loggedIn]);

  const chooseTheme = (next: boolean) => { setTheme(next); setDark(next); };

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg md:max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl md:text-3xl font-bold">더보기</h1>

      <div className="grid grid-cols-2 gap-2">
        <Link to={CONTACT_PATH}
           className="py-3 text-center rounded-xl font-semibold border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 transition">
          💬 문의하기
        </Link>
        <a href={DONATE_URL} target="_blank" rel="noopener noreferrer"
           className="py-3 text-center rounded-xl font-semibold bg-rose-600 hover:bg-rose-700 text-white transition">
          ☕ 후원하기
        </a>
      </div>

      <section className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between gap-3 min-h-[76px]">
        {loggedIn ? (
          <>
            <Link to="/mypage" className="flex items-center gap-3 min-w-0">
              <Avatar icon={avatar?.icon ?? null} border={avatar?.border ?? null} size={44} />
              <span className="min-w-0">
                <span className="block font-semibold truncate">{me?.username ?? " "}</span>
                <span className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 font-semibold tabular-nums">
                  <PLogo size={14} />{me ? me.points.toLocaleString() : ""}
                </span>
              </span>
            </Link>
            <button type="button" onClick={() => logout()} className="shrink-0 px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold transition">
              로그아웃
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-600 dark:text-gray-300">로그인하면 전적과 포인트가 저장됩니다.</span>
            <Link to="/login" className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition">로그인</Link>
          </>
        )}
      </section>

      {MENU_GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`all-${g.key}`}>
          <h2 id={`all-${g.key}`} className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">{g.icon} {g.label}</h2>
          <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
            {g.items.map((it) => <Row key={it.label} item={it} loggedIn={loggedIn} />)}
          </div>
        </section>
      ))}

      <section aria-labelledby="all-me">
        <h2 id="all-me" className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">👤 내 정보</h2>
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
          {ME_ITEMS.map((it) => <Row key={it.label} item={it} loggedIn={loggedIn} />)}
          {admin && <Row item={{ label: "관리", to: "/manage", desc: "운영진 전용" }} loggedIn={loggedIn} />}
        </div>
      </section>

      <section aria-labelledby="all-etc">
        <h2 id="all-etc" className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">⚙️ 기타</h2>
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span id="all-theme" className="font-medium">화면 밝기</span>
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              aria-labelledby="all-theme"
              onClick={() => chooseTheme(!dark)}
              className="flex items-center gap-2 p-0 bg-transparent border-0"
            >
              <span className="text-sm text-gray-500 dark:text-gray-400">{dark ? "🌙 어둡게" : "☀️ 밝게"}</span>
              <span className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${dark ? "bg-blue-600" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-5" : ""}`} />
              </span>
            </button>
          </div>
          {ETC_ITEMS.map((it) => (
            <div key={it.label} className="border-t border-gray-100 dark:border-gray-700">
              <Row item={it} loggedIn={loggedIn} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
