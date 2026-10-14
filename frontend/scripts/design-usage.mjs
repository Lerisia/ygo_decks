// Counts the colours and styles frontend/src actually uses, for the design page /dev/palette (참혈 2026-10-14):
// Tailwind colour classes (bg/text/border/ring/from/to-{colour}-{step}, light and dark: apart), hex colours in code,
// the primary-button bg/hover pairs, text sizes, weights, corners, shadows, widths, spacing and breakpoints.
// Run it again after a design change and commit what it writes (the JSON, then DESIGN.md made from it and
// src/lib/designTokens.ts):
//   cd frontend && node scripts/design-usage.mjs && DESIGN_MD=write npx vitest run src/lib/designMd.test.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(SRC, "lib", "designUsage.json");
// the design page and its own data describe the colours; counting them would count the description
const SKIP = new Set(["lib/designUsage.json", "lib/designTokens.ts", "lib/designMd.ts", "pages/DevPalette.tsx"]);

const palette = require(join(ROOT, "node_modules", "tailwindcss", "colors.js"));
const FAMILIES = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const NEUTRALS = ["slate", "zinc", "neutral", "stone"];
const PROPS = "bg|text|border(?:-[trblxy])?|ring(?:-offset)?|from|via|to|fill|stroke|outline|divide|placeholder|accent|shadow|decoration|caret";

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const bump = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

