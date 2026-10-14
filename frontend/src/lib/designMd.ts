// frontend/DESIGN.md written from the same data as the design page /dev/palette (designTokens.ts + designUsage.json),
// so the two never say different things. designMd.test.ts checks the file is current; with DESIGN_MD=write it
// writes it.
import usage from "@/lib/designUsage.json";
import {
  BREAKPOINTS, COLOR_GROUPS, COMPONENTS, DATA_GROUPS, DEPTH, DONTS, DOS, FONTS, ITERATION, KNOWN_GAPS, LAYOUT, OVERVIEW,
  RADII, RESPONSIVE_RULES, TYPE_RULES, TYPE_SCALE, type ColorGroup, type Swatch, type Tone,
} from "@/lib/designTokens";

export type Usage = typeof usage;
const PALETTE: Record<string, string> = usage.palette;

const TONE = /^(bg|text|border|ring|fill|stroke|from|to|outline)-([a-z]+-\d{2,3}|white|black)(?:\/(\d+))?$/;

/** A tone's colour: its hex, its opacity (0–1) and what it paints (bg, text, border…). */
export function resolveTone(tone: Tone): { hex: string; alpha: number; prop: string } {
  if (tone.startsWith("#")) return { hex: tone.toLowerCase(), alpha: 1, prop: "bg" };
  const m = tone.match(TONE);
  if (!m) return { hex: "#000000", alpha: 1, prop: "bg" };
  return { hex: PALETTE[m[2]] ?? "#000000", alpha: m[3] ? Number(m[3]) / 100 : 1, prop: m[1] };
}

/** "#1e3a8a" or "#1e3a8a 20%". */
export const toneText = (tone: Tone) => {
  const t = resolveTone(tone);
  return t.alpha < 1 ? `${t.hex} ${Math.round(t.alpha * 100)}%` : t.hex;
};

/** "#1e3a8a", or with its opacity as a fourth byte: "#1e3a8a33". */
export const toneHex = (tone: Tone) => {
  const t = resolveTone(tone);
  return t.alpha < 1 ? t.hex + Math.round(t.alpha * 255).toString(16).padStart(2, "0") : t.hex;
};

/** The colour as CSS, its opacity included. */
export const toneCss = (tone: Tone) => {
  const t = resolveTone(tone);
  if (t.alpha >= 1) return t.hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${t.alpha})`;
};

/** How the class is written: the light one, then its dark: pair. */
export const swatchClass = (s: Swatch) =>
  s.cls ?? (s.light.startsWith("#") ? "" : s.dark ? `${s.light} dark:${s.dark}` : s.light);

/** The usage count of a Tailwind size class ("text-sm" → textSizes.sm). */
export const sizeCount = (cls: string) => {
  const m = cls.match(/text-(xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])/);
  return m ? ((usage.textSizes as Record<string, number>)[m[1]] ?? 0) : 0;
};

/** The usage count of a corner class ("rounded-lg" → rounded.lg, "rounded" → rounded.DEFAULT). */
export const radiusCount = (cls: string) => {
  const r = usage.rounded as Record<string, number>;
  if (cls === "rounded") return r.DEFAULT ?? 0;
  if (cls === "card-corner") return usage.counters["card-corner"];
  return r[cls.replace(/^rounded-/, "")] ?? 0;
};

export const shadowCount = (cls: string) => (usage.shadows as Record<string, number>)[cls.split(" ")[0]] ?? 0;

const yamlKey = (k: string) => (/^[a-z0-9-]+$/.test(k) ? k : JSON.stringify(k));
const code = (s: string) => (s ? `\`${s}\`` : "");
const esc = (s: string) => s.replace(/\|/g, "\\|");

/** A group whose colours all sit in one place (the six deck powers): drawn as one grid, its place said once. */
export const sharedWhere = (g: ColorGroup) => {
  const places = new Set(g.swatches.map((s) => s.where));
  return places.size === 1 && g.swatches.length > 2 && g.swatches.every((s) => !s.dark && !s.cls) ? g.swatches[0].where : null;
};

