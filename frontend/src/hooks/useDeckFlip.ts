import { type RefObject, useLayoutEffect, useRef } from "react";
import { flyIn, motionOn, popIn, shift, takeSource } from "@/lib/deckMotion";

/** FLIP over a zone's cards (each with data-flip, a key that stays with the copy): when the cards change, each that
 *  moved slides from where it was, and a new one flies in from where it was pressed or dropped (deckMotion.cardFrom),
 *  or grows in place when nowhere is known. Places are measured against the zone, so a scroll between changes moves
 *  nothing; the first paint of a deck just read moves nothing either. */
export function useDeckFlip(zone: RefObject<HTMLElement | null>, key: string, on: boolean) {
  const prev = useRef<Map<string, { left: number; top: number }> | null>(null);
  useLayoutEffect(() => {
    const root = zone.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const next = new Map<string, { el: HTMLElement; left: number; top: number }>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next.set(el.dataset.flip ?? "", { el, left: r.left - base.left, top: r.top - base.top });
    });
    const was = prev.current;
    prev.current = new Map([...next].map(([k, n]) => [k, { left: n.left, top: n.top }]));
    if (!on || !was || !motionOn()) return;
    const entering = [...next.keys()].some((k) => !was.has(k));
    const from = entering ? takeSource() : null;
    for (const [k, n] of next) {
      const o = was.get(k);
      if (o) {
        const dx = o.left - n.left;
        const dy = o.top - n.top;
        if (dx || dy) shift(n.el, dx, dy);
      } else if (from) flyIn(n.el, from);
      else popIn(n.el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
}
