import { type DexField, chipText, fitCount, hasResettable, normalizeValues, resetValues, toggleValue } from "./dexFilter";

const kind: DexField = {
  key: "category", label: "종류", primary: true,
  options: [{ value: "monster", label: "몬스터" }, { value: "spell", label: "마법" }],
};
const frame: DexField = { key: "frame", label: "몬스터 형태", options: [{ value: "fusion", label: "융합" }] };
const gimmick: DexField = {
  key: "gimmick", label: "기믹", multi: true,
  options: [{ value: "a", label: "드로우" }, { value: "b", label: "번" }, { value: "c", label: "락" }],
};
const has: DexField = { key: "has", label: "그 외", multi: true, options: [{ value: "alt", label: "다른 일러스트" }] };

describe("chipText", () => {
  it("shows the item's name until a value is chosen", () => {
    expect(chipText(kind, [])).toBe("종류");
  });

  it("shows the chosen value instead", () => {
    expect(chipText(frame, ["fusion"])).toBe("융합");
  });

  it("shows the first of several values and how many more, in the options' order", () => {
    expect(chipText(gimmick, ["c", "a"])).toBe("드로우 외 1");
    expect(chipText(gimmick, ["c", "b", "a"])).toBe("드로우 외 2");
  });

  it("falls back to the name while the options are not loaded", () => {
    expect(chipText({ ...frame, options: [] }, ["fusion"])).toBe("몬스터 형태");
  });

  it("runs a value through the field's own format", () => {
    expect(chipText({ ...frame, format: (l) => `레벨 ${l}` }, ["fusion"])).toBe("레벨 융합");
  });
});

describe("toggleValue", () => {
  it("replaces a single choice and clears it when picked again", () => {
    expect(toggleValue(["a"], "b", false)).toEqual(["b"]);
    expect(toggleValue(["a"], "a", false)).toEqual([]);
  });

  it("adds and removes one of many", () => {
    expect(toggleValue(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a", true)).toEqual(["b"]);
  });
});

describe("normalizeValues", () => {
  const off = (key: string, v: Record<string, string[]>) => key === "frame" && v.category?.[0] === "spell";

  it("clears a value its field no longer fits", () => {
    expect(normalizeValues([kind, frame], { category: ["spell"], frame: ["fusion"] }, off)).toEqual({ category: ["spell"], frame: [] });
  });

  it("keeps values that still fit", () => {
    const v = { category: ["monster"], frame: ["fusion"] };
    expect(normalizeValues([kind, frame], v, off)).toEqual(v);
  });
});

describe("hasResettable / resetValues", () => {
  it("ignores the base item alone", () => {
    expect(hasResettable([kind, frame], [has], { category: ["monster"] })).toBe(false);
  });

  it("counts any other item or 그 외 toggle", () => {
    expect(hasResettable([kind, frame], [has], { frame: ["fusion"] })).toBe(true);
    expect(hasResettable([kind, frame], [has], { has: ["alt"] })).toBe(true);
  });

  it("empties every item, the base one too", () => {
    expect(resetValues([kind, frame], [has])).toEqual({ category: [], frame: [], has: [] });
  });
});

describe("fitCount", () => {
  // the funnel and the + button with the gap between them
  const fixed = 68;

  it("shows every chip when they fit", () => {
    expect(fitCount([80, 80, 80], 50, fixed, 6, 68 + 86 * 3)).toBe(3);
  });

  it("drops chips from the end to make room for the 그 외 chip", () => {
    expect(fitCount([80, 80, 80], 50, fixed, 6, 68 + 86 * 3 - 1)).toBe(2);
    expect(fitCount([80, 80, 80], 50, fixed, 6, 68 + 86 * 2 + 56)).toBe(2);
    expect(fitCount([80, 80, 80], 50, fixed, 6, 68 + 86 * 2 + 55)).toBe(1);
  });

  it("can hide every chip behind the 그 외 chip", () => {
    expect(fitCount([200, 60], 70, fixed, 6, 150)).toBe(0);
  });

  it("has nothing to fit without chips", () => {
    expect(fitCount([], 70, fixed, 6, 10)).toBe(0);
  });
});
