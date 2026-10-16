/** A Remix icon name typed on /dev/icons (참혈 2026-10-16): "ri-sword-fill", "Search line", "sword". A style typed
 *  with it is kept and used as typed; none typed, the page's 면/선 switch decides. */
export type RemixStyle = "fill" | "line";
export type RemixTyped = { name: string; style: RemixStyle | null };

export function remixTyped(typed: string): RemixTyped {
  const slug = typed.trim().toLowerCase().replace(/\s+/g, "-").replace(/^ri-/, "");
  const m = /^(.+)-(fill|line)$/.exec(slug);
  return m ? { name: m[1], style: m[2] as RemixStyle } : { name: slug, style: null };
}

/** How it is kept (the saved "custom" row): as typed, "search-line" or "sword". */
export const remixKey = ({ name, style }: RemixTyped) => (style ? `${name}-${style}` : name);
