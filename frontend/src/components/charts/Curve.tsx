import { Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { RANK_ORDER, rankIconSrc } from "@/utils/rankUtils";
import { CHART_BLUE, GRID_STROKE, TOOLTIP_STYLE } from "./theme";

export const RANK_SHORT_LABELS: Record<string, string> = {
  rookie2: "루키 2", rookie1: "루키 1",
  bronze5: "브론즈 5", bronze4: "브론즈 4", bronze3: "브론즈 3", bronze2: "브론즈 2", bronze1: "브론즈 1",
  silver5: "실버 5", silver4: "실버 4", silver3: "실버 3", silver2: "실버 2", silver1: "실버 1",
  gold5: "골드 5", gold4: "골드 4", gold3: "골드 3", gold2: "골드 2", gold1: "골드 1",
  platinum5: "플래 5", platinum4: "플래 4", platinum3: "플래 3", platinum2: "플래 2", platinum1: "플래 1",
  diamond5: "다이아 5", diamond4: "다이아 4", diamond3: "다이아 3", diamond2: "다이아 2", diamond1: "다이아 1",
  master5: "마스터 5", master4: "마스터 4", master3: "마스터 3", master2: "마스터 2", master1: "마스터 1",
};

export const rankToNumeric = (rank: string, wins: number | null): number => {
  const idx = RANK_ORDER.indexOf(rank);
  if (idx === -1) return 0;
  return idx + (wins ?? 0) / 8;
};

export type CurvePoint = { index: number; value: number; label: string };

// Rank axis label with the tier's emblem in front.
const RankTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value?: number } }) => {
  const rank = RANK_ORDER[payload?.value ?? -1];
  if (!rank) return null;
  const icon = rankIconSrc(rank);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      {icon && <image href={icon} x={-60} y={-8} width={16} height={16} />}
      <text x={-2} y={0} dy={3.5} fontSize={10} textAnchor="end" className="fill-gray-500 dark:fill-gray-400">{RANK_SHORT_LABELS[rank]}</text>
    </g>
  );
};

export function RankCurve({ data, mode, height = 210 }: { data: CurvePoint[]; mode: "rank" | "score"; height?: number }) {
  const yDomain: [number, number] = (() => {
    if (data.length === 0) return [0, 1];
    const vals = data.map((d) => d.value);
    if (mode === "rank") return [Math.max(0, Math.floor(Math.min(...vals))), Math.min(RANK_ORDER.length - 1, Math.ceil(Math.max(...vals)) + 0)];
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(10, (hi - lo) * 0.1);
    return [Math.floor((lo - pad) / 10) * 10, Math.ceil((hi + pad) / 10) * 10];
  })();
  const rankTicks = mode === "rank" ? Array.from({ length: yDomain[1] - yDomain[0] + 1 }, (_, i) => yDomain[0] + i) : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeOpacity={0.7} />
        <XAxis dataKey="index" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          domain={yDomain}
          ticks={rankTicks}
          allowDecimals={mode !== "rank"}
          tickFormatter={(v: number) => (mode === "rank" ? RANK_SHORT_LABELS[RANK_ORDER[v]] || "" : String(v))}
          tick={mode === "rank" ? <RankTick /> : { fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={mode === "rank" ? 64 : 42}
        />
        <Tooltip
          formatter={(_: number, __: string, props: { payload?: { label?: string } }) => [props.payload?.label ?? "", mode === "rank" ? "랭크" : "점수"]}
          labelFormatter={(v: number) => `${v}번째 듀얼`}
          contentStyle={TOOLTIP_STYLE}
        />
        <Area type="monotone" dataKey="value" stroke={CHART_BLUE} strokeWidth={2} fill={CHART_BLUE} fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
