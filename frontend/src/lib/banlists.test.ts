import { describe, expect, it } from "vitest";
import type { CardListItem } from "@/api/cardDexApi";
import {
  type BanlistIndex, type BanRule, BAN_KINDS, TODAY_MD, banOf, banlistName, banlistOptions, banlistTitle, dayLabel, isCode, latestDay, notOut, parseBanlistKey,
  pendingRule, ruleOf, unreleasedUnder,
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
    for (const bad of ["", "xx", "md:", "md:20250407", "ocg:2025-04-07:x", "custom:", "custom:a b", `custom:${"a".repeat(33)}`, undefined, null]) {
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

  it("offers 최신 first, then every list newest first, each with its whole day in the title", () => {
    expect(banlistOptions("md", INDEX).slice(0, 3)).toEqual([
      { value: "md", label: "최신 (26.10.06)", shown: "최신", title: "2026.10.06 · 새 금제가 나오면 따라갑니다" },
      { value: "md:2026-10-06", label: "26.10.06", shown: "26.10.06", title: "2026.10.06" },
      { value: "md:2026-07-28", label: "26.07.28", shown: "26.07.28", title: "2026.07.28" },
    ]);
    expect(banlistOptions("ocg", INDEX).map((o) => o.label)).toEqual(["최신 (26.10)", "26.10", "26.07", "26.04"]);
    expect(banlistOptions("tcg", INDEX)[0].label).toBe("최신 (26.09.21)");
    // before the lists are known: 최신 alone
    expect(banlistOptions("md", null)).toEqual([{ value: "md", label: "최신", shown: "최신", title: "새 금제가 나오면 따라갑니다" }]);
  });

  it("shows 최신 closed with no day, its day only in the open list; a list held to by its day either way (참혈 2026-10-16)", () => {
    expect(banlistOptions("md", INDEX).map((o) => o.shown)).toEqual(["최신", "26.10.06", "26.07.28", "26.07.14", "26.07.01"]);
    expect(banlistOptions("ocg", INDEX).map((o) => o.shown)).toEqual(["최신", "26.10", "26.07", "26.04"]);
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
  });

  it("gives the newest list's day in the name's title", () => {
    expect(banlistTitle("md", INDEX)).toBe("2026.10.06 · 새 금제가 나오면 따라갑니다");
    expect(banlistTitle("md", null)).toBe("새 금제가 나오면 따라갑니다");
    expect(banlistTitle("ocg:2026-07-01", INDEX)).toBe("2026.07.01");
    expect(banlistTitle("custom:ours", INDEX)).toBe("");
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
  });
});
