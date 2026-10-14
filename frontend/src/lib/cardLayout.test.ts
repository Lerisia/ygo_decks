import { describe, expect, it } from "vitest";
import type { CardLetters, ServerFontInfo } from "@/api/cardLayoutApi";
import serverLayout from "../../../backend/carddb/face_layout.json";
import {
  FINE, baselineAt, changedPaths, drawLetters, startAt, elementsOf, fit, mergeLayout, moveElement, neededFonts, pyRound, wrap, type FaceLayout,
} from "./cardLayout";

const LAYOUT = serverLayout as unknown as FaceLayout;
const NO_LINE_START = ".,)]」』〕〉》:;!?%·、。";
const tenEach = (t: string) => [...t].length * 10;
const plain = (t: unknown) => (typeof t === "string" ? t.replace(/\u00a0/g, " ") : t);

const MARU: ServerFontInfo = {
  file: "MaruBuri-Bold.otf", family: "MaruBuriOTF", style: "Bold", weight: 700, upm: 1000, ascender: 965, descender: -380,
  bytes: 1, instances: {},
};
const servers = new Map([[MARU.file, MARU]]);

function letters(over: Partial<CardLetters> = {}): CardLetters {
  return {
    id: 7, card_id: 7, name: "스타더스트 드래곤", category: "monster", frame: "synchro", overframe: false, pendulum: false,
    link: false, type_line: "【드래곤족／싱크로／효과】", stats: [["DEF/", "2000"], ["ATK/", "2500"]], spell_trap: null,
    pendulum_scale: null, effect: "", pendulum_effect: "", normal_monster: false, needs_fallback: false, face_url: null,
    prints: [], ...over,
  };
}

/** A canvas context that records what is drawn where on the face, every letter 10 units wide (letters are set FINE
 *  times larger under a 1/FINE scale); `sx` is the drawing's sideways scale on the face. */
