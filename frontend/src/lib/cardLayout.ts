/** Card-face letters set in the browser the way carddb/face.py sets them with PIL, so their layout can be tuned on
 *  /dev/cardlayout before the faces are drawn again (참혈 2026-10-14). The layout is face_layout.json as the server
 *  gives it; the keys marked "page only" are tried here first and face.py doesn't read them yet. */
import type { CardLetters, ServerFontInfo } from "@/api/cardLayoutApi";

export type Box = [number, number, number, number];
export type Rgba = [number, number, number, number];
/** A font of the face assets as face.py names it ({file, variation}), or a web font pasted on the page. */
export type ServerFont = { file: string; variation: string | null };
export type WebFont = { family: string; weight: number };
export type FontSpec = ServerFont | WebFont;

type PageOnly = { letter_spacing?: number };
export type FaceLayout = {
  name: PageOnly & {
    box: Box; anchor: string; font: FontSpec; size: number; pad: number; color: Rgba; light_color: Rgba;
    light_frames: string[]; shadow_color: Rgba; shadow_offsets: [number, number][]; fallbacks: FontSpec[];
    min_size?: number; align?: "left" | "center" | "right"; squeeze?: boolean;
  };
  spell_trap_line: PageOnly & {
    box: Box; anchor: string; font: FontSpec; size: number; color: Rgba; icon_size: number; icon_dx: number; icon_advance: number;
  };
  type_line: PageOnly & { x: number; y: number; anchor: string; font: FontSpec; size: number; color: Rgba };
  stats: PageOnly & {
    right: number; baseline: number; anchor: string; font: FontSpec; size: number; color: Rgba; slot: string;
    number_gap: number; label_gap: number; rule: { x0: number; x1: number; y: number; width: number; color: Rgba };
  };
  pendulum_scale: PageOnly & { x: number[]; y: number; anchor: string; font: FontSpec; size: number; color: Rgba };
  effect: PageOnly & {
    box: Box; spell_trap_box: Box; anchor: string; font: FontSpec; normal_font: FontSpec; max_size: number;
    min_size: number; line_spacing: number; color: Rgba;
  };
  pendulum_effect: PageOnly & {
    box: Box; anchor: string; font: FontSpec; max_size: number; min_size: number; line_spacing: number; color: Rgba;
  };
};

export const isServerFont = (f: FontSpec): f is ServerFont => "file" in f;

/** Python's round(): a half goes to the even neighbour (face.py's line heights: round(26 * 1.25) is 32, not 33). */
export function pyRound(x: number) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export type Measure = (text: string) => number;

/** face.wrap: lines broken wherever a line is full, keeping punctuation off a line's start; a newline is kept. */
export function wrap(text: string, measure: Measure, width: number, noLineStart: string) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      if (!line || measure(line + ch) <= width) {
        line += ch;
        continue;
      }
      const chars = [...line];
      if (noLineStart.includes(ch) && chars.length > 1) {
        lines.push(chars.slice(0, -1).join(""));
        line = chars[chars.length - 1] + ch;
      } else {
        lines.push(line.trimEnd());
        line = ch.trimStart();
      }
    }
    lines.push(line);
  }
  return lines;
}

/** face.fit: the largest size from maxSize down whose wrapped lines fit the box (the smallest when none does). */
export function fit(text: string, boxW: number, boxH: number, measureAt: (size: number) => Measure, maxSize: number,
                    minSize: number, spacing: number, noLineStart: string) {
  const last = Math.min(minSize, maxSize);
  for (let size = maxSize; size >= last; size--) {
    const lines = wrap(text, measureAt(size), boxW, noLineStart);
    const lh = pyRound(size * spacing);
    if (lines.length * lh <= boxH || size === last) return { size, lines, lh };
  }
  return { size: last, lines: wrap(text, measureAt(last), boxW, noLineStart), lh: pyRound(last * spacing) };
}

/** The family a face-assets font is registered under on the page. */
export const serverFamily = (file: string) => `cl ${file.replace(/\.(otf|ttf)$/i, "")}`;

export type Resolved = { family: string; weight: number; server?: ServerFontInfo };

export function resolveFont(spec: FontSpec, servers: Map<string, ServerFontInfo>): Resolved {
  if (!isServerFont(spec)) return { family: spec.family, weight: spec.weight };
  const server = servers.get(spec.file);
  const weight = (spec.variation && server?.instances[spec.variation]) || server?.weight || 400;
  return { family: serverFamily(spec.file), weight, server };
}

