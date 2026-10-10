import { useNavigate } from "react-router-dom";
import { actOnNotification, type SiteNotification } from "@/api/notificationApi";

// One notification on a tan card: who sent it, a way to clear it, what it says, and where it leads.
// The action works once: after it is followed the button stays disabled (참혈 2026-10-11).
// What X does depends on the page, so the caller passes it in.
export default function NotificationCard({
  n,
  onClear,
  onActed,
  date,
}: {
  n: SiteNotification;
  onClear: (id: number) => void;
  onActed: (id: number) => void;
  date?: string;
}) {
  const navigate = useNavigate();
  const follow = () => {
    if (n.acted) return;
    onActed(n.id);
    actOnNotification(n.id);
    if (/^https?:\/\//.test(n.action_url)) window.open(n.action_url, "_blank", "noopener,noreferrer");
    else navigate(n.action_url);
  };
  return (
    <div className={`rounded-lg px-3 py-2.5 ${n.read ? "bg-gray-100 dark:bg-gray-700/60" : "bg-[#d2b48c] dark:bg-[#6e5737]"} text-gray-900 dark:text-gray-100`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-amber-900 dark:text-amber-200 truncate">
          {n.sender}
          {date && <span className="ml-2 font-normal text-gray-600 dark:text-gray-300">{date}</span>}
        </p>
        <button
          type="button"
          onClick={() => onClear(n.id)}
          title="지우기"
          aria-label="지우기"
          className="shrink-0 -mt-1 -mr-1.5 w-7 h-7 rounded-full text-lg leading-none p-0 bg-transparent border-0 text-amber-900/70 hover:text-amber-950 hover:bg-black/10 dark:text-amber-100/70 dark:hover:text-white dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{n.body}</p>
      {n.action_url && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={follow}
            disabled={n.acted}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
              n.acted
                ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                : "bg-yellow-400 hover:bg-yellow-500 text-gray-900"
            }`}
          >
            {n.action_label || "이동"}
          </button>
        </div>
      )}
    </div>
  );
}