function recorder() {
  type Call = { op: string; args: unknown[]; font: string; align: string; sx: number };
  const calls: Call[] = [];
  let t = { x: 0, y: 0, sx: 1, sy: 1 };
  const stack: (typeof t)[] = [];
  const at = (x: number, y: number) => [t.x + x * t.sx, t.y + y * t.sy];
  const ctx = {
    font: "", fillStyle: "", textAlign: "left", textBaseline: "alphabetic", letterSpacing: "0px", imageSmoothingQuality: "low",
    save: () => stack.push({ ...t }),
    restore: () => (t = stack.pop()!),
    translate: (x: number, y: number) => (t = { ...t, x: t.x + x * t.sx, y: t.y + y * t.sy }),
    scale: (sx: number, sy: number) => (t = { ...t, sx: t.sx * sx, sy: t.sy * sy }),
    measureText: (text: string) => ({ width: tenEach(text) * FINE }),
    fillText: (text: string, x: number, y: number) =>
      calls.push({ op: "text", args: [plain(text), ...at(x, y)], font: ctx.font, align: ctx.textAlign, sx: t.sx * FINE }),
    fillRect: (...args: number[]) => calls.push({ op: "rect", args, font: "", align: "", sx: t.sx }),
    drawImage: (img: unknown, x: number, ...rest: number[]) => calls.push({ op: "image", args: [img, x, ...rest], font: "", align: "", sx: t.sx }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const draw = (c: CardLetters, layout = LAYOUT, withText = false) => {
  const { ctx, calls } = recorder();
  drawLetters(ctx, { layout, letters: c, withText, servers, noLineStart: NO_LINE_START, icons: new Map([["icon.png", {} as ImageBitmap]]) });
  return calls;
};

describe("face.py's rules, in the browser", () => {
  it("rounds halves to even as Python does", () => {
    expect([32.5, 37.5, 12.5, 2.4, 2.6, -3.5].map(pyRound)).toEqual([32, 38, 12, 2, 3, -4]);
  });

  it("wraps anywhere a line is full, keeping punctuation off a line's start", () => {
    expect(wrap("abcdefgh", tenEach, 50, NO_LINE_START)).toEqual(["abcde", "fgh"]);
    expect(wrap("abcd.", tenEach, 40, NO_LINE_START)).toEqual(["abc", "d."]);
    expect(wrap("abcd efg", tenEach, 40, NO_LINE_START)).toEqual(["abcd", "efg"]);
    expect(wrap("ab\ncd", tenEach, 40, NO_LINE_START)).toEqual(["ab", "cd"]);
  });

  it("fits the largest size whose lines fit, line heights rounded as Python does", () => {
    const at = (size: number) => (t: string) => [...t].length * size;
    // 20 letters in a 200-wide box: 10 → 1 line of 12 (round(12.5) = 12)
    expect(fit("x".repeat(20), 200, 24, at, 30, 10, 1.25, "")).toEqual({ size: 10, lines: ["x".repeat(20)], lh: 12 });
    expect(fit("x".repeat(20), 200, 200, at, 30, 10, 1.25, "").size).toBe(30);
    const last = fit("x".repeat(500), 100, 10, at, 30, 12, 1.25, "");
    expect([last.size, last.lh]).toEqual([12, 15]);   // nothing fits: the smallest
  });

  it("sets ATK/DEF right-aligned, each number in a four-digit slot", () => {
    const stats = draw(letters()).filter((c) => c.font.includes(`${28 * FINE}px`));
    const { right, baseline, number_gap, label_gap } = LAYOUT.stats;
    // "rs": each piece ends at x, its start in whole pixels as PIL puts it
    expect(stats.map((c) => [c.args[0], c.args[1], c.args[2]])).toEqual([
      ["2000", right - 40, baseline],
      ["DEF/", right - 40 - number_gap - 40, baseline],
      ["2500", right - 40 - number_gap - 40 - label_gap - 40, baseline],
      ["ATK/", right - 40 - number_gap - 40 - label_gap - 40 - number_gap - 40, baseline],
    ]);
    const type = draw(letters()).find((c) => c.args[0] === "【드래곤족／싱크로／효과】")!;
    expect(type.args.slice(1)).toEqual([LAYOUT.type_line.x, LAYOUT.type_line.y + Math.ceil(965 * 26 / 1000)]);   // "la": the ascender
    const rule = draw(letters()).find((c) => c.op === "rect")!;
    expect(rule.args).toEqual([62, 922, 644 - 62 + 1, 2]);   // PIL's 2px line: rows y and y + 1, both ends
  });

  it("squeezes a long name into its box and puts it on the box's middle", () => {
    const [x0, y0, x1, y1] = LAYOUT.name.box;
    const long = "가".repeat(60);   // 600 + 2 × pad wide
    const name = draw(letters({ name: long })).find((c) => c.args[0] === long)!;
    const squeeze = (x1 - x0) / (600 + 2 * LAYOUT.name.pad);
    const mid = (y1 - y0) / 2 + (Math.ceil(965 * 48 / 1000) - Math.ceil(380 * 48 / 1000)) / 2;
    expect(name.sx).toBeCloseTo(squeeze);
    expect(name.args[1]).toBeCloseTo(x0 + LAYOUT.name.pad * squeeze);
    expect(name.args[2]).toBe(y0 + mid);
    const short = draw(letters()).find((c) => c.args[0] === "스타더스트 드래곤")!;
    expect([short.args[1], short.sx]).toEqual([x0 + LAYOUT.name.pad, 1]);
    // page only: a smaller size first, and no squeeze
    const smaller = { ...LAYOUT, name: { ...LAYOUT.name, min_size: 30, squeeze: false } };
    const n2 = draw(letters({ name: long }), smaller).find((c) => c.args[0] === long)!;
    expect([n2.font.startsWith(`700 ${30 * FINE}px`), n2.sx]).toEqual([true, 1]);
  });

  it("puts the 오버프레임 name in white over its shadows", () => {
    const names = draw(letters({ overframe: true })).filter((c) => c.args[0] === "스타더스트 드래곤");
    const [x0, y0] = LAYOUT.name.box;
    const first = names.at(-1)!.args[2] as number;
    expect(names.map((c) => [c.args[1], c.args[2]])).toEqual([
      ...LAYOUT.name.shadow_offsets.map(([dx, dy]) => [x0 + LAYOUT.name.pad + dx, first + dy]),
      [x0 + LAYOUT.name.pad, first],
    ]);
    expect(first).toBeGreaterThan(y0);
  });

  it("ends the spell / trap line at the box's right with the kind icon before 】", () => {
    const calls = draw(letters({ category: "spell", frame: "spell", stats: null, type_line: null, spell_trap: { label: "【마법 카드", icon: "icon.png" } }));
    const s = LAYOUT.spell_trap_line;
    const start = s.box[2] - (60 + s.icon_advance + 10);
    expect(calls.map((c) => [c.op, c.args[0] === undefined ? null : typeof c.args[0] === "string" ? c.args[0] : "img", c.args[1]])).toEqual([
      ["text", "스타더스트 드래곤", LAYOUT.name.box[0] + LAYOUT.name.pad],
      ["text", "【마법 카드", start],
      ["image", "img", pyRound(start + 60 + s.icon_dx)],
      ["text", "】", start + 60 + s.icon_advance],
    ]);
  });

  it("sets spaces as no-break spaces, which Chrome doesn't shape apart (keeping the kerning next to them)", () => {
    const { ctx } = recorder();
    const seen: string[] = [];
    ctx.fillText = (text: string) => void seen.push(text);
    drawLetters(ctx, { layout: LAYOUT, letters: letters(), withText: false, servers, noLineStart: NO_LINE_START, icons: new Map() });
    expect(seen[0]).toBe("스타더스트\u00a0드래곤");
  });

  it("sets the card text only when asked", () => {
    const c = letters({ effect: "①: 효과." });
    expect(draw(c).some((x) => x.args[0] === "①: 효과.")).toBe(false);
    const line = draw(c, LAYOUT, true).find((x) => x.args[0] === "①: 효과.")!;
    expect(line.args[1]).toBe(LAYOUT.effect.box[0]);
  });
});

describe("PIL's anchors in whole pixels", () => {
  it("rounds the start and the middle half up", () => {
    expect([startAt("rs", 300, 71.3), startAt("rs", 300, 110.5), startAt("mm", 200, 25.2), startAt("la", 62, 99)]).toEqual([229, 189, 187, 62]);
    expect(baselineAt("mm", 735, { ascent: 41, descent: 16 })).toBe(735 + 13);
    expect(baselineAt("la", 769, { ascent: 26, descent: 10 })).toBe(795);
  });
});

describe("the layout page's bookkeeping", () => {
  it("moves one piece, leaving the rest", () => {
    const moved = moveElement(LAYOUT, "pendulum_scale", 3, -2);
    expect(moved.pendulum_scale.x).toEqual(LAYOUT.pendulum_scale.x.map((x) => x + 3));
    expect(moved.pendulum_scale.y).toBe(LAYOUT.pendulum_scale.y - 2);
    expect(changedPaths(LAYOUT, moved)).toEqual(["pendulum_scale.x", "pendulum_scale.y"]);
    expect(moveElement(LAYOUT, "name", 1, 1).name.box).toEqual(LAYOUT.name.box.map((v) => v + 1));
  });

  it("lays a saved layout over the server's, keeping only what fits", () => {
    const merged = mergeLayout(LAYOUT, {
      name: { size: 44, box: [1, 2, 3, 4], font: { family: "Gowun Batang", weight: 700 }, letter_spacing: 1.5, bogus: 3 },
      stats: { size: "big", rule: { y: 900 } },
      extra: {},
    });
    expect(merged.name.size).toBe(44);
    expect(merged.name.box).toEqual([1, 2, 3, 4]);
    expect(merged.name.font).toEqual({ family: "Gowun Batang", weight: 700 });
    expect(merged.name.letter_spacing).toBe(1.5);
    expect("bogus" in merged.name).toBe(false);
    expect(merged.stats.size).toBe(LAYOUT.stats.size);
    expect(merged.stats.rule).toEqual({ ...LAYOUT.stats.rule, y: 900 });
    expect("extra" in merged).toBe(false);
  });

  it("asks for the fonts a card sets", () => {
    const files = (c: CardLetters, withText = false) =>
      neededFonts(LAYOUT, c, withText).map((f) => ("file" in f.spec ? f.spec.file : f.spec.family));
    expect(files(letters())).toEqual(["MaruBuri-Bold.otf", "MaruBuri-Bold.otf", "MaruBuri-Bold.otf"]);
    expect(files(letters({ needs_fallback: true })).slice(1, 4)).toEqual(["NotoSerifKR.ttf", "NotoSerifJP.ttf", "DejaVuSerif-Bold.ttf"]);
    expect(files(letters({ normal_monster: true, effect: "x" }), true).at(-1)).toBe("NotoSerifKR.ttf");
    expect(elementsOf(letters({ pendulum: true })).has("pendulum_scale")).toBe(true);
  });
});
