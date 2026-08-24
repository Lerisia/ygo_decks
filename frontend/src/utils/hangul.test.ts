import { describe, expect, it } from "vitest";
import { expandCompoundJamo, getInitials, isInitialsOnly, matchesInitials } from "./hangul";

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
