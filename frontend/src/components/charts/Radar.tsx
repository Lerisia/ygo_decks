import type { ReactNode } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { DeckStats } from "@/api/deckApi";
import { statPlot, statText } from "@/utils/deckStats";
import { EMPTY_GRAY, RADAR_BLUE } from "./theme";

const STAT_LABELS = [
  { key: "consistency", label: "안정성" },
  { key: "breakthrough", label: "돌파력" },
  { key: "deck_space", label: "덱 스페이스" },
  { key: "recovery", label: "복구력" },
  { key: "interruption", label: "견제력" },
] as const;

export function StatRadar({ stats, height, className = "", children }: { stats?: DeckStats | null; height: number; className?: string; children?: ReactNode }) {
  const hasStats = !!stats && STAT_LABELS.some(({ key }) => stats?.[key] != null);
  const data = STAT_LABELS.map(({ key, label }) => ({ stat: label, value: statPlot(stats?.[key]), raw: stats?.[key] }));
  return (
    <div className={`relative ${className}`}>
      {children}
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid />
          <PolarAngleAxis
            dataKey="stat"
            tick={({ x, y, payload, index }: any) => {
              if (!hasStats) {
                return (
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-gray-400" style={{ fontSize: 15 }}>
                    {payload.value}
                  </text>
                );
              }
              const raw = data[index]?.raw;
              const display = `${payload.value} ${statText(raw)}`;
              return (
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-current" style={{ fontSize: 15, fontWeight: 600 }}>
                  {display}
                </text>
              );
            }}
          />
          <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
          <Radar
            dataKey="value"
            fill={hasStats ? RADAR_BLUE : EMPTY_GRAY}
            fillOpacity={hasStats ? 0.4 : 0.15}
            stroke={hasStats ? RADAR_BLUE : EMPTY_GRAY}
          />
        </RadarChart>
      </ResponsiveContainer>
      {!hasStats && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-gray-400 dark:text-gray-500 text-sm font-semibold bg-white/70 dark:bg-gray-900/70 px-3 py-1 rounded">
            정보 없음
          </span>
        </div>
      )}
    </div>
  );
}