export const cssFont = (r: Resolved, size: number, fallbacks: string[] = []) =>
  `${r.weight} ${size}px ${[r.family, ...fallbacks].map((f) => JSON.stringify(f)).join(", ")}`;

const ceilPx = (v: number) => Math.ceil(v - 1e-6);

/** A line's ascent and descent as PIL takes them: FreeType's hhea ascender and descender rounded out to whole pixels.
 *  A pasted font has no file here, so the browser's own font box stands in. */
export function lineMetrics(ctx: CanvasRenderingContext2D, r: Resolved, size: number) {
  if (r.server) {
    return { ascent: ceilPx((r.server.ascender * size) / r.server.upm), descent: ceilPx((-r.server.descender * size) / r.server.upm) };
  }
  const m = ctx.measureText("가Hg");   // the font is set FINE times larger
  return {
    ascent: ceilPx((m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? size * FINE * 0.9) / FINE),
    descent: ceilPx((m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? size * FINE * 0.25) / FINE),
  };
}

type Metrics = { ascent: number; descent: number };

/** Where PIL's anchor (its second letter: a ascender, m middle, s baseline, d descender) puts the baseline. PIL moves
 *  text to its anchor in whole pixels: the middle is rounded half up. */
export function baselineAt(anchor: string, y: number, m: Metrics) {
  const v = anchor[1];
  return v === "a" ? y + m.ascent : v === "m" ? y + Math.floor((m.ascent - m.descent) / 2 + 0.5) : v === "d" ? y - m.descent : y;
}

/** Where a line of this width starts for PIL's anchor (its first letter: l left, m middle, r right), in whole pixels
 *  as PIL moves it (checked against PIL pixel for pixel, 2026-10-14). */
export function startAt(anchor: string, x: number, width: number) {
  return anchor[0] === "r" ? x - Math.floor(width + 0.5) : anchor[0] === "m" ? x - Math.floor(width / 2 + 0.5) : x;
}
export const cssColor = ([r, g, b, a]: Rgba) => `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(4)})`;

/** Letters are set FINE times larger under a 1/FINE scale: a browser that rounds each letter's advance to whole pixels
 *  (Chrome on Linux) then rounds to 1/FINE px, and lines come out as long as PIL's, whose advances are fractional. */
export const FINE = 20;

/** Chrome shapes text word by word, so the kerning a font puts next to a space (마루 부리: -30 units around it) is lost;
 *  a no-break space is the same glyph and keeps the line whole, as PIL (HarfBuzz) shapes it. */
const unbroken = (text: string) => text.replace(/ /g, "\u00a0");

