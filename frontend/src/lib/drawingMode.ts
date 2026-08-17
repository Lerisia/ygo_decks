import { useSyncExternalStore } from "react";

/** Global "drawing mode" flag. When a player is actively drawing (DuchMind
 *  multiplayer turn, or the Solo draw page), the site chrome — navbar,
 *  footer, mobile bottom tab bar — is hidden so nothing overlaps or
 *  distracts from the canvas. The drawing views flip this on/off; App.tsx
 *  reads it to gate the chrome. */
let _on = false;
const subs = new Set<() => void>();

export function setDrawingMode(v: boolean) {
  if (_on === v) return;
  _on = v;
  subs.forEach((f) => f());
}

export function useDrawingMode(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => _on,
    () => false,
  );
}
