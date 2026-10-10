import { useNavigate } from "react-router-dom";
import { dismissNotification, type SiteNotification } from "@/api/notificationApi";

// One notification on a tan card: who sent it, a way to clear it, what it says, and where it leads.
// Following the action clears it too, since the member has seen it.
export default function NotificationCard({
  n,
  onDismissed,
  date,
}: {
  n: SiteNotification;
  onDismissed: (id: number) => void;
  date?: string;
}) {
  const navigate = useNavigate();
  const clear = () => {
    onDismissed(n.id);
    dismissNotification(n.id);
  };
  const follow = () => {
    if (!n.read) clear();
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
        {!n.read && (
          <button
            type="button"
            onClick={clear}
            title="지우기"
            aria-label="지우기"
            className="shrink-0 -mt-1 -mr-1.5 w-7 h-7 rounded-full text-lg leading-none p-0 bg-transparent border-0 text-amber-900/70 hover:text-amber-950 hover:bg-black/10 dark:text-amber-100/70 dark:hover:text-white dark:hover:bg-white/10"
          >
            ×
          </button>
        )}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap break-words">{n.body}</p>
      {n.action_url && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={follow}
            className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-sm font-semibold"
          >
            {n.action_label || "이동"}
          </button>
        </div>
      )}
    </div>
  );
}
