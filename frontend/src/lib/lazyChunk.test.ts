import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadOnFailure } from "./lazyChunk";

describe("reloadOnFailure", () => {
  let stored: Record<string, string>;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = {};
    reload = vi.fn();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => (stored[k] = v) });
    vi.stubGlobal("location", { reload });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const settled = (p: Promise<unknown>) =>
    Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), 0))]);

  it("passes a chunk that loads through", async () => {
    await expect(reloadOnFailure(() => Promise.resolve("page"))).resolves.toBe("page");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when a chunk fails, leaving the page loading meanwhile", async () => {
    const p = reloadOnFailure(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const state = settled(p);
    await vi.advanceTimersByTimeAsync(1);
    expect(await state).toBe("pending");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("throws a second failure within 10 s instead of reloading again", async () => {
    stored.asset_reload = String(Date.now() - 5000);
    await expect(reloadOnFailure(() => Promise.reject(new Error("gone")))).rejects.toThrow("gone");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once 10 s have passed", async () => {
    stored.asset_reload = String(Date.now() - 11000);
    void reloadOnFailure(() => Promise.reject(new Error("gone")));
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
