/** Where a monster's summon lives (its cut-in, its attribute's background and sound), which pictures a device gets,
 *  and fetching them ahead into the browser's cache, so that pressing play waits for no download (엘리스 10/12: people
 *  play them one after another). */
import { readAtlas } from "@/lib/spine/atlas";

export type CutinInfo = { anim: string; view: [number, number, number] | null; mp?: number; v?: number };

export const CUTIN_BASE = "/media/md_ui/cutin";
// the attribute's background behind the summon (summonbg_export.py), one folder an attribute (엘리스 2026-10-11)
export const BG_BASE = "/media/md_ui/summonbg";
export const BG_VERSION = 2;
export const BG_ATTRIBUTES = new Set(["light", "dark", "water", "fire", "earth", "wind", "divine"]);

const PHONE_MP = 34;   // the most texture (millions of pixels) a phone gets the large pictures for

/** The small pictures (a quarter of the pixels) only for a heavy cut-in on a phone, whose browser could run out of
 *  memory: the rest look sharp in their large pictures on a phone too (엘리스 10/11). */
export function wantsSmall(info: CutinInfo): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory >= 6) return false;
  const phone = Math.min(window.screen.width, window.screen.height) < 600 || (memory !== undefined && memory <= 4);
  return phone && (info.mp ?? 0) > PHONE_MP;
}

export const cutinBase = (id: number, info: CutinInfo) => `${CUTIN_BASE}/${id}${wantsSmall(info) ? "/sd" : ""}`;

const PLAYED = "cutin-played";

/** Someone who has played a summon in this visit gets the next ones fetched ahead. */
export function markPlayed() {
  try {
    sessionStorage.setItem(PLAYED, "1");
  } catch {
    /* storage refused: nothing fetched ahead */
  }
}

export function hasPlayed(): boolean {
  try {
    return sessionStorage.getItem(PLAYED) === "1";
  } catch {
    return false;
  }
}

const fetched = new Set<string>();

/** Fetch a summon's files at the addresses the players will ask for, read to the end so the cache keeps them; not
 *  decoded (a phone's memory is kept for the one being played). Nothing on a connection asking to save data. */
export function prefetchSummon(id: number, info: CutinInfo, attribute: string) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const key = `${cutinBase(id, info)}:${attribute}`;
  if (conn?.saveData || fetched.has(key)) return;
  fetched.add(key);
  const take = (url: string) => fetch(url).then((r) => r.arrayBuffer()).catch(() => null);
  const q = info.v ? `?v=${info.v}` : "";
  const base = cutinBase(id, info);
  void (async () => {
    await take(`${base}/skeleton.json${q}`);
    const atlas = await fetch(`${base}/atlas.txt${q}`).then((r) => r.text()).catch(() => null);
    if (atlas) for (const page of readAtlas(atlas).pages) await take(`${base}/${page.name}${q}`);
    if (attribute) await take(`${CUTIN_BASE}/sound/${attribute}.wav`);
    if (!BG_ATTRIBUTES.has(attribute)) return;
    const bq = `?v=${BG_VERSION}`, bg = `${BG_BASE}/${attribute}`;
    const fx = await fetch(`${bg}/fx.json${bq}`).then((r) => r.json()).catch(() => null);
    if (!fx) return;
    const files = new Set<string>();
    type Mat = { program: string; textures: Record<string, { file: string }> } | null;
    for (const s of fx.systems as { material: Mat; trail: Mat; renderer: { mesh: string | null } }[]) {
      for (const m of [s.material, s.trail]) {
        if (!m) continue;
        files.add(`shader/${m.program}.json`);
        for (const t of Object.values(m.textures)) files.add(`tex/${t.file}.png`);
      }
      if (s.renderer.mesh) files.add(`mesh/${s.renderer.mesh}.json`);
    }
    for (const sp of (fx.sprites ?? []) as { file: string }[]) files.add(`tex/${sp.file}.png`);
    for (const f of files) await take(`${bg}/${f}${bq}`);
  })();
}
