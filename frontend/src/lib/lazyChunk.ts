import { lazy, type ComponentType } from "react";

/** React.lazy for a piece of the site that comes in its own chunk (2026-10-12). When the chunk cannot be fetched as it
 *  is opened — a tab left open across the deploys that removed it, or a dropped connection — the page reloads to
 *  fetch the current site instead of going white. An idle prefetch that fails reloads nothing. */
export function lazyChunk<P>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => reloadOnFailure(load));
}

/** load(); when it fails, the page reloads (at most every 10 s, the guard index.html keeps for its bundles) and the
 *  promise never settles, so the loading state stays until then. A second failure within 10 s is thrown. */
export function reloadOnFailure<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((err): Promise<T> => {
    if (reloadOnce()) return new Promise(() => {});
    throw err;
  });
}

function reloadOnce() {
  try {
    if (Date.now() - (+(sessionStorage.getItem("asset_reload") ?? 0) || 0) < 10000) return false;
    sessionStorage.setItem("asset_reload", String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}
