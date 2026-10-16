/** The workings of the site's own drop-down (components/Dropdown, 참혈 2026-10-16), kept apart so they can be tested. */

export type ListKeyState = { open: boolean; active: number; count: number; selected: number };
export type ListKeyResult = { open: boolean; active: number; pick?: number; prevent: boolean };

const PAGE = 10;

/** A key pressed on the drop-down's button, as a system select answers it: ↑ ↓ Enter or Space open it at the item
 *  picked, Home and End at the ends; open, ↑ ↓ Home End PageUp PageDown move the mark, Enter or Space pick it, Esc
 *  closes, Tab closes and moves on. null: a key it leaves alone. */
export function listKey(key: string, s: ListKeyState): ListKeyResult | null {
  const last = s.count - 1;
  const clamp = (i: number) => (s.count ? Math.max(0, Math.min(last, i)) : -1);
  if (!s.open) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) return { open: true, active: clamp(s.selected >= 0 ? s.selected : 0), prevent: true };
    if (key === "Home") return { open: true, active: clamp(0), prevent: true };
    if (key === "End") return { open: true, active: clamp(last), prevent: true };
    return null;
  }
  const move: Record<string, number> = {
    ArrowDown: s.active + 1, ArrowUp: s.active - 1, Home: 0, End: last, PageDown: s.active + PAGE, PageUp: s.active - PAGE,
  };
  if (key in move) return { open: true, active: clamp(move[key]), prevent: true };
  if (key === "Enter" || key === " ") return s.active >= 0 ? { open: false, active: s.active, pick: s.active, prevent: true } : { open: false, active: s.active, prevent: true };
  if (key === "Escape") return { open: false, active: s.active, prevent: true };
  if (key === "Tab") return { open: false, active: s.active, prevent: false };
  return null;
}

type Box = { top: number; bottom: number; left: number; width: number };
export type DropPlace = { up: boolean; top?: number; bottom?: number; left: number; minWidth: number; maxHeight: number };

/** Where the list opens, fixed to the window: under its button, 4px apart, as tall as it is up to `max`; above when
 *  below has too little room for it and above has more; its left edge at the button's, kept 8px inside the window. */
export function dropPlace({ anchor, list, view, max, gap = 4, margin = 8 }: {
  anchor: Box; list: { width: number; height: number }; view: { width: number; height: number }; max: number; gap?: number; margin?: number;
}): DropPlace {
  const below = view.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const up = Math.min(list.height, max) > below && above > below;
  const width = Math.max(list.width, anchor.width);
  const left = Math.max(margin, Math.min(anchor.left, view.width - margin - width));
  const maxHeight = Math.max(0, Math.min(max, up ? above : below));
  return up
    ? { up, bottom: view.height - anchor.top + gap, left, minWidth: anchor.width, maxHeight }
    : { up, top: anchor.bottom + gap, left, minWidth: anchor.width, maxHeight };
}

/** The list's scrollTop that shows the item: moved the least, or the item in the middle (as the list opens). */
export function scrollToShow(list: { scrollTop: number; height: number }, item: { top: number; height: number }, centre = false) {
  if (centre) return Math.max(0, Math.round(item.top + item.height / 2 - list.height / 2));
  if (item.top < list.scrollTop) return item.top;
  if (item.top + item.height > list.scrollTop + list.height) return item.top + item.height - list.height;
  return list.scrollTop;
}
