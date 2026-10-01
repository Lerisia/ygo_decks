import { matchesDeckQuery } from "./hangul";

export const NO_THEME = "__none__";

type ThemedItem = { theme?: string | null; shop_listed_at?: string | null };

/** Theme chips for the icon shop: the `pinCount` themes with the most recent listing first (newest first),
 *  then the rest alphabetically, "no theme" last. */
export function orderThemes(items: ThemedItem[], pinCount: number): { pinned: string[]; rest: string[] } {
  const latest = new Map<string, number>();
  let hasNoTheme = false;
  for (const i of items) {
    if (!i.theme) {
      hasNoTheme = true;
      continue;
    }
    const t = i.shop_listed_at ? Date.parse(i.shop_listed_at) : 0;
    latest.set(i.theme, Math.max(latest.get(i.theme) ?? 0, t));
  }
  const pinned = [...latest.entries()]
    .filter(([, t]) => t > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, pinCount)
    .map(([name]) => name);
  const rest = [...latest.keys()].filter((t) => !pinned.includes(t)).sort((a, b) => a.localeCompare(b));
  if (hasNoTheme) rest.push(NO_THEME);
  return { pinned, rest };
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** The theme an entered value names exactly (spaces and case ignored), or null. */
export const findTheme = (value: string, themes: string[]): string | null =>
  themes.find((t) => t !== NO_THEME && squash(t) === squash(value)) ?? null;

/** Autocomplete choices: same matching as the deck search (substring, or Hangul initials). */
export const suggestThemes = (value: string, themes: string[]): string[] =>
  themes.filter((t) => t !== NO_THEME && matchesDeckQuery(value, t));
