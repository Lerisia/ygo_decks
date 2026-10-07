import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useInquiryAlerts } from "@/lib/inquiryAlerts";

// A new inquiry pops up once for staff, bottom right so it never sits on top of the notice popup
// (특이점 2026-10-07). Only unanswered posts from the last week; seen ids are kept per browser.
const SEEN_KEY = "inquiry_alert_seen_id";
const MAX_AGE_DAYS = 7;

const seenId = () => Number(localStorage.getItem(SEEN_KEY) || 0);
const markSeen = (id: number) => {
  try {
    if (id > seenId()) localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* storage unavailable: it may show again, which is harmless */
  }
};

export default function StaffInquiryAlert({ disabled = false }: { disabled?: boolean }) {
  const alerts = useInquiryAlerts();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const latest = alerts?.latest ?? null;

  const fresh =
    !!latest &&
    !latest.answered &&
    latest.id > seenId() &&
    Date.now() - new Date(latest.created_at).getTime() < MAX_AGE_DAYS * 86_400_000;

  useEffect(() => {
    if (!latest) return;
    // Already looking at it: nothing to announce.
    if (pathname === `/inquiry/post/${latest.id}`) {
      markSeen(latest.id);
      setVisible(false);
      return;
    }
    setVisible(fresh && !disabled);
  }, [latest, fresh, pathname, disabled]);

  if (!latest || !visible) return null;

  const close = () => {
    markSeen(latest.id);
    setVisible(false);
  };
  const others = (alerts?.unanswered ?? 1) - 1;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-3 bottom-20 sm:bottom-6 z-40 w-[min(20rem,calc(100vw-1.5rem))]"
    >
      <div className="flex items-start gap-3 rounded-xl border border-gray-700 bg-gray-900 text-white px-3 py-2.5 shadow-lg text-left">
        <button
          type="button"
          onClick={() => {
            close();
            navigate(`/inquiry/post/${latest.id}`);
          }}
          className="flex flex-1 min-w-0 items-start gap-3 text-left p-0 bg-transparent border-0 hover:border-transparent"
        >
          <span className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center" aria-hidden="true">📮</span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-amber-300">운영진 알림 · 새 문의</span>
            <span className="block text-sm font-semibold">{latest.board_label}</span>
            <span className="block mt-0.5 text-xs text-gray-300">
              {others > 0 ? `답변 대기 ${others}건 더 · ` : ""}눌러서 보기 →
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="새 문의 알림 닫기"
          className="shrink-0 w-6 h-6 rounded-full text-gray-400 hover:text-white hover:bg-white/10 leading-none p-0 bg-transparent border-0"
        >
          ×
        </button>
      </div>
    </div>
  );
}
