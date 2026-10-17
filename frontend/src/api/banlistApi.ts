/** The 금제 lists a deck list may be checked by (참혈 2026-10-16): each game's lists by day, and the cards one limits.
 *  Asked once a page and kept, being small and the same for everyone. */
import { type BanTable, type BanlistIndex, parseBanlistKey } from "@/lib/banlists";

let index: Promise<BanlistIndex> | null = null;
const tables = new Map<string, Promise<BanTable>>();
const loaded = new Map<string, BanTable>();

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api/banlists/${path}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data as T;
}

export function getBanlistIndex(): Promise<BanlistIndex> {
  index ??= getJson<BanlistIndex>("").catch((e) => {
    index = null;
    throw e;
  });
  return index;
}

/** A list's table by the deck's key; a code of ours that is not there fails with status 404. */
export function getBanTable(key: string): Promise<BanTable> {
  const choice = parseBanlistKey(key);
  // 무금제 has no table (lib/banlists NO_RULE)
  if (!choice || choice.kind === "none") return Promise.reject(Object.assign(new Error("없는 금제입니다."), { status: 404 }));
  const path = choice.kind === "custom" ? `custom/${choice.code}/` : `${choice.kind}/${choice.day ?? "latest"}/`;
  let got = tables.get(key);
  if (!got) {
    got = getJson<BanTable>(path);
    tables.set(key, got);
    got.then((t) => loaded.set(key, t), () => tables.delete(key));
  }
  return got;
}

/** A list's table already here, to start from without waiting. */
export const loadedBanTable = (key: string) => loaded.get(key);
