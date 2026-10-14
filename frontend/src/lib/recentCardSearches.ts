/** The card search's recent history (/dev/cards, 참혈 2026-10-14): what was searched or picked, newest first, kept in
 *  this browser. */
export type RecentSearch =
  | { kind: "q"; text: string }
  | { kind: "group"; key: string; name: string; tag: string }
  | { kind: "card"; id: number; name: string; tag: string };

const KEY = "card_search_recent_v1";
const KEEP = 10;

export const recentId = (r: RecentSearch) => (r.kind === "q" ? `q:${r.text}` : r.kind === "group" ? `g:${r.key}` : `c:${r.id}`);

export function loadRecent(): RecentSearch[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(list: RecentSearch[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: the history lasts while the page is open */
  }
  return list;
}

/** Puts it first (once), the oldest falling off past ten. */
export const rememberSearch = (r: RecentSearch) =>
  store([r, ...loadRecent().filter((x) => recentId(x) !== recentId(r))].slice(0, KEEP));

export const forgetSearch = (id: string) => store(loadRecent().filter((x) => recentId(x) !== id));

export const clearRecent = () => store([]);
