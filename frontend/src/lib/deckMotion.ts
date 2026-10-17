/** Cards moving as Master Duel's deck editor moves them (엘리스 2026-10-18 "마듀처럼 카드가 움직였으면"): a card put in
 *  flies from where it was pressed, or dropped, to its place while the others slide aside (hooks/useDeckFlip); a copy
 *  taken out flies back toward the search and fades; a card under the mouse lifts (index.css .card-lift). Web
 *  Animations on transforms, so the layout never changes under them; nothing moves for a viewer who asked for less
 *  motion. */
export type Spot = { left: number; top: number; width: number; height: number };

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 0.8, 0.4)";
export const FLY_MS = 260;
export const SHIFT_MS = 200;

export const motionOn = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let source: Spot | null = null;

export const spotOf = (el: Element): Spot => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
/** A small spot around a point: where a card was dropped. */
export const spotAt = (x: number, y: number, size = 28): Spot => ({ left: x - size / 2, top: y - size / 2, width: size, height: size });

/** Where the next card put in comes from (the tile pressed, the point dropped at), read once by the zone it lands in. */
export function cardFrom(from: Spot | Element | null) {
  source = from instanceof Element ? spotOf(from) : from;
}
export function takeSource(): Spot | null {
  const s = source;
  source = null;
  return s;
}

const centre = (s: Spot | DOMRect) => [s.left + s.width / 2, s.top + s.height / 2];

/** A ghost of a card's face, fixed over the page where `at` is, above everything and clipped by nothing. */
function ghostOf(src: string, at: Spot | DOMRect) {
  const ghost = document.createElement("img");
  ghost.src = src;
  ghost.alt = "";
  Object.assign(ghost.style, {
    position: "fixed", left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`,
    objectFit: "contain", pointerEvents: "none", zIndex: "80", borderRadius: "3.5% / 2.4%", willChange: "transform",
  });
  document.body.appendChild(ghost);
  return ghost;
}

/** A card arrived at `el`: its face flies from `from` to its place, growing or shrinking to its size on the way — as a
 *  ghost over the page (its picture already drawn, above the other cards, clipped by nothing: 엘리스 2026-10-18 "정갈하지가
 *  않게 느껴지죠"), the card itself kept out of sight until the ghost lands on it. */
export function flyIn(el: HTMLElement, from: Spot) {
  const to = el.getBoundingClientRect();
  const face = el.querySelector("img");
  if (!to.width || !face?.src) return;
  const [fx, fy] = centre(from);
  const [tx, ty] = centre(to);
  const scale = Math.max(0.3, Math.min(1.6, from.width / to.width));
  const ghost = ghostOf(face.src, to);
  el.style.visibility = "hidden";
  const a = ghost.animate([{ transform: `translate(${fx - tx}px, ${fy - ty}px) scale(${scale})` }, { transform: "none" }], { duration: FLY_MS, easing: EASE_OUT });
  const land = () => {
    el.style.visibility = "";
    ghost.remove();
  };
  a.onfinish = land;
  a.oncancel = land;
}

/** A card arrived with no known source (1장 넣기 from a card shown): grows in place. */
export function popIn(el: HTMLElement) {
  el.animate([{ transform: "scale(0.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: SHIFT_MS, easing: EASE_OUT });
}

/** A card whose place moved by (dx, dy): slides from where it was. */
export function shift(el: HTMLElement, dx: number, dy: number) {
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SHIFT_MS, easing: EASE_OUT });
}

/** A copy pressed out of the deck: a ghost of its face flies toward the search (the floating panel on a phone, the
 *  column from lg) and fades; with no search in sight it just fades where it was. */
export function flyOut(el: Element) {
  if (!motionOn()) return;
  const from = el.getBoundingClientRect();
  const face = el.querySelector("img");
  if (!face?.src || !from.width) return;
  const ghost = ghostOf(face.src, from);
  const search = document.querySelector('aside[aria-label="카드 검색"]')?.getBoundingClientRect();
  const [fx, fy] = centre(from);
  const [tx, ty] = search ? [search.left + search.width / 2, search.top + Math.min(search.height / 2, 140)] : [fx, fy - 24];
  const a = ghost.animate(
    [{ transform: "none", opacity: 1 }, { transform: `translate(${tx - fx}px, ${ty - fy}px) scale(0.45)`, opacity: 0 }],
    { duration: FLY_MS + 20, easing: EASE_IN },
  );
  a.onfinish = () => ghost.remove();
  a.oncancel = () => ghost.remove();
}
