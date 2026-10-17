import { Link } from "react-router-dom";
import { Lock, MessageCircle } from "lucide-react";
import type { DeckListAuthor } from "@/api/deckListApi";
import DeckAuthor from "./DeckAuthor";
import { type DeckDraft, MAIN_MIN, deckDay, deckUpdated } from "@/lib/deckDrafts";

/** Every deck card and the dashed one standing in for an empty board are this tall, so the grid never changes size. */
const CARD_BOX = "h-[8.25rem] rounded-xl";

/** One deck list on the board (참혈 2026-10-14, made slimmer; on the board 엘리스 2026-10-17): its name and the day it
 *  was last saved at the top left, who posted it at the top right, two lines of its description under them, and at
 *  the bottom its size with how many wrote under it. */
export default function DeckListCard({ deck, to, author, comments = 0, isPrivate = false, mainCount }: {
  deck: Pick<DeckDraft, "name" | "description" | "createdAt" | "updatedAt">;
  to: string;
  author?: DeckListAuthor;
  comments?: number;
  /** 비공개: the author's own, seen by no one else (a lock before the name) */
  isPrivate?: boolean;
  /** how many in the main deck: short of 40, a warning (엘리스 2026-10-18: posted all the same) */
  mainCount?: number;
}) {
  return (
    <Link
      to={to}
      className={`${CARD_BOX} flex flex-col border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 transition hover:border-blue-400 dark:hover:border-blue-500`}
    >
      <div className="h-6 flex items-center justify-between gap-3">
        <span className="min-w-0 flex items-baseline gap-2">
          {isPrivate && <Lock className="shrink-0 self-center w-3.5 h-3.5 text-gray-500 dark:text-gray-400" aria-label="비공개" />}
          <h2 className="m-0 text-base font-bold truncate">{deck.name || "이름 없는 덱"}</h2>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDay(deckUpdated(deck))}</span>
        </span>
        {author ? (
          <DeckAuthor author={author} size={24} className="shrink-0 max-w-[45%] text-xs" />
        ) : (
          <span className="invisible h-6" aria-hidden />
        )}
      </div>
      <p className="mt-2 mb-0 h-10 text-sm leading-5 text-gray-600 dark:text-gray-300 line-clamp-2 break-keep whitespace-pre-line">
        {deck.description || "설명이 없습니다."}
      </p>
      <div className="mt-2 h-5 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="min-w-0 flex items-center gap-2 truncate tabular-nums">
          {mainCount !== undefined && <span>메인 {mainCount}장</span>}
          {mainCount !== undefined && mainCount < MAIN_MIN && (
            <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">{MAIN_MIN}장 미만</span>
          )}
        </span>
        <span className="shrink-0 flex items-center gap-2.5 tabular-nums">
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="w-3.5 h-3.5" aria-hidden />
            <span className="sr-only">댓글</span>{comments}
          </span>
        </span>
      </div>
    </Link>
  );
}

/** Where the first deck will be: a dashed card the size of a deck card that is itself the way to make one. */
export function DeckListAddCard({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className={`${CARD_BOX} flex flex-col items-center justify-center gap-1 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-semibold transition hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/60 dark:hover:border-blue-500 dark:hover:text-blue-400 dark:hover:bg-blue-900/20`}
    >
      <span className="text-2xl leading-none" aria-hidden>+</span>
      덱 리스트 올리기
    </Link>
  );
}
