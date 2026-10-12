/** The deck book's and card book's filter bar (참혈 2026-10-12): the pure parts, kept apart for tests. */

export type DexOption = { value: string; label: string };
export type DexField = {
  key: string;
  label: string;
  options: DexOption[];
  /** Several values at once (기믹, the 그 외 toggles of tags and art). */
  multi?: boolean;
  /** The base chip (종류 / 파워): always in the top row, whatever its value. */
  primary?: boolean;
  /** How a chosen value reads on its chip (the option's own label by default). */
  format?: (label: string) => string;
};
/** Every item's chosen values; an item left out or empty is 전체. */
export type DexValues = Record<string, string[]>;

/** The item's name while it is 전체, else its value, or the first of several and how many more ("드로우 외 2"). */
export function chipText(field: DexField, values: string[]): string {
  const chosen = field.options.filter((o) => values.includes(o.value));
  if (!chosen.length) return field.label;
  const first = field.format ? field.format(chosen[0].label) : chosen[0].label;
  return chosen.length > 1 ? `${first} 외 ${chosen.length - 1}` : first;
}

export function toggleValue(values: string[], value: string, multi = false): string[] {
  if (values.includes(value)) return values.filter((v) => v !== value);
  return multi ? [...values, value] : [value];
}

/** Clears what no longer fits (종류 마법 leaves no 몬스터 형태). */
export function normalizeValues(fields: DexField[], values: DexValues, isDisabled?: (key: string, v: DexValues) => boolean): DexValues {
  if (!isDisabled) return values;
  const next = { ...values };
  for (const f of fields) if (next[f.key]?.length && isDisabled(f.key, next)) next[f.key] = [];
  return next;
}

/** Something to reset besides the base chip: another item or a 그 외 toggle. */
export const hasResettable = (fields: DexField[], extras: DexField[], values: DexValues) =>
  [...fields.filter((f) => !f.primary), ...extras].some((f) => (values[f.key]?.length ?? 0) > 0);

export const resetValues = (fields: DexField[], extras: DexField[]): DexValues =>
  Object.fromEntries([...fields, ...extras].map((f) => [f.key, []]));

/** How many chips fit in one row: all of them, or as many as leave room for the "그 외 n종" chip after them.
 *  fixed: the rest of the row (funnel, + button); each chip and the 그 외 chip take their width and one gap. */
export function fitCount(widths: number[], moreWidth: number, fixed: number, gap: number, avail: number): number {
  const all = widths.reduce((s, w) => s + w + gap, fixed);
  if (all <= avail || !widths.length) return widths.length;
  let used = fixed + moreWidth + gap;
  let k = 0;
  while (k < widths.length && used + widths[k] + gap <= avail) used += widths[k++] + gap;
  return Math.min(k, widths.length - 1);
}
