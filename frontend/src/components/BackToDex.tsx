import { Link, useLocation, useNavigate } from "react-router-dom";

/** "← 덱 도감으로" / "← 카드 도감으로" at the top left of a deck or card page (참혈 2026-10-12). Opened from the list,
 *  it steps back so the list returns as it was (filters, scroll); reached any other way it opens the list. */
export default function BackToDex({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const fromList = (useLocation().state as { fromList?: boolean } | null)?.fromList === true;
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (!fromList) return;
        e.preventDefault();
        navigate(-1);
      }}
      className="inline-block mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
    >
      ← {label}
    </Link>
  );
}
