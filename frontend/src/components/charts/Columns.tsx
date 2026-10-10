import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_BLUE, TOOLTIP_STYLE } from "./theme";

export function ColumnChart<T extends object>({
  data,
  xKey,
  yKey,
  valueName,
  xTick = (v) => String(v),
  height = 200,
}: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  valueName: string;
  xTick?: (v: string) => string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <XAxis dataKey={xKey} tickFormatter={xTick} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => [v.toLocaleString(), valueName]}
          labelFormatter={(d) => String(d)}
          contentStyle={TOOLTIP_STYLE}
        />
        <Bar dataKey={yKey} fill={CHART_BLUE} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