/** The context's font for a size (and the letter spacing), set FINE times larger. */
function setFont(ctx: CanvasRenderingContext2D, r: Resolved, size: number, spacing = 0, fallbacks: string[] = []) {
  ctx.font = cssFont(r, size * FINE, fallbacks);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing * FINE}px`;
}

const measure = (ctx: CanvasRenderingContext2D, text: string) => ctx.measureText(unbroken(text)).width / FINE;

function fill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / FINE, 1 / FINE);
  ctx.fillText(unbroken(text), 0, 0);
  ctx.restore();
}

export type DrawInput = {
  layout: FaceLayout;
  letters: CardLetters;
  withText: boolean;
  servers: Map<string, ServerFontInfo>;
  noLineStart: string;
  /** The spell / trap kind icons by file name, once loaded. */
  icons: Map<string, CanvasImageSource>;
};

/** Every letter face.py sets, over a face drawn without them (704×1024 units; scale the context for other sizes). */
export function drawLetters(ctx: CanvasRenderingContext2D, input: DrawInput) {
  const { layout: L, letters: c } = input;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  drawName(ctx, input);
  if (c.category === "monster") {
    const t = L.type_line;
    const r = resolveFont(t.font, input.servers);
    setFont(ctx, r, t.size, t.letter_spacing);
    ctx.fillStyle = cssColor(t.color);
    const line = c.type_line ?? "";
    fill(ctx, line, startAt(t.anchor, t.x, measure(ctx, line)), baselineAt(t.anchor, t.y, lineMetrics(ctx, r, t.size)));
    const rule = L.stats.rule;
    ctx.fillStyle = cssColor(rule.color);
    // PIL's wide line: rows y - (w-1)//2 on, both ends included
    ctx.fillRect(rule.x0, rule.y - Math.floor((rule.width - 1) / 2), rule.x1 - rule.x0 + 1, rule.width);
    drawStats(ctx, input);
  } else if (c.spell_trap) {
    drawSpellTrapLine(ctx, input);
  }
  if (c.pendulum && c.pendulum_scale != null) {
    const p = L.pendulum_scale;
    const r = resolveFont(p.font, input.servers);
    setFont(ctx, r, p.size, p.letter_spacing);
    ctx.fillStyle = cssColor(p.color);
    const y = baselineAt(p.anchor, p.y, lineMetrics(ctx, r, p.size));
    const w = measure(ctx, c.pendulum_scale);
    for (const x of p.x) fill(ctx, c.pendulum_scale, startAt(p.anchor, x, w), y);
  }
  if (input.withText) {
    if (c.pendulum && c.pendulum_effect) {
      drawTextBox(ctx, input, c.pendulum_effect, L.pendulum_effect, L.pendulum_effect.box, L.pendulum_effect.font);
    }
    const e = L.effect;
    drawTextBox(ctx, input, c.effect, e, c.category === "monster" ? e.box : e.spell_trap_box,
                c.normal_monster ? e.normal_font : e.font);
  }
  ctx.restore();
}

/** The size the name is set at and how wide its layer is: face._squeezed_text's layer (text + pad each side), the
 *  size stepping down to min_size (page only) before it is squeezed. */
export function nameFit(ctx: CanvasRenderingContext2D, input: DrawInput) {
  const n = input.layout.name;
  const r = resolveFont(n.font, input.servers);
  const fallbacks = n.fallbacks.map((f) => resolveFont(f, input.servers).family);
  const maxW = n.box[2] - n.box[0];
  const last = Math.min(n.min_size ?? n.size, n.size);
  let size = n.size;
  let layerW = 0;
  for (; ; size--) {
    setFont(ctx, r, size, n.letter_spacing, fallbacks);
    layerW = Math.max(1, pyRound(measure(ctx, input.letters.name))) + 2 * n.pad;
    if (layerW <= maxW || size <= last) break;
  }
  const scale = layerW > maxW && (n.squeeze ?? true) ? maxW / layerW : 1;
  return { r, size, layerW, scale, maxW };
}

function drawName(ctx: CanvasRenderingContext2D, input: DrawInput) {
  const n = input.layout.name;
  const c = input.letters;
  const [x0, y0, , y1] = n.box;
  const { r, size, layerW, scale, maxW } = nameFit(ctx, input);
  const drawn = layerW * scale;
  const left = x0 + (n.align === "center" ? (maxW - drawn) / 2 : n.align === "right" ? maxW - drawn : 0);
  // the layer is the box's height and the text sits on its middle ("lm"), the fallback letters on the same baseline
  const y = baselineAt(n.anchor, (y1 - y0) / 2, lineMetrics(ctx, r, size));
  const paint = (color: Rgba, dx: number, dy: number) => {
    ctx.save();
    ctx.translate(left + dx, y0 + dy);
    ctx.scale(scale, 1);
    ctx.fillStyle = cssColor(color);
    fill(ctx, c.name, n.pad, y);
    ctx.restore();
  };
  if (c.overframe) for (const [dx, dy] of n.shadow_offsets) paint(n.shadow_color, dx, dy);
  paint(c.overframe || n.light_frames.includes(c.frame) ? n.light_color : n.color, 0, 0);
}

function drawSpellTrapLine(ctx: CanvasRenderingContext2D, input: DrawInput) {
  const s = input.layout.spell_trap_line;
  const { label, icon } = input.letters.spell_trap!;
  const r = resolveFont(s.font, input.servers);
  setFont(ctx, r, s.size, s.letter_spacing);
  ctx.fillStyle = cssColor(s.color);
  const [, y0, x1, y1] = s.box;
  const labelW = measure(ctx, label);
  let x = x1 - (labelW + (icon ? s.icon_advance : 0) + measure(ctx, "】"));
  const yc = (y0 + y1) / 2;
  const y = baselineAt(s.anchor, yc, lineMetrics(ctx, r, s.size));
  fill(ctx, label, x, y);
  x += labelW;
  if (icon) {
    const img = input.icons.get(icon);
    if (img) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, pyRound(x + s.icon_dx), pyRound(yc - s.icon_size / 2), s.icon_size, s.icon_size);
    }
    x += s.icon_advance;
  }
  fill(ctx, "】", x, y);
}

function drawStats(ctx: CanvasRenderingContext2D, input: DrawInput) {
  const s = input.layout.stats;
  const r = resolveFont(s.font, input.servers);
  setFont(ctx, r, s.size, s.letter_spacing);
  ctx.fillStyle = cssColor(s.color);
  const slot = measure(ctx, s.slot);
  const y = baselineAt(s.anchor, s.baseline, lineMetrics(ctx, r, s.size));
  let x = s.right;
  for (const [label, value] of input.letters.stats ?? []) {
    if (value != null) {
      fill(ctx, value, startAt(s.anchor, x, measure(ctx, value)), y);
      x -= slot + s.number_gap;
    }
    const w = measure(ctx, label);
    fill(ctx, label, startAt(s.anchor, x, w), y);
    x -= w + s.label_gap;
  }
}

type TextBoxLayout = FaceLayout["pendulum_effect"];

function drawTextBox(ctx: CanvasRenderingContext2D, input: DrawInput, text: string, lay: TextBoxLayout, box: Box, font: FontSpec) {
  const [x0, y0, x1, y1] = box;
  const r = resolveFont(font, input.servers);
  const measureAt = (size: number): Measure => {
    setFont(ctx, r, size, lay.letter_spacing);
    return (t) => measure(ctx, t);
  };
  const { size, lines, lh } = fit(text, x1 - x0, y1 - y0, measureAt, lay.max_size, lay.min_size, lay.line_spacing, input.noLineStart);
  measureAt(size);
  const m = lineMetrics(ctx, r, size);
  ctx.fillStyle = cssColor(lay.color);
  lines.forEach((line, i) => fill(ctx, line, startAt(lay.anchor, x0, measure(ctx, line)), baselineAt(lay.anchor, y0 + i * lh, m)));
}

/** The pieces that can be picked and moved with the arrow keys. */
export const ELEMENTS = [
  { key: "name", label: "카드 이름" },
  { key: "spell_trap_line", label: "마법·함정 줄" },
  { key: "type_line", label: "종족 줄" },
  { key: "stats", label: "ATK/DEF" },
  { key: "stats_rule", label: "ATK/DEF 위 선" },
  { key: "pendulum_scale", label: "펜듈럼 스케일" },
  { key: "effect", label: "효과문 (몬스터)" },
  { key: "effect_spell_trap", label: "효과문 (마법·함정)" },
  { key: "pendulum_effect", label: "펜듈럼 효과문" },
] as const;
export type ElementKey = (typeof ELEMENTS)[number]["key"];

const shift = (b: Box, dx: number, dy: number): Box => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];

/** The layout with one piece moved by (dx, dy). */
export function moveElement(layout: FaceLayout, key: ElementKey, dx: number, dy: number): FaceLayout {
  const L = structuredClone(layout);
  switch (key) {
    case "name": L.name.box = shift(L.name.box, dx, dy); break;
    case "spell_trap_line": L.spell_trap_line.box = shift(L.spell_trap_line.box, dx, dy); break;
    case "type_line": L.type_line.x += dx; L.type_line.y += dy; break;
    case "stats": L.stats.right += dx; L.stats.baseline += dy; break;
    case "stats_rule": L.stats.rule.x0 += dx; L.stats.rule.x1 += dx; L.stats.rule.y += dy; break;
    case "pendulum_scale": L.pendulum_scale.x = L.pendulum_scale.x.map((x) => x + dx); L.pendulum_scale.y += dy; break;
    case "effect": L.effect.box = shift(L.effect.box, dx, dy); break;
    case "effect_spell_trap": L.effect.spell_trap_box = shift(L.effect.spell_trap_box, dx, dy); break;
    case "pendulum_effect": L.pendulum_effect.box = shift(L.pendulum_effect.box, dx, dy); break;
  }
  return L;
}

/** Guides for the picked pieces: boxes, and points (a cross on the anchor) with what the point is. */
export function elementGuides(L: FaceLayout, key: ElementKey): { boxes: Box[]; points: [number, number][] } {
  switch (key) {
    case "name": return { boxes: [L.name.box], points: [] };
    case "spell_trap_line": return { boxes: [L.spell_trap_line.box], points: [] };
    case "type_line": return { boxes: [], points: [[L.type_line.x, L.type_line.y]] };
    case "stats": return { boxes: [], points: [[L.stats.right, L.stats.baseline]] };
    case "stats_rule": return { boxes: [[L.stats.rule.x0, L.stats.rule.y, L.stats.rule.x1, L.stats.rule.y + 1]], points: [] };
    case "pendulum_scale": return { boxes: [], points: L.pendulum_scale.x.map((x) => [x, L.pendulum_scale.y] as [number, number]) };
    case "effect": return { boxes: [L.effect.box], points: [] };
    case "effect_spell_trap": return { boxes: [L.effect.spell_trap_box], points: [] };
    case "pendulum_effect": return { boxes: [L.pendulum_effect.box], points: [] };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFont = (v: unknown) =>
  isObject(v) && (typeof v.file === "string" || (typeof v.family === "string" && typeof v.weight === "number"));

/** A saved or pasted layout laid over the server's: what it has of the same kind wins (a font may be either kind),
 *  page-only keys are kept, anything else is dropped. */
export function mergeLayout<T>(base: T, saved: unknown): T {
  if (!isObject(base) || !isObject(saved)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(saved)) {
    const b = (base as Record<string, unknown>)[k];
    if (b === undefined) {
      if (PAGE_ONLY_KEYS.has(k) && (typeof v === "number" || typeof v === "string" || typeof v === "boolean")) out[k] = v;
    } else if (isFont(b) && isFont(v)) {
      out[k] = v;
    } else if (Array.isArray(b)) {
      if (Array.isArray(v) && (b.length === 0 || v.every((x, i) => typeof x === typeof b[Math.min(i, b.length - 1)]))) out[k] = v;
    } else if (isObject(b)) {
      out[k] = mergeLayout(b, v);
    } else if (typeof v === typeof b) {
      out[k] = v;
    }
  }
  return out as T;
}
export const PAGE_ONLY_KEYS = new Set(["letter_spacing", "min_size", "align", "squeeze"]);

/** Paths ("name.box") whose values differ between two layouts. */
export function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (isObject(a) && isObject(b) && !isFont(a)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => changedPaths(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

/** The fonts a face's letters are set in, each with its size and the letters it sets (for document.fonts.load). The
 *  name's fallbacks only when it has letters the name font lacks; the card text's only when it is drawn. */
export function neededFonts(L: FaceLayout, c: CardLetters, withText: boolean) {
  const out: { spec: FontSpec; size: number; text: string }[] = [{ spec: L.name.font, size: L.name.size, text: c.name }];
  if (c.needs_fallback) out.push(...L.name.fallbacks.map((spec) => ({ spec, size: L.name.size, text: c.name })));
  if (c.category === "monster") {
    out.push({ spec: L.type_line.font, size: L.type_line.size, text: c.type_line ?? "" });
    out.push({ spec: L.stats.font, size: L.stats.size, text: (c.stats ?? []).flat().join("") + L.stats.slot });
  } else if (c.spell_trap) {
    out.push({ spec: L.spell_trap_line.font, size: L.spell_trap_line.size, text: c.spell_trap.label + "】" });
  }
  if (c.pendulum && c.pendulum_scale != null) {
    out.push({ spec: L.pendulum_scale.font, size: L.pendulum_scale.size, text: c.pendulum_scale });
  }
  if (withText) {
    if (c.pendulum && c.pendulum_effect) {
      out.push({ spec: L.pendulum_effect.font, size: L.pendulum_effect.max_size, text: c.pendulum_effect });
    }
    out.push({ spec: c.normal_monster ? L.effect.normal_font : L.effect.font, size: L.effect.max_size, text: c.effect });
  }
  return out;
}

/** Which pieces a card has (a spell has no type line, a monster no 【마법 카드】 line…). */
export function elementsOf(c: CardLetters): Set<ElementKey> {
  const keys: ElementKey[] = ["name"];
  if (c.category === "monster") keys.push("type_line", "stats", "stats_rule", "effect");
  else keys.push("spell_trap_line", "effect_spell_trap");
  if (c.pendulum) keys.push("pendulum_scale", "pendulum_effect");
  return new Set(keys);
}
