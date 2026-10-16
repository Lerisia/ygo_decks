import { describe, expect, it } from "vitest";
import { dropPlace, listKey, scrollToShow } from "./dropdown";

describe("a drop-down's keys (참혈 2026-10-16)", () => {
  const closed = { open: false, active: -1, count: 5, selected: 2 };
  const open = { open: true, active: 2, count: 5, selected: 2 };

  it("opens on ↑ ↓ Enter or Space at the item picked, on Home or End at the first or last", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) expect(listKey(key, closed)).toEqual({ open: true, active: 2, prevent: true });
    expect(listKey("ArrowDown", { ...closed, selected: -1 })).toEqual({ open: true, active: 0, prevent: true });
    expect(listKey("Home", closed)).toEqual({ open: true, active: 0, prevent: true });
    expect(listKey("End", closed)).toEqual({ open: true, active: 4, prevent: true });
    expect(listKey("Escape", closed)).toBeNull();
    expect(listKey("a", closed)).toBeNull();
    expect(listKey("Tab", closed)).toBeNull();
  });

  it("moves with ↑ ↓ (stopping at the ends), Home, End and a page at a time", () => {
    expect(listKey("ArrowDown", open)).toEqual({ open: true, active: 3, prevent: true });
    expect(listKey("ArrowDown", { ...open, active: 4 })).toEqual({ open: true, active: 4, prevent: true });
    expect(listKey("ArrowUp", open)).toEqual({ open: true, active: 1, prevent: true });
    expect(listKey("ArrowUp", { ...open, active: 0 })).toEqual({ open: true, active: 0, prevent: true });
    expect(listKey("Home", open)).toEqual({ open: true, active: 0, prevent: true });
    expect(listKey("End", open)).toEqual({ open: true, active: 4, prevent: true });
    expect(listKey("PageDown", { ...open, count: 66, active: 3 })).toEqual({ open: true, active: 13, prevent: true });
    expect(listKey("PageDown", { ...open, count: 66, active: 60 })).toEqual({ open: true, active: 65, prevent: true });
    expect(listKey("PageUp", { ...open, count: 66, active: 3 })).toEqual({ open: true, active: 0, prevent: true });
  });

  it("picks the item marked on Enter or Space and closes; Esc closes without picking; Tab closes and goes on", () => {
    expect(listKey("Enter", { ...open, active: 3 })).toEqual({ open: false, active: 3, pick: 3, prevent: true });
    expect(listKey(" ", { ...open, active: 0 })).toEqual({ open: false, active: 0, pick: 0, prevent: true });
    expect(listKey("Escape", { ...open, active: 3 })).toEqual({ open: false, active: 3, prevent: true });
    expect(listKey("Tab", open)).toEqual({ open: false, active: 2, prevent: false });
    expect(listKey("x", open)).toBeNull();
  });

  it("picks nothing from an empty list", () => {
    expect(listKey("ArrowDown", { open: false, active: -1, count: 0, selected: -1 })).toEqual({ open: true, active: -1, prevent: true });
    expect(listKey("ArrowDown", { open: true, active: -1, count: 0, selected: -1 })).toEqual({ open: true, active: -1, prevent: true });
    expect(listKey("Enter", { open: true, active: -1, count: 0, selected: -1 })).toEqual({ open: false, active: -1, prevent: true });
  });
});

describe("where a drop-down's list opens", () => {
  const view = { width: 390, height: 800 };
  const anchor = (top: number, left = 40, width = 80) => ({ top, bottom: top + 28, left, width });

  it("opens below its button, 4px apart, as tall as it is up to the most", () => {
    expect(dropPlace({ anchor: anchor(100), list: { width: 120, height: 200 }, view, max: 288 })).toEqual({ up: false, top: 132, left: 40, minWidth: 80, maxHeight: 288 });
  });

  it("opens above when there is too little room below and more above", () => {
    expect(dropPlace({ anchor: anchor(700), list: { width: 120, height: 200 }, view, max: 288 })).toEqual({ up: true, bottom: 104, left: 40, minWidth: 80, maxHeight: 288 });
    // above too has too little: the most there is
    expect(dropPlace({ anchor: anchor(250), list: { width: 120, height: 600 }, view: { width: 390, height: 400 }, max: 288 }))
      .toEqual({ up: true, bottom: 154, left: 40, minWidth: 80, maxHeight: 238 });
  });

  it("stays below, shorter, when below still has more room", () => {
    expect(dropPlace({ anchor: anchor(300), list: { width: 120, height: 600 }, view: { width: 390, height: 700 }, max: 640 }))
      .toEqual({ up: false, top: 332, left: 40, minWidth: 80, maxHeight: 360 });
  });

  it("keeps 8px inside the window's sides", () => {
    expect(dropPlace({ anchor: anchor(100, 330, 50), list: { width: 120, height: 100 }, view, max: 288 }).left).toBe(262);
    expect(dropPlace({ anchor: anchor(100, 2, 50), list: { width: 120, height: 100 }, view, max: 288 }).left).toBe(8);
  });
});

describe("keeping the item marked in sight", () => {
  it("scrolls the least to show it, and centres the item picked as the list opens", () => {
    expect(scrollToShow({ scrollTop: 0, height: 200 }, { top: 50, height: 30 })).toBe(0);
    expect(scrollToShow({ scrollTop: 0, height: 200 }, { top: 190, height: 30 })).toBe(20);
    expect(scrollToShow({ scrollTop: 100, height: 200 }, { top: 60, height: 30 })).toBe(60);
    expect(scrollToShow({ scrollTop: 0, height: 200 }, { top: 500, height: 30 }, true)).toBe(415);
    expect(scrollToShow({ scrollTop: 0, height: 200 }, { top: 30, height: 30 }, true)).toBe(0);
  });
});