// colour distance in CIE Lab (ΔE76), close enough to say "this hex is nearly that Tailwind colour"
function lab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const [x, y, z] = [
    (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047,
    c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722,
    (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883,
  ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const TAILWIND = [{ name: "white", hex: "#ffffff" }, { name: "black", hex: "#000000" }];
for (const f of FAMILIES) for (const [step, hex] of Object.entries(palette[f])) TAILWIND.push({ name: `${f}-${step}`, hex });
for (const t of TAILWIND) t.lab = lab(t.hex);
// the site's neutrals are gray: other grey families are left out of "nearly", so a near-grey hex points at gray
const NEAR = TAILWIND.filter((t) => !NEUTRALS.includes(t.name.split("-")[0]));
function nearest(hex) {
  const l = lab(hex);
  let best = null;
  for (const t of NEAR) {
    const d = Math.hypot(l[0] - t.lab[0], l[1] - t.lab[1], l[2] - t.lab[2]);
    if (!best || d < best.d) best = { name: t.name, hex: t.hex, d };
  }
  return { name: best.name, hex: best.hex, delta: Math.round(best.d * 10) / 10 };
}
const hexOf = (name) => (name === "white" ? "#ffffff" : name === "black" ? "#000000" : palette[name.split("-")[0]][name.split("-")[1]]);

const colorRe = new RegExp(
  `(?<![\\w\\[-])((?:[\\w\\[\\]&:>*@().=-]+?:)*)(?:!)?(${PROPS})-(${FAMILIES.join("|")})-(50|[1-9]00|950)(?:\\/(\\d+|\\[[^\\]]+\\]))?(?![\\w-])`,
  "g",
);
const bwRe = new RegExp(`(?<![\\w\\[-])((?:[\\w\\[\\]&:>*@().=-]+?:)*)(?:!)?(${PROPS})-(white|black)(?:\\/(\\d+|\\[[^\\]]+\\]))?(?![\\w-])`, "g");
const arbitraryRe = new RegExp(`(?<![\\w-])((?:[\\w-]+:)*)(${PROPS})-\\[(#[0-9a-fA-F]{3,8})\\]`, "g");
const hexRe = /(?<![\w&#[-])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const sizeRe = /(?<![\w-])(?:[\w-]+:)*text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+(?:\.\d+)?(?:px|rem|em)\])(?![\w-])/g;
const weightRe = /(?<![\w-])(?:[\w-]+:)*font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/g;
const roundRe = /(?<![\w-])(?:[\w-]+:)*rounded(?:-(?:[trbl]|[se][se]?|t[lr]|b[lr]))?(?:-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?(?![\w-])/g;
const shadowRe = /(?<![\w-])(?:[\w-]+:)*(drop-)?shadow(?:-(sm|md|lg|xl|2xl|inner|none|\[[^\]]+\]))?(?![\w-])/g;
const maxWRe = /(?<![\w-])(?:[\w-]+:)*max-w-(\w+|\[[^\]]+\])(?![\w-])/g;
const spaceRe = /(?<![\w-])(?:[\w-]+:)*(gap|p|px|py|pt|pb|m|mt|mb|space-y|space-x)-(\d+(?:\.5)?)(?![\w.-])/g;
const bpRe = /(?<![\w-])(sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]|max-sm|max-md|max-lg):(?=[\w!-])/g;
// a class string: what sits between quotes or backticks on one line
const stringRe = /"([^"\n]*)"|`([^`]*)`|'([^'\n]*)'/g;

const colors = {};
const classes = {};
const hexes = {};
const sizes = {};
const weights = {};
const rounds = {};
const shadows = {};
const maxW = {};
const spacing = {};
const breakpoints = {};
const buttons = {};
const darkPairs = {};
const counters = { "break-keep": 0, "animate-pulse": 0, "card-corner": 0, "tabular-nums": 0, "truncate": 0, "line-clamp": 0 };
let fileCount = 0;

const files = walk(SRC).filter((p) => !SKIP.has(relative(SRC, p).replace(/\\/g, "/")));
for (const path of files) {
  const rel = relative(SRC, path).replace(/\\/g, "/");
  const text = readFileSync(path, "utf8");
  fileCount += 1;

  const addColor = (name, prop, variants, alpha) => {
    const prefix = variants.split(":").filter(Boolean);
    const dark = prefix.includes("dark");
    const c = (colors[name] ??= { name, hex: hexOf(name), total: 0, light: 0, dark: 0, props: {}, files: {} });
    c.total += 1;
    if (dark) c.dark += 1;
    else c.light += 1;
    bump(c.props, prop.replace(/-[trblxy]$/, ""));
    bump(c.files, rel);
    bump(classes, `${prop}-${name}${alpha ? `/${alpha}` : ""}`);
  };
  for (const m of text.matchAll(colorRe)) addColor(`${m[3]}-${m[4]}`, m[2], m[1], m[5]);
  for (const m of text.matchAll(bwRe)) addColor(m[3], m[2], m[1], m[4]);
  for (const m of text.matchAll(arbitraryRe)) {
    const h = m[3].toLowerCase();
    const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h.slice(0, 7);
    const e = (hexes[full] ??= { hex: full, total: 0, files: {} });
    e.total += 1;
    bump(e.files, rel);
  }
  for (const m of text.matchAll(hexRe)) {
    let h = m[1].toLowerCase();
    if (h.length <= 4) h = [...h.slice(0, 3)].map((ch) => ch + ch).join("");
    h = `#${h.slice(0, 6)}`;
    const e = (hexes[h] ??= { hex: h, total: 0, files: {} });
    e.total += 1;
    bump(e.files, rel);
  }
  for (const m of text.matchAll(sizeRe)) bump(sizes, m[1]);
  for (const m of text.matchAll(weightRe)) bump(weights, m[1]);
  for (const m of text.matchAll(roundRe)) bump(rounds, m[1] ?? "DEFAULT");
  for (const m of text.matchAll(shadowRe)) bump(shadows, `${m[1] ?? ""}shadow${m[2] ? `-${m[2]}` : ""}`);
  for (const m of text.matchAll(maxWRe)) bump(maxW, m[1]);
  for (const m of text.matchAll(spaceRe)) bump(spacing, `${m[1]}-${m[2]}`);
  for (const m of text.matchAll(bpRe)) bump(breakpoints, m[1].startsWith("min-[") || m[1].startsWith("max-[") ? m[1].slice(0, 3) + "-[…]" : m[1]);
  for (const k of Object.keys(counters)) counters[k] += text.split(k).length - 1;

  // class strings, each taken apart from the ternaries inside it: `a ${on ? "b" : "c"}` is the pieces "a ", "b", "c",
  // so a pair is only counted when both halves sit in the same piece
  for (const s of text.matchAll(stringRe)) {
    const pieces = s[2] === undefined ? [s[1] ?? s[3]] : [s[2].replace(/\$\{[^}]*\}/g, " ¦ "), ...[...s[2].matchAll(/\$\{[^}]*\}/g)].flatMap((x) => [...x[0].matchAll(/"([^"]*)"|'([^']*)'/g)].map((q) => q[1] ?? q[2]))];
    for (const raw of pieces) for (const str of raw.split("¦")) classPairs(str, rel);
  }
}

function classPairs(str, rel) {
  // the light class and the dark: class nearest it for the same property (bg-white with dark:bg-gray-800)
  const plain = [...str.matchAll(/(?<![\w:\/-])(bg|text|border)-((?:[a-z]+-\d{2,3})|white|black)(?:\/(\d+))?(?![\w/-])/g)];
  const darks = [...str.matchAll(/(?<![\w-])dark:(bg|text|border)-((?:[a-z]+-\d{2,3})|white|black)(?:\/(\d+))?(?![\w/-])/g)];
  for (const l of plain) {
    const same = darks.filter((x) => x[1] === l[1]);
    if (!same.length) continue;
    const d = same.reduce((a, b) => (Math.abs(b.index - l.index) < Math.abs(a.index - l.index) ? b : a));
    bump(darkPairs, `${l[1]}-${l[2]}${l[3] ? `/${l[3]}` : ""} | dark:${d[1]}-${d[2]}${d[3] ? `/${d[3]}` : ""}`);
  }
  // a filled button: a plain bg-{colour}-{step}, hover:bg- of the same colour and white text
  const base = str.match(/(?<![\w:-])bg-(blue|gray|red|green|emerald|amber|yellow|rose|indigo|purple|sky|orange|slate|teal)-(\d{2,3})(?![\w/-])/);
  if (!base || !/(?<![\w:-])text-white(?![\w/-])/.test(str)) return;
  const hover = [...str.matchAll(/(?<![\w:-])hover:bg-([a-z]+)-(\d{2,3})(?![\w/-])/g)].find((x) => x[1] === base[1]);
  if (!hover) return;
  const key = `bg-${base[1]}-${base[2]} → hover:bg-${hover[1]}-${hover[2]}`;
  const e = (buttons[key] ??= { pair: key, family: base[1], base: `${base[1]}-${base[2]}`, hover: `${hover[1]}-${hover[2]}`, total: 0, files: {} });
  e.total += 1;
  bump(e.files, rel);
}

const filesTop = (f, n = 4) => top(f, n).map(([file, count]) => ({ file, count }));
const colorList = Object.values(colors)
  .sort((a, b) => b.total - a.total)
  .map((c) => ({ ...c, fileCount: Object.keys(c.files).length, files: filesTop(c.files), props: Object.fromEntries(top(c.props, 20)) }));
const tailwindHex = new Map(TAILWIND.map((t) => [t.hex, t.name]));
const hexList = Object.values(hexes)
  .sort((a, b) => b.total - a.total)
  .map((h) => ({ hex: h.hex, total: h.total, tailwind: tailwindHex.get(h.hex) ?? null, nearest: nearest(h.hex), fileCount: Object.keys(h.files).length, files: filesTop(h.files, 3) }));
const buttonList = Object.values(buttons)
  .sort((a, b) => b.total - a.total)
  .map((b) => ({ ...b, files: filesTop(b.files, 3) }));

// 정리 후보: what could be folded into the colours used everywhere else
const cleanup = [];
const blueButtons = buttonList.filter((b) => b.family === "blue");
if (blueButtons.length > 1)
  cleanup.push({
    kind: "button",
    title: "파란 버튼의 단계가 섞여 있음",
    detail: blueButtons.map((b) => `${b.pair} ${b.total}`).join(" · "),
    suggest: "주 버튼은 bg-blue-600 hover:bg-blue-700 하나로",
  });
const redButtons = buttonList.filter((b) => b.family === "red");
if (redButtons.length > 1)
  cleanup.push({
    kind: "button",
    title: "빨간(위험) 버튼의 단계가 섞여 있음",
    detail: redButtons.map((b) => `${b.pair} ${b.total}`).join(" · "),
    suggest: "위험 버튼은 한 쌍으로(많이 쓰는 쪽은 bg-red-500 hover:bg-red-600)",
  });
const grayButtons = buttonList.filter((b) => b.family === "gray");
if (grayButtons.length > 1)
  cleanup.push({
    kind: "button",
    title: "회색 버튼이 여러 가지",
    detail: grayButtons.map((b) => `${b.pair} ${b.total}`).join(" · "),
    suggest: "보조 버튼은 bg-gray-500 hover:bg-gray-600, 떠 있는 어두운 버튼(맨 위로 등)은 따로 정해 적기",
  });
const neutral = colorList.filter((c) => NEUTRALS.includes(c.name.split("-")[0]));
if (neutral.length)
  cleanup.push({
    kind: "neutral",
    title: "gray 말고 다른 무채색 계열",
    detail: neutral.map((c) => `${c.name} ${c.total}`).join(" · "),
    suggest: "무채색은 gray 한 계열로",
  });
const reds = ["red-500", "red-600"].map((n) => colors[n]).filter(Boolean);
if (reds.length === 2)
  cleanup.push({
    kind: "danger",
    title: "위험·패배 빨강이 500과 600으로 나뉨",
    detail: reds.map((c) => `${c.name} ${c.total}(text ${c.props.text ?? 0}·bg ${c.props.bg ?? 0})`).join(" · "),
    suggest: "글자는 red-500/dark:red-400(승률 규칙), 채운 버튼은 red-600으로 역할을 나눠 적기",
  });
const nearHex = hexList.filter((h) => !h.tailwind && h.nearest.delta < 3 && h.nearest.name !== "white" && h.nearest.name !== "black");
if (nearHex.length)
  cleanup.push({
    kind: "hex",
    title: "Tailwind 색과 거의 같은 hex",
    detail: nearHex.slice(0, 12).map((h) => `${h.hex}≈${h.nearest.name}(ΔE ${h.nearest.delta})`).join(" · "),
    suggest: "같은 색이면 Tailwind 색 이름(또는 그 hex)으로",
  });
const rare = colorList.filter((c) => c.total <= 2);
if (rare.length)
  cleanup.push({
    kind: "rare",
    title: `두 번 이하로만 쓴 Tailwind 색 ${rare.length}가지`,
    detail: rare.map((c) => `${c.name}`).join(" · "),
    suggest: "가까운 자주 쓰는 단계로 합칠 수 있는지",
  });

const families = {};
for (const c of colorList) bump(families, c.name.includes("-") ? c.name.split("-")[0] : c.name, c.total);

const out = {
  generated: new Date().toISOString().slice(0, 10),
  command: "cd frontend && node scripts/design-usage.mjs && DESIGN_MD=write npx vitest run src/lib/designMd.test.ts",
  files: fileCount,
  totals: { colorClasses: colorList.reduce((n, c) => n + c.total, 0), distinctColors: colorList.length, hexColors: hexList.length },
  families: Object.fromEntries(top(families, 40)),
  colors: colorList,
  classes: top(classes, 60).map(([name, count]) => ({ name, count })),
  hex: hexList.slice(0, 80),
  buttons: buttonList,
  darkPairs: top(darkPairs, 60).map(([pair, count]) => {
    const [light, dark] = pair.split(" | ");
    return { light, dark, count };
  }),
  cleanup,
  textSizes: Object.fromEntries(top(sizes, 30)),
  fontWeights: Object.fromEntries(top(weights, 10)),
  rounded: Object.fromEntries(top(rounds, 20)),
  shadows: Object.fromEntries(top(shadows, 20)),
  maxWidths: Object.fromEntries(top(maxW, 20)),
  spacing: Object.fromEntries(top(spacing, 40)),
  breakpoints: Object.fromEntries(top(breakpoints, 10)),
  counters,
  // every Tailwind colour by name, so the page and DESIGN.md can show the hex of any class without Tailwind itself
  palette: Object.fromEntries(TAILWIND.map((t) => [t.name, t.hex])),
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${fileCount} files, ${out.totals.colorClasses} colour classes in ${colorList.length} colours, ${hexList.length} hex colours → ${relative(ROOT, OUT)}`);
