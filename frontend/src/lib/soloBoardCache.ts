/** Shared in-memory cache for the Solo Duchmind board.
 *
 *  Lives in its own module (not inside the board page) so other places —
 *  notably the draw-submit flow — can invalidate it. Survives component
 *  unmounts, so paging back and forth or re-entering the board is instant.
 *  Stale-while-revalidate: callers show a cached page immediately and
 *  always fire a background fetch to refresh it.
 */
import type { SoloBoardResponse } from "@/api/soloApi";

const BOARD_CACHE_MAX = 16;
const cache = new Map<string, SoloBoardResponse>();

export function boardCacheKey(tab: string, order: string, page: number): string {
  return `${tab}|${order}|${page}`;
}

export function getBoardCache(key: string): SoloBoardResponse | undefined {
  return cache.get(key);
}

export function writeBoardCache(key: string, data: SoloBoardResponse): void {
  cache.delete(key);          // re-insert → marks as most-recently-used
  cache.set(key, data);
  while (cache.size > BOARD_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop every cached page. Called on manual refresh and after a new
 *  drawing is submitted (the board's page 1 — and every subsequent
 *  page — has shifted, so all cached pages are stale). */
export function clearBoardCache(): void {
  cache.clear();
}
