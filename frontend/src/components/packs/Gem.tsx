import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useGems } from "@/lib/gems";

const GEM = "/media/md_ui/packopen/gem.webp";

/** The game's gem (ConsumeIcon0001), the size of the text around it. */
export function GemIcon({ className = "" }: { className?: string }) {
  return <img src={GEM} alt="젬" className={`inline-block h-[1.15em] w-auto align-[-0.25em] ${className}`} />;
}

/** The gems held, as the game shows them: its gem and the count (a guest is asked to sign in). */
export function GemCount({ dark = false, gems: given }: { dark?: boolean; gems?: number }) {
  const { signedIn, gems } = useGems();
  const shown = given ?? gems;
  const box = `inline-flex items-center gap-1.5 h-9 pl-1 pr-3 rounded-full text-sm font-bold tabular-nums shadow-sm ${
    dark ? "bg-black/50 border border-white/30 text-white" : "bg-gray-900 text-white dark:bg-gray-800"}`;
  if (!signedIn && given === undefined) {
    return <Link to="/login" className={box}><img src={GEM} alt="" className="h-7 w-auto" />로그인</Link>;
  }
  return (
    <span className={box} aria-label={`보유 젬 ${shown ?? ""}`}>
      <img src={GEM} alt="" className="h-7 w-auto" />
      {shown === null || shown === undefined ? "" : shown.toLocaleString()}
    </span>
  );
}

/** The top of a pack simulator page: a way back on the left, the gems held on the right, staying in view as the page
 *  scrolls (엘리스 10/13 "늘 보이게"). */
export function PackTopBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 -mt-2 px-4 py-2 flex items-center justify-between gap-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur">
      <div className="min-w-0 flex items-center gap-3 text-sm">{children}</div>
      <GemCount />
    </div>
  );
}

/** "← 팩 목록": when the list led here, back to it as it was left — its search, filter and scroll — rather than the list
 *  afresh at its top (엘리스 10/13: "뒤로가기 시 스크롤 위치가 대폭 틀려요"). */
export function PackListLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromList = (location.state as { fromList?: boolean } | null)?.fromList;
  return (
    <Link to="/packs" onClick={(e) => { if (fromList) { e.preventDefault(); navigate(-1); } }}
          className="text-blue-600 dark:text-blue-400 hover:underline">← 팩 목록</Link>
  );
}
