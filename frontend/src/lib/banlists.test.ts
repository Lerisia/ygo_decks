import { describe, expect, it, vi } from "vitest";
import type { CardListItem } from "@/api/cardDexApi";
import {
  type BanlistIndex, type BanRule, BAN_KINDS, NO_RULE, TODAY_MD, banOf, banlistName, banlistTitle, banlistUpcoming, banlistYears, dayLabel, isCode, latestDay, notOut,
  parseBanlistKey, pendingRule, pickerKind, recentCodes, rememberCode, ruleOf, unreleasedUnder,
} from "./banlists";

describe("unreleasedUnder", () => {
  const ocg: BanRule = { format: "ocg", limits: { 5868: "forbidden" }, releasedBy: "2026-10-01" };
  it("marks a card not in Master Duel only under Master Duel's rule; another game's rule limits it like any card", () => {
    const notInMd = { unreleased: true };
    expect(unreleasedUnder(notInMd)).toBe(true);
    expect(unreleasedUnder(notInMd, TODAY_MD)).toBe(true);
    expect(unreleasedUnder(notInMd, { format: "md", limits: {}, releasedBy: "2026-10-06" })).toBe(true);
    expect(unreleasedUnder(notInMd, ocg)).toBe(false);
    expect(unreleasedUnder({ unreleased: false }, TODAY_MD)).toBe(false);
    expect(banOf({ id: 5868, ban: "" }, ocg)).toBe("forbidden");
  });
});

const INDEX: BanlistIndex = {
  today: "2026-10-16",
  lists: {
    md: ["2026-10-06", "2026-07-28", "2026-07-14", "2026-07-01"],
    ocg: ["2026-10-01", "2026-07-01", "2026-04-01"],
    tcg: ["2026-09-21", "2026-06-02"],
  },
};

const card = (id: number, ban: CardListItem["ban"] = "", released?: CardListItem["released"]): CardListItem => ({
  id, name: `카드 ${id}`, category: "monster", frame: "effect", face_thumb_url: null, thumb_url: null, image_url: null, rarity: "", ban,
  ...(released ? { released } : {}),
});

describe("a deck's 금제 key (참혈 2026-10-16)", () => {
  it("is a game's newest, one of its lists by day, or a code of ours", () => {
    expect(parseBanlistKey("md")).toEqual({ kind: "md", day: null });
    expect(parseBanlistKey("tcg:2025-04-07")).toEqual({ kind: "tcg", day: "2025-04-07" });
    expect(parseBanlistKey("custom:Our-List_2")).toEqual({ kind: "custom", code: "Our-List_2" });
    expect(parseBanlistKey("none")).toEqual({ kind: "none" });   // 무금제 (참혈 2026-10-17)
    for (const bad of ["", "xx", "md:", "md:20250407", "ocg:2025-04-07:x", "custom:", "custom:a b", `custom:${"a".repeat(33)}`, "none:x", undefined, null]) {
      expect(parseBanlistKey(bad)).toBeNull();
    }
    expect(isCode("abc_1-2")).toBe(true);
    expect(isCode("a b")).toBe(false);
  });
});

