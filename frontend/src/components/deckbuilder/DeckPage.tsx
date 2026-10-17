import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MAIN_MIN, ZONE_PLAY_MAX, type deckWarnings } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH } from "@/lib/deckListPaths";

// The bare icon buttons at the end of the name's line (참혈 2026-10-16): 수정·삭제 on a deck's page, 취소·저장 while it
// is built. Each gives its own colour.
export const DECK_ICON = "shrink-0 grid place-items-center w-8 h-8 p-0 border-0 rounded-lg bg-transparent transition-colors";
export const DECK_ICON_SIZE = "w-[18px] h-[18px]";

/** What keeps the deck from being played under its 금제, in yellow at the right of the 금제's line (참혈 2026-10-16); on a
 *  phone without 메인 덱, wrapping to a second row inside the line's height when all three are there. */
export function DeckWarnings({ short, big, over, later }: ReturnType<typeof deckWarnings>) {
  return (
    <span
      className="min-w-0 flex-1 flex flex-wrap sm:flex-nowrap items-center content-center justify-end gap-x-2 leading-[14px] font-semibold text-amber-600 dark:text-amber-400"
      aria-live="polite"
    >
      {short && <span className="whitespace-nowrap"><span className="hidden sm:inline">메인 덱 </span>{MAIN_MIN}장 미만</span>}
      {big.map((z) => (
        <span key={z} className="whitespace-nowrap">
          {z === "main" ? <><span className="hidden sm:inline">메인 덱 </span><span className="sm:hidden">메인 </span></> : <><span className="hidden sm:inline">엑스트라 덱 </span><span className="sm:hidden">엑스트라 </span></>}
          {ZONE_PLAY_MAX[z]}장 초과
        </span>
      ))}
      {over.length > 0 && <span className="whitespace-nowrap" title={over.map((o) => o.line).join("\n")}>금제 초과 {over.length}종</span>}
      {later.length > 0 && <span className="whitespace-nowrap" title={later.map((o) => o.line).join("\n")}>미출시 {later.length}종</span>}
    </span>
  );
}

/** A deck's page and its editor laid out as one (참혈 2026-10-16: "수정사항이 같이 반영되도록"), each page putting in only
 *  its own pieces: the way back and, in the editor, the title's line; the 대표 카드 on the left, beside them the name's line — its icons at the end — and
 *  the description under it, as tall as the cards; 24px down, the 금제 on the left of a line of a fixed
 *  height, the warnings on its right; then the deck. Spacing, order and heights live here alone. */
export default function DeckPage({ back, top, topEnd, cover, name, actions, description, banlist, warnings, error, children }: {
  /** the first line: the way back (참혈 2026-10-16) */
  back: ReactNode;
  /** a line under it: the editor's title, its icons at the end */
  top?: ReactNode;
  topEnd?: ReactNode;
  /** none: no room kept (a page with no 대표 카드) */
  cover?: ReactNode;
  /** 32px tall: the page's name, the editor's box */
  name: ReactNode;
  /** the page's icons on its name's line (the editor has its own on the title's) */
  actions?: ReactNode;
  /** filling the height left beside the cards */
  description?: ReactNode;
  /** the page's 「마스터 듀얼 • 최신」, the editor's picker (참혈 2026-10-16) */
  banlist: ReactNode;
  warnings: ReturnType<typeof deckWarnings>;
  error?: string | null;
  /** the deck's part */
  children: ReactNode;
}) {
  return (
    <>
      <div className="h-8 flex items-center">{back}</div>
      {top && (
        <div className="h-8 flex items-center justify-between gap-3">
          {top}
          {topEnd}
        </div>
      )}
      <div className="mt-3 mb-6 flex items-stretch gap-5 sm:gap-6 lg:gap-8">
        {cover}
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 min-h-8">{name}</div>
            {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
          </div>
          {description && <div className="mt-2 flex-1 flex flex-col">{description}</div>}
        </div>
      </div>
      <div className="mt-2 h-8 flex items-center gap-2 sm:gap-3 text-xs">
        <div className="min-w-0 flex items-center tabular-nums text-gray-500 dark:text-gray-400">{banlist}</div>
        <DeckWarnings {...warnings} />
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2">{children}</div>
    </>
  );
}

/** Either page with no such deck: on the board, none by that code; in the editor, none of this member's. */
export function DeckNotFound({ signedIn, message }: { signedIn: boolean; message?: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-4">
      <p className="text-gray-600 dark:text-gray-300">{message ?? (signedIn ? "덱을 찾을 수 없습니다." : "로그인하면 저장한 덱을 볼 수 있습니다.")}</p>
      <Link to={DECK_LISTS_PATH} className="shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white">
        목록으로
      </Link>
    </div>
  );
}
