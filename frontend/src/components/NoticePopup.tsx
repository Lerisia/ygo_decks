import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Megaphone } from "lucide-react";
import { getLatestChangelog, type ChangelogEntry } from "@/api/changelogApi";

// 새 공지가 올라오면 어느 화면에서든 오른쪽 위에 한 번만 은은하게 띄운다 (특이점 2026-10-03).
// 홈(최근 업데이트 칸)과 업데이트 내역 페이지에서는 이미 보이므로 띄우지 않고 본 것으로 친다.
const SEEN_KEY = "notice_popup_seen_id";
const MAX_AGE_DAYS = 7; // 처음 온 사람에게 오래된 공지까지 띄우지 않도록
const SHOW_MS = 9000;
const NOTICE_PAGES = ["/", "/changelog"];

const markSeen = (id: number) => {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* storage unavailable — the popup may show again, which is harmless */
  }
};

export default function NoticePopup({ disabled = false }: { disabled?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState<ChangelogEntry | null>(null);
  const [shown, setShown] = useState<ChangelogEntry | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    getLatestChangelog()
      .then(({ entry }) => {
        if (!entry || localStorage.getItem(SEEN_KEY) === String(entry.id)) return;
        if (Date.now() - new Date(entry.published_at).getTime() > MAX_AGE_DAYS * 86_400_000) return markSeen(entry.id);
        setPending(entry);
      })
      .catch(() => {});
  }, []);

  // Show on the first ordinary page the visitor is on; on the home / notice pages the notice is already in view.
  useEffect(() => {
    if (!pending || disabled) return;
    markSeen(pending.id);
    setPending(null);
    if (NOTICE_PAGES.includes(pathname)) return;
    setShown(pending);
  }, [pending, pathname, disabled]);

  useEffect(() => {
    if (!shown) return;
    const enter = requestAnimationFrame(() => setVisible(true));
    const leave = setTimeout(() => setVisible(false), SHOW_MS);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(leave);
    };
  }, [shown]);

  // Leaving the page hides it too — it is a one-off nudge, not something to chase the visitor around.
  useEffect(() => {
    if (shown && NOTICE_PAGES.includes(pathname)) setVisible(false);
  }, [pathname, shown]);

  if (!shown) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      onTransitionEnd={() => !visible && setShown(null)}
      className={`fixed right-3 top-16 sm:top-24 z-40 w-[min(20rem,calc(100vw-1.5rem))] transition-all duration-500 ${
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4 pointer-events-none"
      }`}
    >
      <div className="flex items-start gap-3 rounded-xl border border-blue-100 dark:border-blue-800/50 bg-white/95 dark:bg-gray-800/95 backdrop-blur px-3 py-2.5 shadow-lg text-left">
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            navigate("/changelog");
          }}
          className="flex flex-1 min-w-0 items-start gap-3 text-left p-0 bg-transparent border-0 hover:border-transparent"
        >
          <span className="shrink-0 w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Megaphone className="w-4 h-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-blue-600 dark:text-blue-400">새 공지</span>
            <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">{shown.title}</span>
            <span className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">눌러서 보기 →</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="공지 알림 닫기"
          className="shrink-0 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 leading-none p-0 bg-transparent border-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}
