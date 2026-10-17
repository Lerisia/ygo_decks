import { Link } from "react-router-dom";
import { Lock, MessageCircle } from "lucide-react";
import type { DeckListAuthor } from "@/api/deckListApi";
import UserName from "@/components/UserName";
import { banlistName } from "@/lib/banlists";
import { type DeckDraft, deckDay, deckUpdated } from "@/lib/deckDrafts";

/** Every deck card, its loading stand-in and the dashed one standing in for an empty board are this tall, so the grid
 *  never changes size. */
export const DECK_CARD_HEIGHT = "h-[5.5rem]";
const CARD_BOX = `${DECK_CARD_HEIGHT} rounded-xl`;

/** One deck list on the board, in two lines (참혈 2026-10-18): its name and 금제 on the left with the day it was last
 *  saved on the right; under them who posted it, and how many wrote under it on the right. */
export default function DeckListCard({ deck, to, author, comments = 0, isPrivate = false, banlist }: {
  deck: Pick<DeckDraft, "name" | "createdAt" | "updatedAt">;
  to: string;
  author?: DeckListAuthor;
  comments?: number;
  /** 비공개: the author's own, seen by no one else (a lock before the name) */
  isPrivate?: boolean;
  /** its 금제's key (lib/banlists), named as its page names it */
  banlist?: string;
}) {
  return (
    <Link
      to={to}
      className={`${CARD_BOX} flex flex-col justify-center gap-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 transition hover:border-blue-400 dark:hover:border-blue-500`}
    >
      <div className="h-6 flex items-center justify-between gap-3">
        <span className="min-w-0 flex items-baseline gap-2">
          {isPrivate && <Lock className="shrink-0 self-center w-3.5 h-3.5 text-gray-500 dark:text-gray-400" aria-label="비공개" />}
          <h2 className="m-0 min-w-0 text-base font-bold truncate">{deck.name || "이름 없는 덱"}</h2>
          {banlist && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{banlistName(banlist, null)}</span>}
        </span>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDay(deckUpdated(deck))}</span>
      </div>
      <div className="h-6 flex items-center justify-between gap-3">
        {author ? <UserName user={author} size={24} className="min-w-0 text-xs" /> : <span className="h-6" aria-hidden />}
        <span className="shrink-0 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          <MessageCircle className="w-3.5 h-3.5" aria-hidden />
          <span className="sr-only">댓글</span>
          {comments}
        </span>
      </div>
    </Link>
  );
}

/** Where the first deck will be: a dashed card the size of a deck card that is itself the way to make one (it asks
 *  how, as the board's button does: 사진으로 or 직접). */
export function DeckListAddCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CARD_BOX} w-full flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-300 dark:border-gray-600 bg-transparent text-gray-500 dark:text-gray-400 font-semibold transition hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/60 dark:hover:border-blue-500 dark:hover:text-blue-400 dark:hover:bg-blue-900/20`}
    >
      <span className="text-2xl leading-none" aria-hidden>+</span>
      덱 리스트 올리기
    </button>
  );
}
