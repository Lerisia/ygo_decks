/** /dev/icons' picks (참혈 2026-10-16): a pick shows only in the style it was made in (Remix 면 ≠ 선, Font Awesome ≠ its
 *  외곽선); a cell stands for the styles it draws, both where an icon looks the same in either. */
import type { IconChoice, IconLib } from "@/api/devIconsApi";
import { type RemixTyped, remixKey, remixTyped } from "./remixName";

type Choices = Record<string, IconChoice>;
export type Picks = { choices: Choices; custom: Record<string, string> };

export const isPicked = (c: IconChoice | undefined, libs: IconLib[], name: string) => !!c && c.name === name && libs.includes(c.lib);

export function togglePick(choices: Choices, row: string, libs: IconLib[], name: string): Choices {
  if (isPicked(choices[row], libs, name)) {
    const { [row]: _, ...rest } = choices;
    return rest;
  }
  return { ...choices, [row]: { lib: libs[0], name } };
}

/** A typed name's cells: the style typed with it, or 면 and 선 both. */
export const typedLibs = (t: RemixTyped): IconLib[] => (t.style ? [`remix-${t.style}`] : ["remix-fill", "remix-line"]);

/** Taking a typed name out lets go of a pick it showed. */
export function dropTyped(choices: Choices, row: string, t: RemixTyped): Choices {
  if (!isPicked(choices[row], typedLibs(t), t.name)) return choices;
  const { [row]: _, ...rest } = choices;
  return rest;
}

/** A name typed into a row's box (listed: the row's own Remix names). With its style it is picked at once; bare, its
 *  two cells wait for a press. One among the row's own is not shown twice, and the name it replaces takes its pick. */
export function typeRemix({ choices, custom }: Picks, row: string, t: RemixTyped, listed: string[]): Picks {
  const was = custom[row] ? remixTyped(custom[row]) : null;
  let next = was && was.name !== t.name && !listed.includes(was.name) ? dropTyped(choices, row, was) : choices;
  if (t.style) next = { ...next, [row]: { lib: `remix-${t.style}`, name: t.name } };
  const { [row]: _, ...rest } = custom;
  return { choices: next, custom: listed.includes(t.name) ? rest : { ...custom, [row]: remixKey(t) } };
}

/** Saved rows this page no longer draws: shown at the bottom so a pick is never lost. */
export const unlisted = (choices: Choices, custom: Record<string, string>, rows: Set<string>) =>
  [...new Set([...Object.keys(choices), ...Object.keys(custom)])].filter((k) => !rows.has(k));
