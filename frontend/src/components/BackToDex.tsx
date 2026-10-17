import { Link, useLocation, useNavigate } from "react-router-dom";

/** Where a page was opened from, carried in the navigation state: its path and the back link's words. A deck list
 *  sends it with each card (엘리스 2026-10-18: a card opened from a deck list goes back to the deck list, not the
 *  card book). */
export type BackFrom = { path: string; label: string };

/** "← 덱 도감으로" / "← 카드 도감으로" at the top left of a deck or card page (참혈 2026-10-12). Opened from the list,
 *  it steps back so the list returns as it was (filters, scroll); opened from somewhere that said so (BackFrom in the
 *  state), it reads as that place and steps back there; reached any other way it opens the list. */
export default function BackToDex({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const state = useLocation().state as { fromList?: boolean; from?: BackFrom } | null;
  const fromList = state?.fromList === true;
  const from = state?.from;
  return (
    <Link
      to={from?.path ?? to}
      onClick={(e) => {
        if (!fromList && !from) return;
        e.preventDefault();
        navigate(-1);
      }}
      className="inline-block mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
    >
      ← {from?.label ?? label}
    </Link>
  );
}
