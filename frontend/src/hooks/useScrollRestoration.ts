import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Where each history entry was scrolled to, so Back returns to the same spot (엘리스 2026-10-02: coming back to
// the deck database from a deck page used to land at the top). Forward navigation still starts at the top.
const positions = new Map<string, number>();

export function useScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const lastPath = useRef(location.pathname);

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);

  // Record this entry's position while it is on screen. Layout effect so the listener is gone before the next
  // page can clamp the scroll and overwrite it.
  useLayoutEffect(() => {
    const key = location.key;
    const save = () => positions.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [location.key]);

  useLayoutEffect(() => {
    const pathChanged = lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    if (navType !== "POP") {
      if (pathChanged) window.scrollTo(0, 0);
      return;
    }
    const target = positions.get(location.key) ?? 0;
    // The page may still be filling in; keep trying until it is tall enough, the user scrolls, or ~1.5 s pass.
    let cancelled = false;
    const started = performance.now();
    const stop = () => (cancelled = true);
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });
    const attempt = () => {
      if (cancelled) return;
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && performance.now() - started < 1500) requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelled = true;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [location.key, location.pathname, navType]);
}
