import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, record, redo, undo } from "./deckHistory";

const deck = (main: number[], covers: (number | null)[] = []) => ({ main, extra: [] as number[], covers });

describe("deck builder undo / redo (참혈 2026-10-16)", () => {
  it("steps back and forward through the changes", () => {
    let h = EMPTY_HISTORY;
    const a = deck([]), b = deck([1]), c = deck([1, 2]);
    h = record(h, a);   // a → b
    h = record(h, b);   // b → c
    const [h1, back1] = undo(h, c)!;
    expect(back1.main).toEqual([1]);
    const [h2, back2] = undo(h1, back1)!;
    expect(back2.main).toEqual([]);
    expect(undo(h2, back2)).toBeNull();
    const [h3, fwd] = redo(h2, back2)!;
    expect(fwd.main).toEqual([1]);
    expect(h3.past.length).toBe(1);
  });
  it("drops what could be redone once a new change is made", () => {
    let h = record(EMPTY_HISTORY, deck([]));
    const [h1] = undo(h, deck([1]))!;
    h = record(h1, deck([]));
    expect(h.future).toEqual([]);
    expect(redo(h, deck([5]))).toBeNull();
  });
  it("keeps the 대표 카드 with the cards and at most 100 steps", () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 120; i++) h = record(h, deck([i], [i]));
    expect(h.past.length).toBe(100);
    expect(undo(h, deck([0]))![1].covers).toEqual([119]);
  });
});
