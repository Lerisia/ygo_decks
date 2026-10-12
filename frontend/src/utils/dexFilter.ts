/** The deck book's and card book's filter bar (참혈 2026-10-12): the pure parts, kept apart for tests. */

export type DexOption = { value: string; label: string };
export type DexField = {
  key: string;
  label: string;
  options: DexOption[];
  /** Several values at once (기믹, 금제, 그 외): each chosen value is a chip of its own. */
  multi?: boolean;
  /** The base chip (종류 / 파워): always in the top row, whatever its value. */
  primary?: boolean;
  /** How a chosen value reads on its chip (the option's own label by default). */
  format?: (label: string) => string;
};
/** Every item's chosen values; an item left out or empty is 전체. */
export type DexValues = Record<string, string[]>;
/** A chip of the top row: a one-value item (value left out), or one chosen value of a multi item. */
export type TopChip = { field: DexField; value?: string };

const label = (field: DexField, o: DexOption) => (field.format ? field.format(o.label) : o.label);

/** A one-value item's chip: its name while it is 전체, else its value; a multi item's always reads its name. */
export function chipText(field: DexField, values: string[]): string {
  const chosen = field.multi ? undefined : field.options.find((o) => o.value === values[0]);
  return chosen ? label(field, chosen) : field.label;
}

/** One chosen value of a multi item, as its own chip reads it. */
export function valueText(field: DexField, value: string): string {
  const o = field.options.find((x) => x.value === value);
  return o ? label(field, o) : value;
}

/** The top row (참혈 2026-10-12 round 2): the base chip, each one-value item with a value, then every chosen value
 *  of the multi items and of 그 외, each its own chip, in the options' order (a value whose options have not come yet
 *  waits for them). */
export function topChips(fields: DexField[], extra: DexField | undefined, values: DexValues): TopChip[] {
  const out: TopChip[] = [];
  for (const f of [...fields, ...(extra ? [extra] : [])]) {
    const v = values[f.key] ?? [];
    if (f.multi) out.push(...f.options.filter((o) => v.includes(o.value)).map((o) => ({ field: f, value: o.value })));
    else if (f.primary || v.length) out.push({ field: f });
  }
  return out;
}

export function toggleValue(values: string[], value: string, multi = false): string[] {
  if (values.includes(value)) return values.filter((v) => v !== value);
  return multi ? [...values, value] : [value];
}

/** Clears what no longer fits (종류 마법 leaves no 몬스터). */
export function normalizeValues(fields: DexField[], values: DexValues, isDisabled?: (key: string, v: DexValues) => boolean): DexValues {
  if (!isDisabled) return values;
  const next = { ...values };
  for (const f of fields) if (next[f.key]?.length && isDisabled(f.key, next)) next[f.key] = [];
  return next;
}

/** Something to reset besides the base chip: another item or a 그 외 toggle. */
export const hasResettable = (fields: DexField[], extra: DexField | undefined, values: DexValues) =>
  [...fields.filter((f) => !f.primary), ...(extra ? [extra] : [])].some((f) => (values[f.key]?.length ?? 0) > 0);

export const resetValues = (fields: DexField[], extra: DexField | undefined): DexValues =>
  Object.fromEntries([...fields, ...(extra ? [extra] : [])].map((f) => [f.key, []]));

/** How many chips fit in one row: all of them, or as many as leave room for the "그 외 n종" chip after them.
 *  fixed: the rest of the row (the + button); each chip and the 그 외 chip take their width and one gap. */
export function fitCount(widths: number[], moreWidth: number, fixed: number, gap: number, avail: number): number {
  const all = widths.reduce((s, w) => s + w + gap, fixed);
  if (all <= avail || !widths.length) return widths.length;
  let used = fixed + moreWidth + gap;
  let k = 0;
  while (k < widths.length && used + widths[k] + gap <= avail) used += widths[k++] + gap;
  return Math.min(k, widths.length - 1);
}
