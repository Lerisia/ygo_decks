import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// When a host posts an announcement (a Master Duel room code and the like), entrants see it pop up on any page,
// bottom left so it never sits on the staff alert (특이점 2026-10-10). It stays until closed: a room code must not
// fade away before it is read.
type Notice = { id: number; tournament_id: number; tournament_name: string; content: string; created_at: string };

const SEEN_KEY = "tournament_notice_seen_id";
const POLL_MS = 60_000;

const seenId = () => Number(localStorage.getItem(SEEN_KEY) || 0);

export default function TournamentNoticePopup({ disabled = false }: { disabled?: boolean }) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Notice[]>([]);
  const [copied, setCopied] = useState(false);

  const poll = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token || document.hidden) return;
    const after = seenId();
    fetch(`/api/tournaments/my-announcements/${after ? `?after=${after}` : ""}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Notice[]) => {
        if (!rows.length) return;
        // oldest first, so the newest ends up last and nothing already queued shows twice
        setQueue((q) => {
          const have = new Set(q.map((n) => n.id));
          return [...q, ...rows.filter((n) => !have.has(n.id)).reverse()];
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    const onFocus = () => poll();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll]);

  const current = queue[0];
  const close = () => {
    if (!current) return;
    localStorage.setItem(SEEN_KEY, String(Math.max(seenId(), current.id)));
    setCopied(false);
    setQueue((q) => q.slice(1));
  };
  const copy = () => {
    if (!current) return;
    navigator.clipboard?.writeText(current.content).then(() => setCopied(true)).catch(() => {});
  };

  if (!current || disabled) return null;
  return (
    <div role="status" aria-live="polite" className="fixed left-3 bottom-20 sm:bottom-6 z-40 w-[min(22rem,calc(100vw-1.5rem))]">
      <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 shadow-lg px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="shrink-0 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center" aria-hidden="true">🏆</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 truncate">대회 공지 · {current.tournament_name}</p>
            <p className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{current.content}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="shrink-0 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 leading-none p-0 bg-transparent border-0"
          >
            ×
          </button>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2 text-xs">
          {queue.length > 1 && <span className="mr-auto text-gray-500 dark:text-gray-400">새 공지 {queue.length}개</span>}
          <button type="button" onClick={copy} className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700">
            {copied ? "복사됨" : "복사"}
          </button>
          <button
            type="button"
            onClick={() => {
              const id = current.tournament_id;
              close();
              navigate(`/tournaments/${id}`);
            }}
            className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
          >
            대회로 가기
          </button>
        </div>
      </div>
    </div>
  );
}
