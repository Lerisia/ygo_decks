import { useRef } from "react";

const HOLD_MS = 450;   // held this long, a touch shows the card instead of pressing it
const SLOP = 10;       // a finger that moves further is scrolling

/** A card that does one thing when pressed and shows itself when held (a phone) or right-clicked (a computer), as
 *  Master Duel's deck editor does (엘리스 2026-10-14). The props go on the card's button. */
export function usePressCard() {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return (onPress: () => void, onShow: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      held.current = false;
      if (e.pointerType === "mouse") return;
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
      else onPress();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      onShow();
    },
    // a held card on a phone opens no selection or callout of its own
    style: { WebkitTouchCallout: "none", userSelect: "none" } as React.CSSProperties,
  });
}
