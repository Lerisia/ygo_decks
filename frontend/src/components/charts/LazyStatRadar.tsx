import { lazy, Suspense, type ComponentProps } from "react";

const StatRadar = lazy(() => import("./Radar").then((m) => ({ default: m.StatRadar })));

/** The deck stats radar, its charting library fetched after the page: the box keeps the chart's height meanwhile, so
 *  nothing below moves when it draws (2026-10-12). */
export function LazyStatRadar(props: ComponentProps<typeof StatRadar>) {
  return (
    <Suspense fallback={<div className={`relative ${props.className ?? ""}`} style={{ height: props.height }}>{props.children}</div>}>
      <StatRadar {...props} />
    </Suspense>
  );
}
