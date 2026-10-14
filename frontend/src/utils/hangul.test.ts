import { describe, expect, it } from "vitest";
import cases from "./deckSearchCases.json";
import { expandCompoundJamo, getInitials, isInitialsOnly, makeMatcher, matchRank, matchesDeckQuery, matchesInitials, nameKeys, toJamo } from "./hangul";

describe("expandCompoundJamo", () => {
  it("expands compound jamo into component consonants", () => {
    expect(expandCompoundJamo("ㅋㄾ")).toBe("ㅋㄹㅌ");
    expect(expandCompoundJamo("ㅄ")).toBe("ㅂㅅ");
    expect(expandCompoundJamo("ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ")).toBe("ㄱㅅㄴㅈㄴㅎㄹㄱㄹㅁㄹㅂㄹㅅㄹㅌㄹㅍㄹㅎㅂㅅ");
  });
  it("leaves plain and double consonants untouched", () => {
    expect(expandCompoundJamo("ㄱㄲㅆㅉ")).toBe("ㄱㄲㅆㅉ");
    expect(expandCompoundJamo("킬러튠")).toBe("킬러튠");
  });
});

describe("getInitials", () => {
  it("extracts initial consonants", () => {
    expect(getInitials("킬러튠")).toBe("ㅋㄹㅌ");
    expect(getInitials("푸른 눈의 백룡")).toBe("ㅍㄹㄴㅇㅂㄹ");
    expect(getInitials("ㅋㄹ튠")).toBe("ㅋㄹㅌ");
  });
});

describe("isInitialsOnly", () => {
  it("accepts bare jamo including compound jamo", () => {
    expect(isInitialsOnly("ㅋㄾ")).toBe(true);
    expect(isInitialsOnly("ㅋㄹㅌ")).toBe(true);
    expect(isInitialsOnly("킬")).toBe(false);
    expect(isInitialsOnly("")).toBe(false);
  });
});

describe("matchesInitials", () => {
  it("matches compound-jamo queries against deck names", () => {
    expect(matchesInitials("ㅋㄾ", "킬러튠")).toBe(true);
    expect(matchesInitials("ㅋㄹㅌ", "킬러튠")).toBe(true);
    expect(matchesInitials("ㅋㄾ", "크샤트리라")).toBe(false);
  });
  it("matches aliases too", () => {
    expect(matchesInitials("ㅄㄷ", "라뷰린스", ["백설 던전"])).toBe(true);
  });
});

describe("matchesDeckQuery", () => {
  it("ignores spaces in both query and deck name", () => {
    expect(matchesDeckQuery("하얀숲", "하얀 숲")).toBe(true);
    expect(matchesDeckQuery("하얀 숲", "하얀 숲")).toBe(true);
    expect(matchesDeckQuery("얀숲", "하얀 숲")).toBe(true);      // substring still works
    expect(matchesDeckQuery("블랙매", "블랙 매지션")).toBe(true);
    expect(matchesDeckQuery("하얀숲", "크샤트리라")).toBe(false);
  });
  it("ignores spaces in aliases too", () => {
    expect(matchesDeckQuery("블랙페더", "BF", ["블랙 페더"])).toBe(true);
  });
  it("still supports chosung search", () => {
    expect(matchesDeckQuery("ㅎㅇㅅ", "하얀 숲")).toBe(true);
    expect(matchesDeckQuery("ㅋㄾ", "킬러튠")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(matchesDeckQuery("bf", "BF")).toBe(true);
  });
});

describe("shared deck search cases (same file the PC recorder tests against)", () => {
  it.each(cases.cases)("$query → $name", (c) => {
    expect(matchesDeckQuery(c.query, c.name, c.aliases ?? [])).toBe(c.expect);
  });
});

describe("toJamo", () => {
  it("splits syllables, compound vowels and 받침 into single jamo", () => {
    expect(toJamo("블랙")).toBe("ㅂㅡㄹㄹㅐㄱ");
    expect(toJamo("괜찮")).toBe("ㄱㅗㅐㄴㅊㅏㄴㅎ");
    expect(toJamo("ㄺa1")).toBe("ㄹㄱa1");
  });
});

describe("makeMatcher (the dropdown's search, 엘리스 10/12)", () => {
  const names = ["블랙 매지션", "블랙 매지션 걸", "블루아이즈", "매지션즈 소울즈"].map((n) => ({ n, k: nameKeys(n) }));
  const found = (q: string) => names.filter(({ k }) => makeMatcher(q)(k)).map(({ n }) => n);
  it("keeps finding the name at every step a Korean keyboard types it", () => {
    for (const q of ["ㅂ", "브", "블", "블ㄹ", "블래", "블랙", "블랙 ㅁ", "블랙 매", "블랙 맺", "블랙 매지", "블랙 매짓", "블랙 매지셔", "블랙 매지션"]) {
      expect(found(q), q).toContain("블랙 매지션");
    }
  });
  it("still narrows", () => {
    expect(found("블랙 매지션 ㄱ")).toEqual(["블랙 매지션 걸"]);
    expect(found("블루")).toEqual(["블루아이즈"]);
    expect(found("매지션즈")).toEqual(["매지션즈 소울즈"]);
  });
  it("takes bare consonants as initials, from the start", () => {
    expect(found("ㅂㄹㅁㅈㅅ")).toEqual(["블랙 매지션", "블랙 매지션 걸"]);
    expect(found("ㅁㅈㅅ")).toEqual(["매지션즈 소울즈"]);
  });
  it("matches everything on an empty query", () => {
    expect(found(" ")).toHaveLength(4);
  });
});

describe("matchRank", () => {
  it("puts the whole name first, then its start, then anywhere, spaces ignored", () => {
    const rank = matchRank("블랙 매지션");
    expect(rank(nameKeys("블랙매지션"))).toBe(0);
    expect(rank(nameKeys("블랙 매지션 걸"))).toBe(1);
    expect(rank(nameKeys("용기사 블랙 매지션"))).toBe(2);
  });

  it("holds bare consonants against the initials", () => {
    const rank = matchRank("ㅂㄹㅁㅈㅅ");
    expect(rank(nameKeys("블랙 매지션"))).toBe(0);
    expect(rank(nameKeys("블랙 매지션 걸"))).toBe(1);
  });
});
