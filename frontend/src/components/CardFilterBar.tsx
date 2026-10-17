import type { ReactNode } from "react";
import type { CardFilters, CardOptions } from "@/api/cardDexApi";
import DexFilterBar from "@/components/DexFilterBar";
import { BAR_EXTRA, BAR_KEYS, barFields, barFilters, barValues, misfit } from "@/lib/cardFilterBar";

/** The filters the chips hold, out of a card search's. */
export type CardBarFilters = Pick<CardFilters, (typeof BAR_KEYS)[number] | "has" | "ban">;

/** The card book's filter chips, one and the same wherever cards are searched — the book and the deck builder's search
 *  (엘리스 2026-10-18: the same search must not filter differently). The chips, their items and which don't fit which
 *  (lib/cardFilterBar), and the bar's ways (DexFilterBar) are decided here alone; a page passes only its filters, its
 *  control for the row's right end, and whether it is the /dev/cards trial. */
export default function CardFilterBar({ options, filters, onChange, right, active, trial }: {
  options: CardOptions | null;
  filters: CardBarFilters;
  /** the chips' filters as changed, to merge into the page's */
  onChange: (filters: CardBarFilters) => void;
  right?: ReactNode;
  active?: boolean;
  trial?: boolean;
}) {
  return (
    <DexFilterBar
      fields={barFields(options)}
      extra={BAR_EXTRA}
      values={barValues(filters)}
      onChange={(v) => onChange(barFilters(v))}
      isDisabled={misfit}
      right={right}
      active={active}
      trial={trial}
    />
  );
}
