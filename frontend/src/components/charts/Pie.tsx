import { useEffect, useId, useRef, useState } from "react";
import type { MetaDeckStat } from "@/api/toolApi";
import UpdateBadge from "@/components/UpdateBadge";
import { MEDALS, rateTone } from "./theme";

type Props = {
  data: MetaDeckStat[];
  deckCovers: Record<number, string>;
  /** Show what the U mark means — only while a ranked deck carries it. */
  showUpdateKey?: boolean;
  total?: number;
  since?: string;
  active?: number | null;
  onActive?: (id: number | null) => void;
};

const RAD = Math.PI / 180;
// Ranks run counter-clockwise from 12 o'clock (특이점 2026-10-10).
const START_ANGLE = 90;
const HOLE = 0.44;
const MAX_R = 190;
const MIN_R = 90;
const MARGIN = 16;
const POP = 6;

const pt = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.cos(deg * RAD), cy - r * Math.sin(deg * RAD)];

const ringPath = (cx: number, cy: number, ro: number, ri: number, a0: number, a1: number) => {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = pt(cx, cy, ro, a0);
  const [x1, y1] = pt(cx, cy, ro, a1);
  const [x2, y2] = pt(cx, cy, ri, a1);
  const [x3, y3] = pt(cx, cy, ri, a0);
  return `M${x0},${y0} A${ro},${ro} 0 ${large} 0 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 1 ${x3},${y3} Z`;
};

const artBox = (cx: number, cy: number, ro: number, ri: number, a0: number, a1: number) => {
  const pts = [pt(cx, cy, ro, a0), pt(cx, cy, ro, a1), pt(cx, cy, ri, a0), pt(cx, cy, ri, a1)];
  for (let a = Math.ceil(a0 / 90) * 90; a < a1; a += 90) pts.push(pt(cx, cy, ro, a));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const side = Math.max(w, h) * 1.04;
  return { x: x + w / 2 - side / 2, y: y + h / 2 - side / 2, side };
};

