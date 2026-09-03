import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { leavePageView, startPageView } from "@/api/analyticsApi";

type Visit = { path: string; id: number | null; startedAt: number; accumulated: number; reported: number };

/** Counts each SPA page visit at entry and attaches the dwell time (visible
 *  tab only, cumulative) whenever the user leaves: route change, tab hidden,
 *  or page unload. Losing the final leave beacon only loses that page's
 *  dwell time, never the view itself. */
export function usePageTracking() {
  const { pathname } = useLocation();
  const current = useRef<Visit | null>(null);

  useEffect(() => {
    const report = (v: Visit) => {
      const visible = document.visibilityState === "visible";
      const total = v.accumulated + (visible ? Date.now() - v.startedAt : 0);
      if (v.id !== null && total > v.reported) {
        v.reported = total;
        leavePageView(v.id, total);
      }
    };
    const flush = () => {
      const v = current.current;
      if (v) report(v);
    };
    const onVisibility = () => {
      const v = current.current;
      if (!v) return;
      if (document.visibilityState === "hidden") {
        v.accumulated += Date.now() - v.startedAt;
        report(v);
      } else {
        v.startedAt = Date.now();
      }
    };

    flush();
    const visit: Visit = { path: pathname, id: null, startedAt: Date.now(), accumulated: 0, reported: 0 };
    current.current = visit;
    startPageView(pathname).then((id) => {
      if (current.current === visit) visit.id = id;
      else if (id !== null) {
        // user already left this page before the entry call returned
        leavePageView(id, visit.accumulated || Date.now() - visit.startedAt);
      }
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
