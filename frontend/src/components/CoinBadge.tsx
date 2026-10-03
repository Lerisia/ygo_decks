import type { CSSProperties } from "react";

// Round "coin" mark on deck covers — gold E for engines (특이점 2026-10-02), blue U for upcoming decks (2026-10-03).
const PALETTES: Record<"gold" | "blue", CSSProperties> = {
  gold: {
    background: "radial-gradient(circle at 32% 28%, #fff7d1 0%, #fcd34d 30%, #f59e0b 64%, #b45309 100%)",
    boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.55), inset 0 -2px 3px rgba(120,53,15,0.35), 0 1px 3px rgba(0,0,0,0.35)",
    color: "#7c2d12",
    textShadow: "0 1px 0 rgba(255,255,255,0.65)",
  },
  blue: {
    background: "radial-gradient(circle at 32% 28%, #e0f2fe 0%, #60a5fa 30%, #2563eb 64%, #1e3a8a 100%)",
    boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.5), inset 0 -2px 3px rgba(30,58,138,0.45), 0 1px 3px rgba(0,0,0,0.35)",
    color: "#ffffff",
    textShadow: "0 1px 1px rgba(30,58,138,0.85)",
  },
};

interface Props {
  letter: string;
  palette: "gold" | "blue";
  title: string;
  label: string;
  className?: string;
}

export default function CoinBadge({ letter, palette, title, label, className = "" }: Props) {
  return (
    <span
      className={`rounded-full font-black leading-none flex items-center justify-center ring-2 ring-white dark:ring-gray-900 ${className}`}
      style={PALETTES[palette]}
      title={title}
      aria-label={label}
    >
      {letter}
    </span>
  );
}
