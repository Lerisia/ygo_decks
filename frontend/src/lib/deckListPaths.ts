/** Where the deck list pages live (덱 구축, 참혈 2026-10-13), under /dev with the other pages still being laid out
 *  (참혈 2026-10-15; /decklists/… sends there); kept apart from deckDrafts so the tab bar can ask without loading the
 *  rest. */
export const DECK_LISTS_PATH = "/dev/decklists";
export const OLD_DECK_LISTS_PATH = "/decklists";
export const NEW_DECK_PATH = `${DECK_LISTS_PATH}/new`;
export const deckListPath = (code: string) => `${DECK_LISTS_PATH}/${code}`;
export const deckListEditPath = (code: string) => `${DECK_LISTS_PATH}/${code}/edit`;

/** Making or changing a deck: on phones and tablets the card search floats over the bottom of the screen, so the tab
 *  bar steps aside. */
export const isDeckEditorPath = (path: string) =>
  path === NEW_DECK_PATH || /^\/dev\/decklists\/[^/]+\/edit\/?$/.test(path);

/** The room kept at the foot of those pages below lg, in place of the tab bar's: the floating search at its tallest
 *  and a little air, so the last cards and the footer scroll out from behind it and the deck never moves when the
 *  search grows or shrinks. */
// the cards row, the 카드군·서포트 row and the filter chips over the box (참혈 2026-10-15); the image search's cards
// row and picture row stand lower (2026-10-16)
// and the count and sort over the cards (참혈 2026-10-18)
export const DECK_EDITOR_ROOM = "lg:hidden h-[calc(18rem+env(safe-area-inset-bottom))] sm:h-[calc(19rem+env(safe-area-inset-bottom))]";
