import { Suspense, type ComponentProps } from "react";
import { lazyChunk } from "@/lib/lazyChunk";

type Props = ComponentProps<typeof import("./Radar").StatRadar>;
const StatRadar = lazyChunk<Props>(() => import("./Radar").then((m) => ({ default: m.StatRadar })));

/** The deck stats radar, its charting library fetched after the page: the box keeps the chart's height meanwhile, so
 *  nothing below moves when it draws (2026-10-12). */
export function LazyStatRadar(props: Props) {
  return (
    <Suspense fallback={<div className={`relative ${props.className ?? ""}`} style={{ height: props.height }}>{props.children}</div>}>
      <StatRadar {...props} />
    </Suspense>
  );
}
