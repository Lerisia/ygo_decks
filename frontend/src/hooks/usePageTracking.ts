import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { sendPageView } from "@/api/analyticsApi";

/** Reports each SPA page visit with its dwell time when the user leaves it
 *  (route change, tab hidden, or page unload). Time spent while the tab is
 *  hidden is not counted. */
export function usePageTracking() {
  const { pathname } = useLocation();
  const current = useRef<{ path: string; startedAt: number; accumulated: number } | null>(null);

  useEffect(() => {
    const flush = () => {
      const c = current.current;
      if (!c) return;
      const total = c.accumulated + (document.visibilityState === "visible" ? Date.now() - c.startedAt : 0);
      if (total >= 500) sendPageView(c.path, total);
      current.current = null;
    };
    const onVisibility = () => {
      const c = current.current;
      if (!c) return;
      if (document.visibilityState === "hidden") {
        c.accumulated += Date.now() - c.startedAt;
        // report now — mobile browsers may never fire pagehide/unload
        sendPageView(c.path, c.accumulated);
        c.accumulated = 0;
        c.startedAt = Date.now();
      } else {
        c.startedAt = Date.now();
      }
    };

    flush();
    current.current = { path: pathname, startedAt: Date.now(), accumulated: 0 };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