function swatchLine(s: Swatch, withWhere: boolean) {
  const light = toneText(s.light);
  const dark = s.dark ? toneText(s.dark) : null;
  const cls = swatchClass(s);
  const values = dark ? `밝게 ${light} · 어둡게 ${dark}` : light;
  return `- **${s.name}** (${[code(cls), values].filter(Boolean).join(" · ")}): ${s.role}.${withWhere ? ` ${s.where}` : ""}`;
}

function group(g: ColorGroup) {
  const where = sharedWhere(g);
  return [
    `### ${g.title}`,
    "",
    ...(g.note ? [g.note, ""] : []),
    ...(where ? [`쓰이는 곳: ${where}`, ""] : []),
    ...g.swatches.map((s) => swatchLine(s, !where)),
    "",
  ];
}

export function renderDesignMd(): string {
  const colors = [...COLOR_GROUPS, ...DATA_GROUPS].flatMap((g) => g.swatches);
  const front = [
    "---",
    "version: 1",
    "name: YGO Decks",
    `description: ${JSON.stringify(OVERVIEW.summary)}`,
    `generated: ${usage.generated}`,
    "page: https://ygodecks.com/dev/palette",
    "colors:",
    ...colors.flatMap((s) => [
      `  ${yamlKey(s.key)}: "${toneHex(s.light)}"`,
      ...(s.dark ? [`  ${yamlKey(`${s.key}-dark`)}: "${toneHex(s.dark)}"`] : []),
    ]),
    "typography:",
    ...TYPE_SCALE.map((t) => `  ${t.key}: { class: "${t.cls}", size: "${t.px}" }`),
    "rounded:",
    ...RADII.map((r) => `  ${yamlKey(r.cls)}: "${r.px}"`),
    "breakpoints:",
    ...BREAKPOINTS.map((b) => `  ${b.name}: ${b.px}px`),
    "---",
    "",
  ];

  const topColors = usage.colors.slice(0, 20);
  const body = [
    `# ${OVERVIEW.title}`,
    "",
    `> 이 문서는 \`src/lib/designTokens.ts\`와 \`src/lib/designUsage.json\`에서 만들어집니다(${usage.generated}). 손으로 고치지 말고 ` +
      `\`${usage.command}\`로 다시 만드세요. 같은 내용을 운영진은 /dev/palette에서 살아 있는 견본과 함께 봅니다.`,
    "",
    "## 개요 (Overview)",
    "",
    OVERVIEW.summary,
    "",
    ...OVERVIEW.paragraphs.flatMap((p) => [p, ""]),
    "**특징**",
    ...OVERVIEW.traits.map((t) => `- ${t}`),
    "",
    "## 색 (Colors)",
    "",
    "값은 Tailwind 기본 팔레트입니다. `dark:` 값은 html에 `dark` 클래스가 있을 때(어두운 화면) 쓰입니다.",
    "",
    ...COLOR_GROUPS.flatMap(group),
    "## 데이터 색 (Data Colors)",
    "",
    "인터페이스가 아니라 데이터가 가진 색입니다. 다른 뜻으로 쓰지 않습니다.",
    "",
    ...DATA_GROUPS.flatMap(group),
    "## 실제 사용 빈도 (Usage)",
    "",
    `\`frontend/src\`의 파일 ${usage.files}개에서 Tailwind 색 클래스 ${usage.totals.colorClasses.toLocaleString("en-US")}개(서로 다른 색 ` +
      `${usage.totals.distinctColors}가지), 코드 속 hex ${usage.totals.hexColors}가지를 셌습니다(${usage.generated}).`,
    "",
    "### 많이 쓰는 색",
    "",
    "| 색 | hex | 전체 | 밝게 | dark: | 주로 |",
    "|---|---|---:|---:|---:|---|",
    ...topColors.map(
      (c) =>
        `| \`${c.name}\` | ${c.hex} | ${c.total} | ${c.light} | ${c.dark} | ${Object.entries(c.props)
          .slice(0, 3)
          .map(([p, n]) => `${p} ${n}`)
          .join(", ")} |`,
    ),
    "",
    "### 밝은/어두운 짝",
    "",
    "| 밝게 | 어둡게 | 횟수 |",
    "|---|---|---:|",
    ...usage.darkPairs.slice(0, 16).map((p) => `| \`${p.light}\` | \`${p.dark}\` | ${p.count} |`),
    "",
    "### 채운 버튼 (bg → hover)",
    "",
    ...usage.buttons.map((b) => `- \`${b.pair}\` ${b.total}곳`),
    "",
    "### 정리 후보",
    "",
    ...usage.cleanup.map((c) => `- **${c.title}** — ${c.detail}. → ${c.suggest}`),
    "",
    "## 글꼴 (Typography)",
    "",
    "### 글꼴",
    "",
    ...FONTS.map((f) => `- **${f.name}**: ${f.use}. ${f.detail}`),
    "",
    "### 크기 위계",
    "",
    "| 이름 | 클래스 | 크기/굵기 | 쓰는 곳 |",
    "|---|---|---|---|",
    ...TYPE_SCALE.map((t) => `| ${t.name} | \`${t.cls}\` | ${t.px} | ${esc(t.where)} |`),
    "",
    `글자 크기 사용: ${Object.entries(usage.textSizes)
      .slice(0, 10)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ")}. 굵기: ${Object.entries(usage.fontWeights)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ")}.`,
    "",
    "### 원칙",
    "",
    ...TYPE_RULES.map((r) => `- ${r}`),
    "",
    "## 레이아웃 (Layout)",
    "",
    ...LAYOUT.rules.map((r) => `- ${r}`),
    "",
    ...LAYOUT.bars.map((b) => `- ${b.name}: \`${b.value}\``),
    "",
    `자주 쓰는 폭(max-w-*): ${Object.entries(usage.maxWidths)
      .slice(0, 10)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ")}. 간격: ${Object.entries(usage.spacing)
      .slice(0, 12)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ")}.`,
    "",
    "## 깊이 (Elevation & Depth)",
    "",
    "| 클래스 | 이름 | 쓰는 곳 | 횟수 |",
    "|---|---|---|---:|",
    ...DEPTH.map((d) => `| \`${d.cls}\` | ${d.name} | ${d.use} | ${shadowCount(d.cls) || "–"} |`),
    "",
    "## 모양 (Shapes)",
    "",
    "| 클래스 | 값 | 쓰는 곳 | 횟수 |",
    "|---|---|---|---:|",
    ...RADII.map((r) => `| \`${r.cls}\` | ${r.px} | ${r.use} | ${radiusCount(r.cls)} |`),
    "",
    "tailwind.config.js는 rounded-lg = var(--radius)(0.5rem), md = −2px, sm = −4px(4px — Tailwind 기본 2px 아님)로 바꿉니다.",
    "",
    "## 컴포넌트 (Components)",
    "",
    ...COMPONENTS.flatMap((c) => [
      `### ${c.title}`,
      "",
      c.desc,
      "",
      ...(c.classes ?? []).map((x) => `- \`${x}\``),
      ...(c.states ?? []).map((x) => `- ${x}`),
      ...((c.classes?.length || c.states?.length) ? [""] : []),
    ]),
    "## 해야 할 것 / 하지 말 것 (Do's and Don'ts)",
    "",
    "### 해야 할 것",
    "",
    ...DOS.map((d) => `- ${d}`),
    "",
    "### 하지 말 것",
    "",
    ...DONTS.map((d) => `- ${d}`),
    "",
    "## 반응형 (Responsive Behavior)",
    "",
    "| 중단점 | 너비 | 쓴 횟수 | 바뀌는 것 |",
    "|---|---:|---:|---|",
    ...BREAKPOINTS.map((b) => `| \`${b.name}:\` | ${b.px}px | ${(usage.breakpoints as Record<string, number>)[b.name] ?? 0} | ${b.note} |`),
    "",
    ...RESPONSIVE_RULES.map((r) => `- ${r}`),
    "",
    "## 고치는 법 (Iteration Guide)",
    "",
    ...ITERATION.map((r, i) => `${i + 1}. ${r}`),
    "",
    "## 알려진 빈틈 (Known Gaps)",
    "",
    ...KNOWN_GAPS.map((g) => `- ${g}`),
    "",
  ];
  return [...front, ...body].join("\n");
}
