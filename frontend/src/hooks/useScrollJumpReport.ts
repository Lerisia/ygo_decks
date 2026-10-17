import { useEffect } from "react";
import { trackEvent } from "@/api/analyticsApi";

const JUMP = 300;      // px the page must move up, right after a field is focused, to count
const WINDOW_MS = 1500;

/** The phone's keyboard jump (엘리스 2026-10-17): as the keyboard rises for a field, iOS Safari sometimes scrolls the
 *  page far up — the beacon caught it 91 ms after focus, with the visual viewport's height reported as -24 and the
 *  field left at the layout viewport's bottom, under the keyboard. Nothing of ours scrolls there. So when a field is
 *  focused and the page then moves up by more than JUMP px within WINDOW_MS (a pattern no wanted scroll makes: a
 *  tapped field is on screen, and showing it never needs the page to go up that far), the page is put back where it
 *  was, and two "scroll_jump" events report what happened (scroll, document height and seen height before and after;
 *  the delay, the focused element, resize events, history entry and path) plus where the page stood 400 ms after
 *  being put back, to be read on the server. The reporting goes once the fix is seen to hold. */
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
      let puts = 0;
      let done = false;
      const onResize = () => { resizes += 1; };
      const stop = () => {
        done = true;
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        vv?.removeEventListener("resize", onResize);
      };
      const onScroll = () => {
        if (done) return;
        const y1 = window.scrollY;
        if (y0 - y1 < JUMP) return;
        if (puts === 0) {
          const active = (document.activeElement?.tagName ?? "-").toLowerCase();
          trackEvent("scroll_jump", `y${y0}>${y1} h${h0}>${document.documentElement.scrollHeight} s${seen0}>${seen()}`.slice(0, 40));
          trackEvent("scroll_jump", `t${Math.round(performance.now() - started)} a${active} r${resizes} k${entry() === entry0 ? 0 : 1} p${window.location.pathname === path0 ? 0 : 1}`.slice(0, 40));
        }
        puts += 1;
        window.scrollTo(0, y0);   // back to where the field was tapped
        if (puts >= 3) stop();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      vv?.addEventListener("resize", onResize);
      setTimeout(() => {
        stop();
        if (puts) trackEvent("scroll_jump", `f${puts} y${window.scrollY} s${seen()}`.slice(0, 40));   // where it ended up
      }, WINDOW_MS);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
}
