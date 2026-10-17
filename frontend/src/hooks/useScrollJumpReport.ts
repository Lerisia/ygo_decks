import { useEffect } from "react";
import { trackEvent } from "@/api/analyticsApi";

const JUMP = 300;      // px the page must move up, right after a field is focused, to count
const WINDOW_MS = 3000;

/** Diagnostic (엘리스 2026-10-17): on an iPhone the record form's deck fields sometimes send the page to the top as
 *  the keyboard rises, and nothing here reproduces it. When a field is focused and the page then scrolls up by more
 *  than JUMP px within WINDOW_MS, two "scroll_jump" events report what the page looked like around it (scroll,
 *  document height, seen height before and after; then the delay, the focused element, resize events, and whether
 *  the history entry or path changed), to be read on the server. Removed once the cause is found. */
export function useScrollJumpReport() {
  useEffect(() => {
    const vv = window.visualViewport;
    const seen = () => Math.round(vv?.height ?? window.innerHeight);
    const entry = () => String((window.history.state as { key?: string } | null)?.key ?? "");
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !/^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const y0 = window.scrollY;
      const h0 = document.documentElement.scrollHeight;
      const seen0 = seen();
      const entry0 = entry();
      const path0 = window.location.pathname;
      const started = performance.now();
      let resizes = 0;
      let done = false;
      const onResize = () => { resizes += 1; };
      const stop = () => {
        done = true;
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        vv?.removeEventListener("resize", onResize);
      };
      const onScroll = () => {
        const y1 = window.scrollY;
        if (done || y0 - y1 < JUMP) return;
        const active = (document.activeElement?.tagName ?? "-").toLowerCase();
        trackEvent("scroll_jump", `y${y0}>${y1} h${h0}>${document.documentElement.scrollHeight} s${seen0}>${seen()}`.slice(0, 40));
        trackEvent("scroll_jump", `t${Math.round(performance.now() - started)} a${active} r${resizes} k${entry() === entry0 ? 0 : 1} p${window.location.pathname === path0 ? 0 : 1}`.slice(0, 40));
        stop();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      vv?.addEventListener("resize", onResize);
      setTimeout(stop, WINDOW_MS);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
}
