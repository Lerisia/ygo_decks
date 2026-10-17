import { type CardFilters, sortDir } from "@/api/cardDexApi";
import Dropdown from "@/components/Dropdown";

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
      {/* the site's drop-down, not the system select: a phone's 16px floor for selects made it read larger than the
          filter chips beside it (참혈 2026-10-18) */}
      <Dropdown
        label="정렬"
        value={filters.sort}
        // 조회수 reads 정확도 (정확도순 until 참혈 2026-10-18) while a query is on: the closest names come first then (참혈 2026-10-14)
        options={sorts.map((s) => ({ value: s.value, label: s.value === "popular" && filters.q ? "정확도" : s.label }))}
        onChange={(sort) => onChange({ sort, dir: "" })}
        className={`h-full py-0 rounded-l-lg rounded-r-none ${compact ? "max-w-[7rem] pl-2 pr-1.5 text-xs" : "max-w-[7.5rem] sm:max-w-none pl-2 sm:pl-3 pr-2 sm:pr-2.5 text-sm"}`}
      />
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
