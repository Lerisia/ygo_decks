import type { SheetSummary } from "@/api/toolApi";

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
