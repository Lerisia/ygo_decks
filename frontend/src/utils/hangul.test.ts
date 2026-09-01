import { describe, expect, it } from "vitest";
import { expandCompoundJamo, getInitials, isInitialsOnly, matchesDeckQuery, matchesInitials } from "./hangul";

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
    expect(matchesDeckQuery("ㅎㅅ", "하얀 숲")).toBe(true);
    expect(matchesDeckQuery("ㅋㄾ", "킬러튠")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(matchesDeckQuery("bf", "BF")).toBe(true);
  });
});
