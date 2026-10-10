import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import type { MetaDeckStat } from "@/api/toolApi";
import UpdateBadge from "@/components/UpdateBadge";
import { OTHERS_COLOR, SLICE_FILL, sliceColor } from "./theme";

type Props = {
  data: MetaDeckStat[];
  deckCovers: Record<number, string>;
  /** Show what the U mark means — only while a ranked deck carries it. */
  showUpdateKey?: boolean;
};

// Up to 200px on PC (특이점 2026-10-10); narrower columns shrink it so the circles still fit.
const MAX_PIE_RADIUS = 200;
const MIN_PIE_RADIUS = 90;
// Ring offsets beyond the pie's edge: on the edge, then one and two circles further out.
const ringOffsets = (avatarR: number) => {
  const step = avatarR * 2 + 4;
  return [4, 4 + step, 4 + step * 2];
};
const RAD = Math.PI / 180;
// Ranks run counter-clockwise from 12 o'clock (특이점 2026-10-10).
const START_ANGLE = 90;
const END_ANGLE = 450;

// Thin neighbouring slices would stack their circles, so a circle that would touch an earlier one moves out a ring.
const avatarRings = (percents: number[], radius: number, avatarR: number) => {
  const offsets = ringOffsets(avatarR);
  const total = percents.reduce((a, b) => a + b, 0) || 1;
  const placed: { x: number; y: number }[] = [];
  let cum = 0;
  return percents.map((p) => {
    const mid = (START_ANGLE + ((cum + p / 2) / total) * (END_ANGLE - START_ANGLE)) * RAD;
    cum += p;
    for (let ring = 0; ring < offsets.length; ring++) {
      const x = (radius + offsets[ring]) * Math.cos(mid);
      const y = (radius + offsets[ring]) * Math.sin(mid);
      if (ring === offsets.length - 1 || placed.every((q) => Math.hypot(q.x - x, q.y - y) >= avatarR * 2 + 4)) {
        placed.push({ x, y });
        return ring;
      }
    }
    return 0;
  });
};

