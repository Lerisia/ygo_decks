import { describe, expect, it } from "vitest";
import {
  buildAnswerKey,
  visibleOptions,
  hiddenOptionalCount,
  isFinished,
  type Question,
  type Available,
} from "./recommendFlow";

const q = (key: string, values: (number | null)[]): Question => ({
  key,
  question: key,
  options: values.map((v) => ({ value: v as number, label: v === null ? "상관 없음" : `opt${v}` })),
});

const available: Available = { s: [0, 1], d: [2], t: [], a: [0, 1, 2], sm: [6], ptag: [], atag: [] };

describe("buildAnswerKey", () => {
  it("returns 'empty' with no answers", () => {
    expect(buildAnswerKey([])).toBe("empty");
  });
  it("drops null answers and sorts pairs", () => {
    expect(buildAnswerKey([{ key: "t", value: 1 }, { key: "s", value: 0 }, { key: "a", value: null }])).toBe("s=0|t=1");
  });
  it("is 'empty' when every answer is null", () => {
    expect(buildAnswerKey([{ key: "a", value: null }])).toBe("empty");
  });
});

describe("visibleOptions", () => {
  it("keeps only options the server says are viable; null is always viable", () => {
    expect(visibleOptions(q("a", [0, 1, 2, 3, null]), available).map((o) => o.value)).toEqual([0, 1, 2, null]);
  });
  it("drops 상관 없음 when exactly two options remain", () => {
    expect(visibleOptions(q("s", [0, 1, 2, null]), { ...available, s: [0] }).map((o) => o.value)).toEqual([0]);
  });
  it("keeps 상관 없음 alone when nothing else is viable", () => {
    expect(visibleOptions(q("t", [0, 1, null]), available).map((o) => o.value)).toEqual([null]);
  });
  it("keeps 상관 없음 when three or more remain", () => {
    expect(visibleOptions(q("a", [0, 1, null]), available).map((o) => o.value)).toEqual([0, 1, null]);
  });
  it("returns nothing while availability is unknown", () => {
    expect(visibleOptions(q("a", [0, 1, null]), null)).toEqual([]);
  });
});

describe("hiddenOptionalCount", () => {
  const optional = [q("a", [0, 1, 2, null]), q("sm", [1, 6, null]), q("ptag", [1, 2, null])];
  it("counts unanswered optional questions with at most one visible option", () => {
    // a: 3 visible (0,1,2 + null) -> shown; sm: [6] only -> hidden; ptag: [null] only -> hidden
    expect(hiddenOptionalCount(optional, [], available)).toBe(2);
  });
  it("never counts an answered question as hidden", () => {
    expect(hiddenOptionalCount(optional, [{ key: "sm", value: 6 }], available)).toBe(1);
  });
});

describe("isFinished", () => {
  it("finishes when a single candidate remains", () => {
    expect(isFinished({ answered: 1, hidden: 0, total: 7, candidateCount: 1 })).toBe(true);
  });
  it("finishes when every question is answered or hidden", () => {
    expect(isFinished({ answered: 4, hidden: 3, total: 7, candidateCount: 5 })).toBe(true);
  });
  it("keeps going otherwise", () => {
    expect(isFinished({ answered: 2, hidden: 1, total: 7, candidateCount: 5 })).toBe(false);
  });
  it("does not finish on zero candidates (caller routes to no-results)", () => {
    expect(isFinished({ answered: 0, hidden: 0, total: 7, candidateCount: 0 })).toBe(false);
  });
});
