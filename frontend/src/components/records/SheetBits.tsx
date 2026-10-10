import { useEffect, useRef, useState } from "react";
import { rankIconSrc } from "@/utils/rankUtils";

// Pieces shared by the sheet list, the sheet page and its statistics (redesign 2026-10-06).

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; hidden?: boolean };

/** ⋯ button with a small menu; rare or risky actions (rename, visibility, delete) live here instead of on the card. */
export function KebabMenu({ items, label = "더보기", className = "" }: { items: MenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
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
        className="w-9 h-9 grid place-items-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 text-xl leading-none"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 min-w-[150px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {shown.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`block w-full text-left px-4 py-3 text-[15px] hover:bg-gray-100 dark:hover:bg-gray-700 ${it.danger ? "text-red-600 dark:text-red-400" : ""}`}
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
