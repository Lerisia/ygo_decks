import { describe, expect, it } from "vitest";
import { buildNameIndex, championProgress, judgeName, normalizeName } from "./nameGame";

const skills = [
  { n: "현혹의 구슬", c: "아리", k: "Q" },
  { n: "돌겨어어억!!!", c: "람머스", k: "Q" },
  { n: "90구경 투망", c: "케이틀린", k: "E" },
  { n: "Z 드라이브 공진", c: "에코", k: "P" },
  { n: "동상", c: "애니비아", k: "E" },
  { n: "동상", c: "세주아니", k: "P" },
  { n: "음파", c: "리 신", k: "Q" },
  { n: "공명의 일격", c: "리 신", k: "Q" },
];

describe("normalizeName", () => {
  it("ignores spaces, punctuation and letter case", () => {
    expect(normalizeName(" 현혹의  구슬 ")).toBe("현혹의구슬");
    expect(normalizeName("돌겨어어억")).toBe(normalizeName("돌겨어어억!!!"));
    expect(normalizeName("z드라이브 공진")).toBe(normalizeName("Z 드라이브 공진"));
  });
  it("folds full-width characters", () => {
    expect(normalizeName("９０구경　투망")).toBe("90구경투망");
  });
  it("is empty for input with nothing to compare", () => {
    expect(normalizeName("  !!! ")).toBe("");
  });
});

describe("judgeName", () => {
  const index = buildNameIndex(skills);

  it("counts each distinct name once", () => {
    expect(index.size).toBe(7);
  });
  it("accepts a name typed without spaces or marks", () => {
    const r = judgeName(index, new Set(), "현혹의구슬");
    expect(r.kind).toBe("correct");
    if (r.kind === "correct") expect(r.entry.owners).toEqual([{ c: "아리", k: "Q" }]);
  });
  it("lists every champion that has the name", () => {
    const r = judgeName(index, new Set(), "동상");
    expect(r.kind === "correct" && r.entry.owners.length).toBe(2);
  });
  it("takes the two halves of a paired skill as two names", () => {
    expect(judgeName(index, new Set(), "음파").kind).toBe("correct");
    expect(judgeName(index, new Set(), "공명의 일격").kind).toBe("correct");
  });
  it("says so when the name was already given", () => {
    const used = new Set([normalizeName("현혹의 구슬")]);
    expect(judgeName(index, used, "현혹의 구슬").kind).toBe("repeat");
  });
  it("rejects a name that is not a skill, and a partial one", () => {
    expect(judgeName(index, new Set(), "현혹").kind).toBe("wrong");
    expect(judgeName(index, new Set(), "파이어볼").kind).toBe("wrong");
  });
  it("treats blank input as nothing typed", () => {
    expect(judgeName(index, new Set(), "   ").kind).toBe("empty");
  });
});

describe("championProgress", () => {
  const things = [
    { n: "정기 흡수", c: "아리", k: "P" },
    { n: "현혹의 구슬", c: "아리", k: "Q" },
    { n: "여우불", c: "아리", k: "W" },
    { n: "매혹", c: "아리", k: "E" },
    { n: "혼령 질주", c: "아리", k: "R" },
    { n: "질풍", c: "리 신", k: "P" },
    { n: "음파", c: "리 신", k: "Q" },
    { n: "공명의 일격", c: "리 신", k: "Q" },
    { n: "방호", c: "리 신", k: "W" },
    { n: "동상", c: "애니비아", k: "E" },
    { n: "동상", c: "세주아니", k: "P" },
    { n: "가시 박힌 뭉치", c: "가렌", k: "Q" },
  ];
  const used = (...names: string[]) => new Set(names.map(normalizeName));

  it("leaves out champions with nothing named", () => {
    expect(championProgress(things, used("여우불")).map((p) => p.c)).toEqual(["아리"]);
  });
  it("marks each key none, part or full", () => {
    const [lee] = championProgress(things, used("음파", "방호"));
    expect(lee.keys).toEqual([
      { k: "P", state: "none" },
      { k: "Q", state: "part" },
      { k: "W", state: "full" },
    ]);
    expect([lee.got, lee.total, lee.complete]).toEqual([2, 4, false]);
  });
  it("puts finished champions first, then the ones with more named", () => {
    const all = championProgress(things, used("정기 흡수", "현혹의 구슬", "여우불", "매혹", "혼령 질주", "음파", "방호", "가시 박힌 뭉치"));
    expect(all.map((p) => [p.c, p.complete])).toEqual([["아리", true], ["가렌", true], ["리 신", false]]);
  });
  it("counts a name two champions share for both", () => {
    expect(championProgress(things, used("동상")).map((p) => p.c)).toEqual(["세주아니", "애니비아"]);
  });
});
