import { Link } from "react-router-dom";
import Avatar, { type AvatarIcon } from "@/components/Avatar";
import type { Border } from "@/api/avatarApi";
import { type DeckDraft, deckDay, deckUpdated } from "@/lib/deckDrafts";

export type DeckListAuthor = { nickname: string; avatar_icon: AvatarIcon | null; border: Border | null };

/** Every deck card and the dashed one standing in for an empty list are this tall, so the grid never changes size. */
const CARD_BOX = "h-[6.75rem] rounded-xl";

/** One deck list on a list of them (참혈 2026-10-14, made slimmer): its name and the day it was last saved at the top
 *  left, who registered it at the top right, two lines of its description under them. Made to be used again on a
 *  shared deck board. */
export default function DeckListCard({ deck, to, author }: {
  deck: Pick<DeckDraft, "name" | "description" | "createdAt" | "updatedAt">;
  to: string;
  /** Not used yet: on a shared deck board, the member who registered it. */
  author?: DeckListAuthor;
}) {
  return (
    <Link
      to={to}
      className={`${CARD_BOX} flex flex-col border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 transition hover:border-blue-400 dark:hover:border-blue-500`}
    >
      <div className="h-6 flex items-center justify-between gap-3">
        <span className="min-w-0 flex items-baseline gap-2">
          <h2 className="m-0 text-base font-bold truncate">{deck.name || "이름 없는 덱"}</h2>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDay(deckUpdated(deck))}</span>
        </span>
        {/* 공유 게시판에서 등록자 닉네임 자리: the corner keeps the icon's height while it is empty */}
        {author ? (
          <span className="shrink-0 max-w-[45%] flex items-center gap-1.5 text-xs">
            <Avatar icon={author.avatar_icon} border={author.border} size={24} className="shrink-0" />
            <span className="font-semibold truncate">{author.nickname}</span>
          </span>
        ) : (
          <span className="invisible h-6" aria-hidden />
        )}
      </div>
      <p className="mt-2 mb-0 h-10 text-sm leading-5 text-gray-600 dark:text-gray-300 line-clamp-2 break-keep whitespace-pre-line">
        {deck.description || "설명이 없습니다."}
      </p>
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
      덱 리스트 추가
    </Link>
  );
}
