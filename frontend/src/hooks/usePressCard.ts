import { useRef } from "react";

const HOLD_MS = 450;   // held this long, a press shows the card instead
const SLOP = 10;       // a finger that moves further is scrolling

/** A card that does one thing when pressed and shows itself when held, as Master Duel's deck editor does on a phone
 *  (엘리스 2026-10-14). With a mouse, as the game's PC editor does (엘리스 2026-10-18): a click shows the card, the
 *  right button does the thing — puts it in, takes it out — and so does a drag (the card's own draggable). With
 *  `mouseClicks` a mouse works as a finger does (a click does the thing, the right button shows): a 대표 카드 being
 *  set, a card read from a picture. The props go on the card's button. */
export function usePressCard() {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const mouse = useRef(false);   // the pointer that last pressed was a mouse
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return (onPress: () => void, onShow: () => void, mouseClicks = false) => ({
    onPointerDown: (e: React.PointerEvent) => {
      held.current = false;
      mouse.current = e.pointerType === "mouse";
      if (mouse.current) return;   // a mouse: the click, the right button (onContextMenu) and a drag each do their own
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        held.current = true;
        start.current = null;
        onShow();
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick: () => {
      if (held.current) held.current = false;   // the hold showed the card: the release presses nothing
      else if (mouse.current && !mouseClicks) onShow();
      else onPress();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      if (mouse.current && !mouseClicks) onPress();
      else onShow();
    },
    // a held card on a phone opens no selection or callout of its own
    style: { WebkitTouchCallout: "none", userSelect: "none" } as React.CSSProperties,
  });
}
