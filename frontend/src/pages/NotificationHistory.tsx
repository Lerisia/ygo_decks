import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getNotifications, type SiteNotification } from "@/api/notificationApi";
import NotificationCard from "@/components/NotificationCard";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

// Every notification a member has had, newest first. The ones not yet cleared keep their tan card and X;
// cleared ones turn grey but keep their action, so a link can still be followed later.
export default function NotificationHistory() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SiteNotification[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("access_token")) {
      navigate("/unauthorized");
      return;
    }
    getNotifications().then(setRows).catch(() => setError("불러올 수 없습니다."));
  }, [navigate]);

  const markRead = (id: number) => setRows((rs) => rs && rs.map((r) => (r.id === id ? { ...r, read: true } : r)));
  const unread = rows ? rows.filter((r) => !r.read).length : 0;

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/mypage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 마이페이지
      </button>

      <div className="px-2 sm:px-0">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h1 className="text-xl font-bold">🔔 알림 내역</h1>
          {rows && rows.length > 0 && (
            <span className="text-xs text-gray-500">
              총 {rows.length.toLocaleString()}건{unread > 0 && ` · 확인 안 한 알림 ${unread}건`}
            </span>
          )}
        </div>

        {!rows && !error && <p className="text-center text-sm text-gray-500 py-8">불러오는 중…</p>}
        {error && <p className="text-center text-sm text-red-500 py-8">{error}</p>}
        {rows && rows.length === 0 && <p className="text-center text-sm text-gray-500 py-8">아직 받은 알림이 없습니다.</p>}
        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((n) => (
              <NotificationCard key={n.id} n={n} onDismissed={markRead} date={formatDate(n.created_at)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
