import { ChevronDown } from "lucide-react";
import { type CardFilters, sortDir } from "@/api/cardDexApi";

type Sorting = Pick<CardFilters, "sort" | "dir" | "q">;

/** The card book's sort and its way, joined as Master Duel shows them (참혈 2026-10-12), at the filter row's right end
 *  — in the book and in the deck builder's search alike (엘리스 2026-10-18); `compact` a size smaller, for the
 *  builder's narrow column. */
export default function CardSortControl({ sorts, filters, onChange, compact = false }: {
  sorts: { value: string; label: string }[];
  filters: Sorting;
  onChange: (patch: Pick<CardFilters, "sort" | "dir"> | Pick<CardFilters, "dir">) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-stretch ${compact ? "h-7" : "h-9"}`}>
      {/* its own caret, a little in from the edge (참혈 2026-10-12) */}
      <span className="relative flex">
        <select
          aria-label="정렬"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value, dir: "" })}
          className={`appearance-none border border-gray-300 dark:border-gray-600 rounded-l-lg rounded-r-none bg-white text-black dark:bg-gray-800 dark:text-white font-semibold ${
            compact ? "max-w-[7rem] [field-sizing:content] pl-2 pr-6 text-xs" : "max-w-[7.5rem] sm:max-w-none max-sm:[field-sizing:content] pl-2 sm:pl-3 pr-7 sm:pr-8 text-sm"
          }`}
        >
          {/* 조회순 reads 정확도순 while a query is on: the closest names come first then (참혈 2026-10-14) */}
          {sorts.map((s) => <option key={s.value} value={s.value}>{s.value === "popular" && filters.q ? "정확도순" : s.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden />
      </span>
      <button
        type="button"
        onClick={() => onChange({ dir: sortDir(filters) === "asc" ? "desc" : "asc" })}
        aria-label={sortDir(filters) === "asc" ? "오름차순 (누르면 내림차순)" : "내림차순 (누르면 오름차순)"}
        title={sortDir(filters) === "asc" ? "오름차순" : "내림차순"}
        className={`border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg rounded-l-none bg-white text-black dark:bg-gray-800 dark:text-white font-bold ${
          compact ? "w-7 text-sm" : "w-8 sm:w-9 text-base"
        }`}
      >
        {sortDir(filters) === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}
