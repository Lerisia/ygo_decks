import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Avatar, { type AvatarIcon } from "@/components/Avatar";
import type { Border } from "@/api/avatarApi";
import { type DeckDraft, deckDay } from "@/lib/deckDrafts";

export type DeckListAuthor = { nickname: string; avatar_icon: AvatarIcon | null; border: Border | null };

/** Every deck card and the dashed one standing in for an empty list are this tall, so the grid never changes size. */
const CARD_BOX = "h-44 rounded-xl";

/** One deck list on a list of them: its name, a few lines of its description, and at the bottom who registered it
 *  and when. Made to be used again on a shared deck board. */
export default function DeckListCard({ deck, to, author }: {
  deck: Pick<DeckDraft, "name" | "description" | "createdAt">;
  to: string;
  /** Not used yet: on a shared deck board, the member who registered it. */
  author?: DeckListAuthor;
}) {
  return (
    <Link
      to={to}
      className={`${CARD_BOX} flex flex-col border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 transition hover:border-blue-400 dark:hover:border-blue-500`}
    >
      <h2 className="m-0 h-6 text-base font-bold truncate">{deck.name || "이름 없는 덱"}</h2>
      <p className="mt-1 mb-2 text-sm leading-5 text-gray-600 dark:text-gray-300 line-clamp-3 break-keep whitespace-pre-line">
        {deck.description || "설명이 없습니다."}
      </p>
      <div className="mt-auto h-6 flex items-center justify-between gap-2">
        {/* 공유 게시판에서 등록자 닉네임 자리: the line keeps its height (the icon's) while it is empty */}
        {author ? (
          <span className="min-w-0 flex items-center gap-1.5 text-xs">
            <Avatar icon={author.avatar_icon} border={author.border} size={24} className="shrink-0" />
            <span className="font-semibold truncate">{author.nickname}</span>
          </span>
        ) : (
          <span className="invisible h-6" aria-hidden />
        )}
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDay(deck.createdAt)}</span>
      </div>
    </Link>
  );
}

/** Where the first deck will be: a dashed card the size of a deck card around what goes in it. */
export function DeckListCardSlot({ children }: { children: ReactNode }) {
  return (
    <div className={`${CARD_BOX} flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600`}>
      {children}
    </div>
  );
}
