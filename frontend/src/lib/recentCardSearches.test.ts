import { beforeEach, describe, expect, it } from "vitest";
import { clearRecent, forgetSearch, loadRecent, recentId, rememberSearch } from "./recentCardSearches";

describe("recent card searches", () => {
  beforeEach(() => {
    const data: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; },
      removeItem: (k: string) => { delete data[k]; }, clear: () => {}, key: () => null, length: 0,
    } as Storage;
  });

  it("keeps the newest first, once each, ten at most", () => {
    rememberSearch({ kind: "q", text: "블랙" });
    rememberSearch({ kind: "group", key: "g5", name: "엘펜노츠", tag: "카드군" });
    rememberSearch({ kind: "q", text: "블랙" });
    expect(loadRecent().map(recentId)).toEqual(["q:블랙", "g:g5"]);
    for (let i = 0; i < 12; i++) rememberSearch({ kind: "card", id: i, name: `c${i}`, tag: "몬스터" });
    expect(loadRecent()).toHaveLength(10);
    expect(recentId(loadRecent()[0])).toBe("c:11");
  });

  it("forgets one, or all", () => {
    rememberSearch({ kind: "q", text: "a" });
    rememberSearch({ kind: "q", text: "b" });
    forgetSearch("q:a");
    expect(loadRecent().map(recentId)).toEqual(["q:b"]);
    clearRecent();
    expect(loadRecent()).toEqual([]);
  });
});