describe("a list's day as the picker writes it", () => {
  it("is yy.mm.dd for Master Duel and the TCG, the OCG's by month unless it had two lists that month", () => {
    expect(dayLabel("md", "2026-10-06")).toBe("26.10.06");
    expect(dayLabel("tcg", "2026-09-21")).toBe("26.09.21");
    expect(dayLabel("ocg", "2026-10-01", INDEX.lists.ocg)).toBe("26.10");
    expect(dayLabel("ocg", "2026-10-01", ["2026-10-15", "2026-10-01"])).toBe("26.10.01");
  });

  it("finds a game's newest list in effect, one announced for a later day waiting", () => {
    expect(latestDay(INDEX, "md")).toBe("2026-10-06");
    expect(latestDay({ ...INDEX, lists: { ...INDEX.lists, md: ["2026-11-01", ...INDEX.lists.md] } }, "md")).toBe("2026-10-06");
    expect(latestDay({ ...INDEX, lists: { ...INDEX.lists, tcg: [] } }, "tcg")).toBeNull();
  });

  it("lays a game's lists in effect out by year for the picker, the newest year first, each oldest first (참혈 2026-10-17)", () => {
    const index = { ...INDEX, lists: { ...INDEX.lists, tcg: ["2027-01-10", "2026-10-19", "2026-09-21", "2026-02-02", "2025-12-01", "2024-04-15"] } };
    expect(banlistYears("tcg", index)).toEqual([
      { year: "2026", days: [
        { key: "tcg:2026-02-02", day: "2026-02-02", label: "02.02" },
        { key: "tcg:2026-09-21", day: "2026-09-21", label: "09.21" },
      ] },
      { year: "2025", days: [{ key: "tcg:2025-12-01", day: "2025-12-01", label: "12.01" }] },
      { year: "2024", days: [{ key: "tcg:2024-04-15", day: "2024-04-15", label: "04.15" }] },
    ]);
    // the ones announced for a later day go beside 최신, the soonest first
    expect(banlistUpcoming("tcg", index).map((d) => d.key)).toEqual(["tcg:2026-10-19", "tcg:2027-01-10"]);
    expect(banlistYears("ocg", INDEX).map((y) => y.days.map((d) => d.label))).toEqual([["04.01", "07.01", "10.01"]]);
    expect(banlistUpcoming("ocg", INDEX)).toEqual([]);
    expect(banlistYears("md", null)).toEqual([]);
    expect(banlistUpcoming("md", null)).toEqual([]);
  });

  it("puts 무금제 under 커스텀 in the picker", () => {
    expect(pickerKind(parseBanlistKey("none"))).toBe("custom");
    expect(pickerKind(parseBanlistKey("custom:ours"))).toBe("custom");
    expect(pickerKind(parseBanlistKey("ocg:2026-07-01"))).toBe("ocg");
    expect(pickerKind(null)).toBe("md");
  });

  it("remembers the custom codes used last, the last first, five at most", () => {
    const m: Record<string, string> = {};
    vi.stubGlobal("localStorage", { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => (m[k] = v) });
    try {
      expect(recentCodes()).toEqual([]);
      for (const c of ["a", "b", "c", "d", "e", "f", "b"]) rememberCode(c);
      expect(recentCodes()).toEqual(["b", "f", "e", "d", "c"]);
      m.banlist_recent_codes = JSON.stringify(["ok", "a b", 3]);
      expect(recentCodes()).toEqual(["ok"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the kinds 마스터 듀얼, OCG, TCG and 커스텀 in the picker, the game by its Korean name (참혈 2026-10-16)", () => {
    expect(BAN_KINDS.map((k) => k.label)).toEqual(["마스터 듀얼", "OCG", "TCG", "커스텀"]);
  });

  it("names a deck's list on its page as 「마스터 듀얼 • 최신」, the newest with no day, a held one by its whole year (참혈 2026-10-16)", () => {
    expect(banlistName("md", INDEX)).toBe("마스터 듀얼 • 최신");
    expect(banlistName("md", null)).toBe("마스터 듀얼 • 최신");
    expect(banlistName("md:2026-07-01", INDEX)).toBe("마스터 듀얼 • 2026.07.01");
    expect(banlistName("ocg:2026-07-01", INDEX)).toBe("OCG • 2026.07");
    expect(banlistName("tcg", INDEX)).toBe("TCG • 최신");
    expect(banlistName("tcg:2026-06-02", null)).toBe("TCG • 2026.06.02");
    expect(banlistName("custom:ours", INDEX)).toBe("커스텀 • ours");
    expect(banlistName("none", INDEX)).toBe("무금제");
  });

  it("gives the newest list's day in the name's title", () => {
    expect(banlistTitle("md", INDEX)).toBe("2026.10.06 · 새 금제가 나오면 따라갑니다");
    expect(banlistTitle("md", null)).toBe("새 금제가 나오면 따라갑니다");
    expect(banlistTitle("ocg:2026-07-01", INDEX)).toBe("2026.07.01");
    expect(banlistTitle("custom:ours", INDEX)).toBe("");
    expect(banlistTitle("none", INDEX)).toBe("금제를 적용하지 않습니다");
  });
});

describe("what a card is under the list picked", () => {
  const rule: BanRule = { format: "ocg", limits: { 1: "limited", 2: "forbidden" }, releasedBy: "2020-01-01" };

  it("takes its 금제 from the list, today's Master Duel one (on the card) until the list comes", () => {
    expect(banOf(card(1, "forbidden"), rule)).toBe("limited");
    expect(banOf(card(3, "forbidden"), rule)).toBe("");
    expect(banOf(card(3, "semi_limited"), TODAY_MD)).toBe("semi_limited");
    expect(banOf(card(3, "semi_limited"))).toBe("semi_limited");
  });

  it("is 미출시 when not out in the list's game by its day, out when its day is not known", () => {
    const released = (ocg: string | true | null) => ({ md: "2022-01-19", ocg, tcg: null });
    expect(notOut(card(1, "", released("2019-01-01")), rule)).toBe(false);
    expect(notOut(card(1, "", released("2020-01-01")), rule)).toBe(false);
    expect(notOut(card(1, "", released("2020-01-02")), rule)).toBe(true);
    expect(notOut(card(1, "", released(null)), rule)).toBe(true);
    expect(notOut(card(1, "", released(true)), rule)).toBe(false);
    expect(notOut(card(1), rule)).toBe(false);                    // its days not asked yet
    expect(notOut(card(1, "", released(null)), TODAY_MD)).toBe(false);   // the day to be out by not known yet
  });

  it("is judged by the table the server sends, and while it comes by nothing but today's Master Duel list", () => {
    expect(ruleOf({ format: "tcg", day: "2025-04-07", released_by: "2025-04-07", latest: false, today: "2026-10-16", limits: { 5: "limited" } }))
      .toEqual({ format: "tcg", limits: { 5: "limited" }, releasedBy: "2025-04-07" });
    expect(pendingRule("md")).toEqual(TODAY_MD);
    expect(pendingRule("md:2026-07-01")).toEqual({ format: "md", limits: {}, releasedBy: null });
    expect(pendingRule("ocg")).toEqual({ format: "ocg", limits: {}, releasedBy: null });
    expect(pendingRule("custom:ours")).toEqual({ format: "md", limits: {}, releasedBy: null });
    expect(pendingRule("none")).toEqual(NO_RULE);
  });

  it("limits nothing and holds nothing back as 미출시 under 무금제 (참혈 2026-10-17)", () => {
    const released = { md: null, ocg: null, tcg: null };
    expect(banOf(card(1, "forbidden"), NO_RULE)).toBe("");
    expect(notOut(card(1, "", released), NO_RULE)).toBe(false);
    expect(unreleasedUnder({ unreleased: true }, NO_RULE)).toBe(false);
  });
});
