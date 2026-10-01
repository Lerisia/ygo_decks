import { describe, expect, it } from "vitest";
import { findTheme, NO_THEME, orderThemes, suggestThemes } from "./themeChips";

const items = [
  { theme: "낙인", shop_listed_at: "2026-05-01T00:00:00Z" },
  { theme: "누밸즈", shop_listed_at: "2026-09-25T00:00:00Z" },
  { theme: "크라운 클랜", shop_listed_at: "2026-09-13T00:00:00Z" },
  { theme: "크라운 클랜", shop_listed_at: "2026-01-01T00:00:00Z" },
  { theme: "가가가", shop_listed_at: null },
  { theme: "", shop_listed_at: "2026-09-30T00:00:00Z" },
];

describe("orderThemes", () => {
  it("pins the most recently listed themes, newest first; the rest alphabetical with no-theme last", () => {
    expect(orderThemes(items, 2)).toEqual({ pinned: ["누밸즈", "크라운 클랜"], rest: ["가가가", "낙인", NO_THEME] });
  });
});

describe("findTheme", () => {
  it("accepts an exact theme name ignoring spaces and case", () => {
    expect(findTheme("크라운클랜", ["크라운 클랜", "낙인"])).toBe("크라운 클랜");
    expect(findTheme("크라운", ["크라운 클랜", "낙인"])).toBeNull();
    expect(findTheme("기타", [NO_THEME])).toBeNull();
  });
});

describe("suggestThemes", () => {
  it("matches like the deck search, including Hangul initials", () => {
    expect(suggestThemes("ㅋㄹ", ["크라운 클랜", "낙인", NO_THEME])).toEqual(["크라운 클랜"]);
    expect(suggestThemes("클랜", ["크라운 클랜", "낙인"])).toEqual(["크라운 클랜"]);
  });
});