export const UsagePie = ({ data, deckCovers, showUpdateKey = false }: Props) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Smaller circles on phones leave more of the width to the pie itself.
  const avatarR = boxWidth && boxWidth < 520 ? 13 : 18;
  const offsets = ringOffsets(avatarR);

  const top10 = data.slice(0, 10);
  const totalPercent = top10.reduce((sum, d) => sum + d.appearance_percent, 0);
  const othersPercent = Math.max(0, 100 - totalPercent);

  const chartData = [
    ...top10.map((deck) => ({
      ...deck,
      id: deck.meta_deck_id,
      label: deck.meta_deck_name,
      cover: deckCovers[deck.meta_deck_id] || "",
    })),
    {
      id: -1,
      label: "기타",
      appearance_percent: othersPercent,
      win_rate: 0,
      cover: "",
      is_upcoming: false,
    },
  ];
  // As large as the column allows while the first ring of circles still fits beside it.
  const radius = Math.max(MIN_PIE_RADIUS, Math.min(MAX_PIE_RADIUS, Math.floor(boxWidth / 2 - offsets[1] - avatarR - 6)));
  const rings = avatarRings(chartData.map((d) => d.appearance_percent), radius, avatarR);
  // The box hugs the pie and its circles, so no empty band is left where no circle sits.
  let top = -radius;
  let bottom = radius;
  {
    const total = chartData.reduce((a, d) => a + d.appearance_percent, 0) || 1;
    let cum = 0;
    chartData.forEach((d, i) => {
      const mid = (START_ANGLE + ((cum + d.appearance_percent / 2) / total) * (END_ANGLE - START_ANGLE)) * RAD;
      cum += d.appearance_percent;
      if (i >= top10.length) return;
      const y = -(radius + offsets[rings[i]]) * Math.sin(mid);
      top = Math.min(top, y - avatarR - 4);
      bottom = Math.max(bottom, y + avatarR + 4);
    });
  }
  // On PC the box is centred beside the list, so it stays symmetric about the pie's centre to put that centre mid-list.
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
    const half = Math.max(-top, bottom);
    top = -half;
    bottom = half;
  }
  const pad = 6;
  const height = boxWidth ? Math.ceil(bottom - top) + pad * 2 : 2 * (MAX_PIE_RADIUS + offsets[1] + avatarR + 8);
  const centreY = Math.round(pad - top);

  const renderAvatar = ({ cx, cy, midAngle, index }: { cx: number; cy: number; midAngle: number; index: number }) => {
    const entry = chartData[index];
    if (!entry || entry.id === -1) return null;
    const color = sliceColor(index);
    const r = radius + offsets[rings[index]];
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    const edgeX = cx + radius * Math.cos(-midAngle * RAD);
    const edgeY = cy + radius * Math.sin(-midAngle * RAD);
    return (
      <g key={`avatar-${entry.id}`}>
        <title>{`${index + 1}위 ${entry.label} · ${entry.appearance_percent}%`}</title>
        {rings[index] > 0 && <line x1={edgeX} y1={edgeY} x2={x} y2={y} stroke={color} strokeWidth={1.5} />}
        <circle cx={x} cy={y} r={avatarR + 4} className="fill-white dark:fill-gray-800" />
        <circle cx={x} cy={y} r={avatarR + 2} fill={color} />
        <clipPath id={`deck-avatar-${entry.id}`}>
          <circle cx={x} cy={y} r={avatarR} />
        </clipPath>
        {entry.cover ? (
          <image
            href={entry.cover}
            x={x - avatarR}
            y={y - avatarR}
            width={avatarR * 2}
            height={avatarR * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#deck-avatar-${entry.id})`}
          />
        ) : (
          <circle cx={x} cy={y} r={avatarR} className="fill-gray-200 dark:fill-gray-700" />
        )}
        {/* 신규 업데이트 덱: the deck book's blue U coin out on the circle's top-left edge, clear of the picture (특이점 2026-10-10) */}
        {entry.is_upcoming && (
          <g>
            <circle cx={x - avatarR * 0.95} cy={y - avatarR * 0.95} r={avatarR * 0.46} fill="url(#meta-update-coin)" stroke="#fff" strokeWidth={1.5} />
            <text
              x={x - avatarR * 0.95}
              y={y - avatarR * 0.95}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={avatarR * 0.54}
              fontWeight={900}
              fill="#fff"
            >
              U
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    // On PC the pie sits at the vertical middle of the 1~10위 list beside it (특이점 2026-10-10); the title is lifted out of
    // the flow and the equal top/bottom padding keeps it clear of the pie.
    <div className={`w-full md:h-full md:relative md:flex md:flex-col md:justify-center ${showUpdateKey ? "md:py-14" : "md:py-9"}`}>
      <div className="mb-2 flex flex-col gap-1 md:absolute md:top-0 md:left-0 md:right-0">
        <h3 className="text-lg font-semibold">사용률 차트</h3>
        {/* What the U mark on circles and rows means, right under the title (특이점 2026-10-10). */}
        {showUpdateKey && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <UpdateBadge className="w-4 h-4 text-[9px] shrink-0" />
            최근 게임 업데이트로 새로 등록되거나 업데이트된 덱
          </span>
        )}
      </div>
      {/* On phones the pie also takes the card's side padding. */}
      <div ref={boxRef} className="-mx-2 sm:mx-0" style={{ height }}>
        {boxWidth > 0 && (
          <PieChart width={boxWidth} height={height} style={{ overflow: "visible" }}>
            <defs>
              <radialGradient id="meta-update-coin" cx="32%" cy="28%" r="75%">
                <stop offset="0%" stopColor="#7aa7ff" />
                <stop offset="30%" stopColor="#1f5cff" />
                <stop offset="64%" stopColor="#0b3fd6" />
                <stop offset="100%" stopColor="#0a2a8f" />
              </radialGradient>
            </defs>
            <Pie
              data={chartData}
              dataKey="appearance_percent"
              nameKey="label"
              cx="50%"
              cy={centreY}
              outerRadius={radius}
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              label={renderAvatar}
              labelLine={false}
              isAnimationActive={false}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.id}
                  fill={entry.id === -1 ? OTHERS_COLOR : SLICE_FILL[i] ?? sliceColor(i)}
                  strokeWidth={2}
                  className="stroke-white dark:stroke-gray-800"
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => `${value.toFixed(1)}%`}
              contentStyle={{ fontSize: "0.875rem" }}
            />
          </PieChart>
        )}
      </div>
    </div>
  );
};