export const UsagePie = ({ data, deckCovers, showUpdateKey = false, total, since, active = null, onActive }: Props) => {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const own = hover ?? pinned;
  useEffect(() => {
    onActive?.(own);
  }, [own, onActive]);
  const shown = own ?? active;

  const top10 = data.slice(0, 10);
  const rest = Math.max(0, 100 - top10.reduce((sum, d) => sum + d.appearance_percent, 0));
  const items = [
    ...top10.map((d, i) => ({ ...d, id: d.meta_deck_id, rank: i + 1, cover: d.cover_image_chart || deckCovers[d.meta_deck_id] || "" })),
    { meta_deck_id: -1, meta_deck_name: "기타", appearance_percent: rest, win_rate: 0, is_upcoming: false, id: -1, rank: 0, cover: "" },
  ];
  const sum = items.reduce((a, d) => a + d.appearance_percent, 0) || 1;

  const R = Math.max(MIN_R, Math.min(MAX_R, Math.floor(boxWidth / 2 - MARGIN)));
  const ri = R * HOLE;
  const height = 2 * (R + MARGIN);
  const cx = boxWidth / 2;
  const cy = height / 2;
  const fs = Math.max(11, Math.min(15, ri / 5.6));

  let cum = START_ANGLE;
  const slices = items.map((d) => {
    const a0 = cum;
    const a1 = cum + (d.appearance_percent / sum) * 360;
    cum = a1;
    return { ...d, a0, a1, mid: (a0 + a1) / 2 };
  });
  const sel = slices.find((s) => s.id === shown) ?? null;

  const pick = (id: number) => setPinned((p) => (p === id ? null : id));

  return (
    // On PC the pie sits at the vertical middle of the 1~10위 list beside it (특이점 2026-10-10); the title is lifted out of
    // the flow and the equal top/bottom padding keeps it clear of the pie.
    <div className={`w-full md:h-full md:relative md:flex md:flex-col md:justify-center ${showUpdateKey ? "md:py-14" : "md:py-9"}`}>
      <div className="mb-2 flex flex-col gap-1 md:absolute md:top-0 md:left-0 md:right-0">
        <h3 className="text-lg font-semibold">사용률 차트</h3>
        {/* What the U mark on slices and rows means, right under the title (특이점 2026-10-10). */}
        {showUpdateKey && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <UpdateBadge className="w-4 h-4 text-[9px] shrink-0" />
            최근 게임 업데이트로 새로 등록되거나 업데이트된 덱
          </span>
        )}
      </div>
      <div ref={boxRef} className="relative -mx-2 sm:mx-0" style={{ height }}>
        {boxWidth > 0 && (
          <svg width={boxWidth} height={height} className="block overflow-visible">
            <defs>
              <radialGradient id={`${uid}-coin`} cx="32%" cy="28%" r="75%">
                <stop offset="0%" stopColor="#7aa7ff" />
                <stop offset="30%" stopColor="#1f5cff" />
                <stop offset="64%" stopColor="#0b3fd6" />
                <stop offset="100%" stopColor="#0a2a8f" />
              </radialGradient>
              {slices.map((s) => (
                <clipPath key={s.id} id={`${uid}-${s.id}`}>
                  <path d={ringPath(cx, cy, R, ri, s.a0, s.a1)} />
                </clipPath>
              ))}
            </defs>
            <circle cx={cx} cy={cy} r={ri} fill="transparent" onClick={() => setPinned(null)} />
            {slices.map((s) => {
              const on = shown === s.id;
              const [dx, dy] = on ? [POP * Math.cos(s.mid * RAD), -POP * Math.sin(s.mid * RAD)] : [0, 0];
              const b = artBox(cx, cy, R, ri, s.a0, s.a1);
              const d = ringPath(cx, cy, R, ri, s.a0, s.a1);
              const [ux, uy] = pt(cx, cy, R - 2, s.mid);
              const ur = R < 140 ? 7 : 8.5;
              return (
                <g
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={s.rank ? `${s.rank}위 ${s.meta_deck_name} 사용률 ${s.appearance_percent}%` : `기타 ${s.appearance_percent.toFixed(1)}%`}
                  className="cursor-pointer outline-none transition-[transform,opacity] duration-150"
                  style={{ transform: `translate(${dx}px, ${dy}px)`, opacity: shown != null && !on ? 0.45 : 1 }}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHover(s.id)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
                  onFocus={() => setHover(s.id)}
                  onBlur={() => setHover(null)}
                  onClick={() => pick(s.id)}
                >
                  {s.cover ? (
                    <image href={s.cover} x={b.x} y={b.y} width={b.side} height={b.side} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${uid}-${s.id})`} />
                  ) : (
                    <path d={d} className="fill-gray-200 dark:fill-gray-700" />
                  )}
                  <path d={d} fill="none" strokeWidth={3} strokeLinejoin="round" className="stroke-white dark:stroke-gray-800" />
                  {s.id === -1 && s.a1 - s.a0 > 28 && (() => {
                    const [tx, ty] = pt(cx, cy, (R + ri) / 2, s.mid);
                    return (
                      <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize={fs - 1} fontWeight={600} className="fill-gray-500 dark:fill-gray-300 pointer-events-none">
                        기타 {s.appearance_percent.toFixed(1)}%
                      </text>
                    );
                  })()}
                  {/* 신규 업데이트 덱: the deck book's blue U coin on the slice's outer edge (특이점 2026-10-10) */}
                  {s.is_upcoming && (
                    <g className="pointer-events-none">
                      <circle cx={ux} cy={uy} r={ur} fill={`url(#${uid}-coin)`} stroke="#fff" strokeWidth={1.5} />
                      <text x={ux} y={uy} textAnchor="middle" dominantBaseline="central" fontSize={ur * 1.1} fontWeight={900} fill="#fff">U</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {boxWidth > 0 && (
          <div
            className="absolute flex flex-col items-center justify-center text-center pointer-events-none"
            style={{ left: cx - ri * 0.86, top: cy - ri, width: ri * 1.72, height: ri * 2, fontSize: fs }}
          >
            {sel ? (
              <>
                {sel.rank > 0 ? (
                  <span
                    className="rounded-full grid place-items-center font-extrabold text-white mb-0.5"
                    style={{ width: fs * 1.35, height: fs * 1.35, fontSize: fs * 0.8, backgroundColor: MEDALS[sel.rank - 1] ?? "#6b7280" }}
                  >
                    {sel.rank}
                  </span>
                ) : null}
                <b className="leading-tight line-clamp-2 break-keep" style={{ fontSize: fs + 1 }}>{sel.meta_deck_name}</b>
                <span className="font-bold text-blue-600 dark:text-blue-400 tabular-nums leading-tight" style={{ fontSize: fs * 1.45 }}>
                  {sel.rank > 0 ? sel.appearance_percent : sel.appearance_percent.toFixed(1)}%
                </span>
                {sel.rank > 0 ? (
                  <span className="tabular-nums text-gray-500 dark:text-gray-400" style={{ fontSize: fs - 1 }}>
                    승률 <span className={rateTone(sel.win_rate)}>{sel.win_rate}%</span>
                  </span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400" style={{ fontSize: fs - 1 }}>11위 아래 덱</span>
                )}
              </>
            ) : (
              <>
                {total != null && <b className="tabular-nums leading-tight" style={{ fontSize: fs * 1.6 }}>{total.toLocaleString()}판</b>}
                {since && <span className="text-gray-500 dark:text-gray-400 leading-tight mt-0.5" style={{ fontSize: fs - 2 }}>{since}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
