import { useId } from "react";

// The logo drawn as parts (참혈 2026-10-14, from their two keyframes at 2048 px): the inverted triangle, and the card
// that splits into two, fanned out ±43° in the second frame — a little shorter there, its oval a little fuller, as drawn.
const STROKE = 60;
const TRIANGLE = "151.8,413.5 1895.2,413.5 1023.5,1754.6";
const CARD = { x: 738, y: 413.5, w: 566, h: 883, cx: 1021, cy: 855 };
const OVAL = { cx: 1021, cy: 837, rx: 110, ry: 191 };
const SPREAD = { dx: 389, cy: 771, turn: 43, squash: 0.895, ovalX: 1.18, ovalY: 1.155 };
const VIEW = { x: 60, y: 200, w: 1928, h: 1650 };

const cardAt = (side: -1 | 1, t: 0 | 1) =>
  `translate(${CARD.cx + side * SPREAD.dx * t}px, ${CARD.cy + (SPREAD.cy - CARD.cy) * t}px) rotate(${side * SPREAD.turn * t}deg) ` +
  `scale(1, ${1 + (SPREAD.squash - 1) * t}) translate(${-CARD.cx}px, ${-CARD.cy}px)`;
const ovalAt = (t: 0 | 1) =>
  `translate(${OVAL.cx}px, ${OVAL.cy}px) scale(${1 + (SPREAD.ovalX - 1) * t}, ${1 + (SPREAD.ovalY - 1) * t}) translate(${-OVAL.cx}px, ${-OVAL.cy}px)`;

const pct = (ms: number, total: number) => `${((ms / total) * 100).toFixed(3)}%`;

/** The keyframes of one loop: `shuffles` shuffles, each the cards fanning out to the second frame and coming back
 *  together, the left one going in front as they start to close (참혈 2026-10-14: it always opens behind), then a
 *  rest. */
function loopCss(name: string, shuffleMs: number, pauseMs: number, shuffles: number, swap: boolean) {
  const total = shuffles * shuffleMs + pauseMs;
  const card = (side: -1 | 1) => {
    const steps = [`0% { transform: ${cardAt(side, 0)}; }`];
    for (let i = 0; i < shuffles; i++) {
      const b = i * shuffleMs;
      steps.push(`${pct(b + 0.38 * shuffleMs, total)}, ${pct(b + 0.48 * shuffleMs, total)} { transform: ${cardAt(side, 1)}; }`);
      steps.push(`${pct(b + 0.92 * shuffleMs, total)} { transform: ${cardAt(side, 0)}; }`);
    }
    steps.push(`100% { transform: ${cardAt(side, 0)}; }`);
    return steps.join(" ");
  };
  const oval = [`0% { transform: ${ovalAt(0)}; }`];
  for (let i = 0; i < shuffles; i++) {
    const b = i * shuffleMs;
    oval.push(`${pct(b + 0.38 * shuffleMs, total)}, ${pct(b + 0.48 * shuffleMs, total)} { transform: ${ovalAt(1)}; }`);
    oval.push(`${pct(b + 0.92 * shuffleMs, total)} { transform: ${ovalAt(0)}; }`);
  }
  oval.push(`100% { transform: ${ovalAt(0)}; }`);
  // the left card's top copy: shown while the left card is in front. Each shuffle opens with the right one in front
  // (the second frame) and the left one comes in front as they start to close; it goes back behind once they are
  // stacked, where it makes no difference which is on top.
  const front = [`0% { opacity: 0; }`];
  for (let i = 0; i < shuffles && swap; i++) {
    const b = i * shuffleMs;
    front.push(`${pct(b + 0.48 * shuffleMs, total)} { opacity: 1; }`);
    front.push(`${pct(b + 0.96 * shuffleMs, total)} { opacity: 0; }`);
  }
  front.push(`100% { opacity: 0; }`);
  const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
  return `
@keyframes ${name}-l { ${card(-1)} }
@keyframes ${name}-r { ${card(1)} }
@keyframes ${name}-o { ${oval.join(" ")} }
@keyframes ${name}-f { ${front.join(" ")} }
.${name} .ll-l { animation: ${name}-l ${total}ms ${ease} infinite; }
.${name} .ll-r { animation: ${name}-r ${total}ms ${ease} infinite; }
.${name} .ll-o { animation: ${name}-o ${total}ms ${ease} infinite; }
.${name} .ll-f { animation: ${name}-f ${total}ms step-end infinite; }
@media (prefers-reduced-motion: reduce) {
  .${name} * { animation: none !important; }
  .${name} { animation: ${name}-calm 1.6s ease-in-out infinite; }
  @keyframes ${name}-calm { 50% { opacity: 0.55; } }
}`;
}

function Card({ className }: { className: string }) {
  return (
    <g className={className}>
      <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} fill="#fff" stroke="#000" strokeWidth={STROKE} />
      <ellipse className="ll-o" cx={OVAL.cx} cy={OVAL.cy} rx={OVAL.rx} ry={OVAL.ry} fill="#000" />
    </g>
  );
}

/** A loading mark made of the logo (참혈 2026-10-14): the card in the triangle splits in two and shuffles — three
 *  shuffles, a rest, again. Black lines on white, turned over like the menu logo on dark screens; still for those
 *  who ask for less motion. */
export default function LogoLoader({
  size = 64, shuffleMs = 600, pauseMs = 700, shuffles = 3, swap = true, label = "불러오는 중", className = "",
}: {
  /** width in px; the height follows the logo's shape */
  size?: number;
  shuffleMs?: number;
  pauseMs?: number;
  shuffles?: number;
  swap?: boolean;
  label?: string;
  className?: string;
}) {
  const name = `ll${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      role="status"
      aria-label={label}
      width={size}
      height={(size * VIEW.h) / VIEW.w}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      className={`${name} dark:invert ${className}`}
    >
      <style>{loopCss(name, shuffleMs, pauseMs, shuffles, swap)}</style>
      <polygon points={TRIANGLE} fill="#fff" stroke="#000" strokeWidth={STROKE} strokeLinejoin="miter" />
      <Card className="ll-l" />
      <Card className="ll-r" />
      <g className="ll-f">
        <Card className="ll-l" />
      </g>
    </svg>
  );
}
