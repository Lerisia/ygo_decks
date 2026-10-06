import { useEffect, useRef, useState } from "react";
import type { SheetSummary } from "@/api/toolApi";
import { rankIconSrc } from "@/utils/rankUtils";

// Pieces shared by the sheet list, the sheet page and its statistics (redesign 2026-10-06).

export const COIN_FRONT = "/images/coin_front.webp";
export const COIN_BACK = "/images/coin_back.webp";

export const rate = (wins: number, games: number) => (games > 0 ? (wins / games) * 100 : null);
export const pctText = (v: number | null | undefined, digits = 0) => (v == null ? "–" : `${v.toFixed(digits)}%`);
// Win rates read at a glance: clearly good in blue, clearly bad in red, the middle stays plain.
export const rateTone = (v: number | null | undefined) =>
  v == null ? "text-gray-400" : v > 55 ? "text-blue-600 dark:text-blue-400 font-semibold" : v < 45 ? "text-red-500 dark:text-red-400 font-semibold" : "";

/** The last results as a strip of chips, oldest first (the newest on the right). */
export function ResultChips({ recent, small = false, slots = 20 }: { recent: SheetSummary["recent"]; small?: boolean; slots?: number }) {
  const cells = Array.from({ length: slots }, (_, i) => recent[recent.length - slots + i]);
  return (
    <div className={`grid grid-cols-10 ${small ? "gap-[3px]" : "gap-1"}`} aria-label={`최근 ${recent.length}판`}>
      {cells.map((c, i) =>
        c ? (
          <span
            key={i}
            title={`${c.r === "win" ? "승" : "패"} · ${c.fs === "first" ? "선공" : "후공"}${c.coin ? ` · 코인 ${c.coin === "win" ? "이김" : "짐"}` : ""}`}
            className={`grid place-items-center font-bold text-white ${small ? "h-4 rounded text-[9px]" : "aspect-square rounded-md text-[11px]"} ${
              c.r === "win" ? "bg-blue-600" : "bg-red-500"
            }`}
          >
            {c.fs === "first" ? "선" : "후"}
          </span>
        ) : (
          <span key={i} className={`${small ? "h-4 rounded" : "aspect-square rounded-md"} bg-gray-100 dark:bg-gray-700/60`} />
        ),
      )}
    </div>
  );
}

/** One small figure with a thin bar under it. */
export function BarStat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex justify-between items-baseline text-xs text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <b className="text-sm text-gray-900 dark:text-gray-100 tabular-nums">{pctText(value)}</b>
      </div>
      <div className="h-1.5 rounded-full bg-red-100 dark:bg-red-950/50 overflow-hidden">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${value ?? 0}%` }} />
      </div>
      {sub && <small className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{sub}</small>}
    </div>
  );
}

/** Win rate when the coin was won vs lost — in Master Duel the coin decides a lot, so it gets its own block. */
export function CoinSplit({ winGames, winWins, loseGames, loseWins }: { winGames: number; winWins: number; loseGames: number; loseWins: number }) {
  const won = rate(winWins, winGames);
  const lost = rate(loseWins, loseGames);
  const total = winGames + loseGames;
  const gap = won != null && lost != null ? won - lost : null;
  const half = (img: string, label: string, games: number, wins: number, value: number | null) => (
    <div className="flex gap-2 items-start min-w-0">
      <img src={img} alt="" className="w-9 h-9 shrink-0" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{label} · {games}판</span>
        <b className="text-xl leading-tight tabular-nums">{pctText(value)}</b>
        <div className="h-1.5 rounded-full bg-amber-100 dark:bg-amber-950/60 overflow-hidden">
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${value ?? 0}%` }} />
        </div>
        <small className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{wins}승 {games - wins}패</small>
      </div>
    </div>
  );
  return (
    <section className="rounded-xl px-3.5 py-3 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/60 flex flex-col gap-2.5">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-[15px]">코인토스별 승률</h3>
        {gap != null && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800/70 dark:text-amber-100 tabular-nums">
            {gap >= 0 ? "+" : ""}{gap.toFixed(0)}%p
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {half(COIN_FRONT, "코인 이김", winGames, winWins, won)}
        {half(COIN_BACK, "코인 짐", loseGames, loseWins, lost)}
      </div>
      {total > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {gap != null && gap !== 0 ? `코인을 ${gap > 0 ? "이긴" : "진"} 판이 ${Math.abs(gap).toFixed(0)}%p 더 이겼습니다. ` : ""}
          코인 이김 {winGames}번 / {total}번 ({pctText(rate(winGames, total))})
        </p>
      )}
    </section>
  );
}

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; hidden?: boolean };

/** ⋯ button with a small menu; rare or risky actions (rename, visibility, delete) live here instead of on the card. */
export function KebabMenu({ items, label = "더보기", className = "" }: { items: MenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  return (
    <div ref={ref} className={`relative ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 text-lg leading-none"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 min-w-[150px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {shown.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${it.danger ? "text-red-600 dark:text-red-400" : ""}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Deleting a sheet: the name has to be typed, since a stray tap on a phone is easy. */
export function confirmSheetDelete(name: string): boolean {
  const typed = prompt(`이 시트를 삭제하려면 시트 이름을 정확히 입력하세요:\n\n"${name}"`);
  if (typed == null) return false;
  if (typed.trim() !== name) {
    alert("시트 이름이 일치하지 않아 삭제하지 않았습니다.");
    return false;
  }
  return true;
}

/** The tier's emblem from the game, sized by the caller. */
export function RankIcon({ rank, className = "w-4 h-4" }: { rank: string | null | undefined; className?: string }) {
  const src = rankIconSrc(rank);
  return src ? <img src={src} alt="" className={`${className} object-contain shrink-0`} /> : null;
}
