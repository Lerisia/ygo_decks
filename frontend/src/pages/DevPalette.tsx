import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import usage from "@/lib/designUsage.json";
import { radiusCount, resolveTone, shadowCount, sharedWhere, sizeCount, swatchClass, toneCss } from "@/lib/designMd";
import {
  BREAKPOINTS, COLOR_GROUPS, COMPONENTS, DATA_GROUPS, DEPTH, DONTS, DOS, FONTS, ITERATION, KNOWN_GAPS, LAYOUT, OVERVIEW,
  RADII, RESPONSIVE_RULES, TYPE_RULES, TYPE_SCALE, type ColorGroup, type ComponentDoc, type Swatch, type Tone,
} from "@/lib/designTokens";
import { POWER_COLORS } from "@/lib/deckPower";
import { FRAME_COLORS } from "@/lib/cardFrames";
import SearchForm from "@/components/SearchForm";
import { Input } from "@/components/ui/input";
import DexFilterBar from "@/components/DexFilterBar";
import DexTabs from "@/components/DexTabs";
import EngineBadge from "@/components/EngineBadge";
import UpdateBadge from "@/components/UpdateBadge";
import PLogo from "@/components/PLogo";
import Avatar, { type AvatarIcon } from "@/components/Avatar";
import DeckPickerModal from "@/components/DeckPickerModal";
import LogoLoader from "@/components/LogoLoader";
import NotificationCard from "@/components/NotificationCard";
import { SOURCE_STYLE } from "@/components/DeckNotesSection";
import { CoinSplit, MeterBar, ResultChips, rateTone, winRateTint } from "@/components/charts";
import { CardTile, TileSkeleton } from "@/pages/CardList";
import { RARITY_BADGE, RARITY_LABEL } from "@/api/cardIconApi";
import { listShopBorders, listShopIcons, type Border } from "@/api/avatarApi";
import { listCards, searchToFilters, type CardListItem } from "@/api/cardDexApi";
import type { SiteNotification } from "@/api/notificationApi";
import type { SheetSummary } from "@/api/toolApi";
import type { DexField, DexValues } from "@/utils/dexFilter";

// The swatches draw both screens whatever the site is set to: the page background of each (index.css --background).
const BASE = { light: "#ffffff", dark: "#0a0a0a" } as const;
const EDGE = { light: "#e5e7eb", dark: "#374151" } as const;
type Mode = keyof typeof BASE;

const SECTIONS = [
  { id: "overview", title: "개요" },
  { id: "colors", title: "색" },
  { id: "data-colors", title: "데이터 색" },
  { id: "usage", title: "실제 사용 빈도" },
  { id: "typography", title: "글꼴" },
  { id: "layout", title: "레이아웃" },
  { id: "depth", title: "깊이 · 모양" },
  { id: "components", title: "컴포넌트" },
  { id: "rules", title: "해야 할 것 / 하지 말 것" },
  { id: "responsive", title: "반응형" },
  { id: "gaps", title: "알려진 빈틈" },
  { id: "iteration", title: "고치는 법" },
];

type Tools = { copy: (text: string) => void; say: (text: string) => void };
const ToolsContext = createContext<Tools>({ copy: () => {}, say: () => {} });

/** Copying where the clipboard API is missing (an http address): a hidden textarea and the old copy command. */
function copyByHand(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // the router's own state is kept, so going back still works
  history.replaceState(history.state, "", `#${id}`);
}

/** A hex that copies itself when pressed. */
function Hex({ value }: { value: string }) {
  const { copy } = useContext(ToolsContext);
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      title="눌러서 복사"
      className="p-0 border-0 bg-transparent font-mono text-[11px] tabular-nums text-gray-700 dark:text-gray-200 underline decoration-dotted decoration-gray-400 underline-offset-2 hover:text-blue-600 dark:hover:text-blue-400"
    >
      {value}
    </button>
  );
}

// a code font with Pretendard behind it, for the Korean in a class list (a code font has no Hangul of its own)
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Pretendard Variable", Pretendard, monospace' };

const Code = ({ children }: { children: ReactNode }) => (
  <code style={MONO} className="inline-block max-w-full break-all rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-200">
    {children}
  </code>
);

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-4">
      <h2 id={`${id}-h`} className="text-xl font-bold">{title}</h2>
      {lead && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">{lead}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

const Box = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${className}`}>{children}</div>
);

/** One colour drawn on one screen's background: a fill, a line of text, or an outline, as the class paints. */
function ToneSample({ tone, mode, paint }: { tone: Tone; mode: Mode; paint?: string }) {
  const t = resolveTone(tone);
  const color = toneCss(tone);
  let inner: ReactNode;
  if (paint) inner = <span className="w-8 h-8 rounded-full" style={{ background: paint, boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.55), 0 1px 3px rgba(0,0,0,0.35)" }} />;
  else if (t.prop === "text") inner = <span className="text-lg font-bold leading-none" style={{ color }}>가 Aa 55%</span>;
  else if (t.prop === "border" || t.prop === "ring") inner = <span className="w-3/4 h-7 rounded-md" style={{ boxShadow: `inset 0 0 0 2px ${color}` }} />;
  else inner = <span className="absolute inset-1.5 rounded-md" style={{ background: color }} />;
  return (
    <span className="relative flex h-12 items-center justify-center rounded-lg" style={{ background: BASE[mode], boxShadow: `inset 0 0 0 1px ${EDGE[mode]}` }}>
      {inner}
    </span>
  );
}

function ModeTile({ mode, tone, paint, same }: { mode: Mode; tone: Tone; paint?: string; same?: boolean }) {
  const t = resolveTone(tone);
  return (
    <div className="min-w-0">
      <ToneSample tone={tone} mode={mode} paint={paint} />
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="whitespace-nowrap">{mode === "light" ? "☀️ 밝게" : `🌙 어둡게${same ? "(같음)" : ""}`}</span>
        <span className="whitespace-nowrap">
          <Hex value={t.hex} />
          {t.alpha < 1 && <span className="ml-1 tabular-nums">{Math.round(t.alpha * 100)}%</span>}
        </span>
      </div>
    </div>
  );
}

function SwatchRow({ s }: { s: Swatch }) {
  const cls = swatchClass(s);
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_17rem] sm:items-center border-t border-gray-100 dark:border-gray-700 first:border-t-0">
      <div className="min-w-0">
        <p className="font-semibold break-keep">
          {s.name}
          <span className="ml-2 font-mono text-[11px] font-normal text-gray-400">{s.key}</span>
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300 break-keep">{s.role}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-keep">{s.where}</p>
        {cls && <div className="mt-1"><Code>{cls}</Code></div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ModeTile mode="light" tone={s.light} paint={s.paint} />
        <ModeTile mode="dark" tone={s.dark ?? s.light} paint={s.paint} same={!s.dark} />
      </div>
    </div>
  );
}

/** Colours that all sit in one place (the six deck powers): a grid of tiles, each on both screens. */
function SwatchGrid({ g }: { g: ColorGroup }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {g.swatches.map((s) => (
        <div key={s.key} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
          <div className="grid grid-cols-2 h-12">
            {(["light", "dark"] as const).map((m) => (
              <span key={m} className="flex items-center justify-center" style={{ background: BASE[m] }}>
                <span className="w-7 h-7 rounded-full" style={{ background: toneCss(s.light) }} />
              </span>
            ))}
          </div>
          <div className="px-2 py-1.5">
            <p className="text-sm font-semibold break-keep">{s.name}</p>
            <p className="flex items-baseline justify-between gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="truncate">{s.role}</span>
              <Hex value={resolveTone(s.light).hex} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupBox({ g, extra }: { g: ColorGroup; extra?: ReactNode }) {
  const where = sharedWhere(g);
  return (
    <div id={g.id} className="scroll-mt-4">
      <h3 className="text-base font-semibold">{g.title}</h3>
      {g.note && <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400 break-keep">{g.note}</p>}
      {where && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-keep">쓰이는 곳: {where}</p>}
      <div className="mt-2">
        {where ? (
          <SwatchGrid g={g} />
        ) : (
          <Box className="px-4">
            {g.swatches.map((s) => <SwatchRow key={s.key} s={s} />)}
          </Box>
        )}
      </div>
      {extra && <div className="mt-2">{extra}</div>}
    </div>
  );
}

// ── live extras under the data colours ─────────────────────────────────────────────────────────────────────────────

const RATES = [40, 43, 45, 46, 48, 49, 50, 51, 52, 54, 55, 56, 60];

function WinRateScale() {
  return (
    <Box className="p-4 overflow-x-auto">
      <table className="text-sm tabular-nums">
        <tbody>
          <tr>
            <th className="pr-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">winRateTint</th>
            {RATES.map((r) => {
              const t = winRateTint(r);
              return <td key={r} className={`px-1.5 py-1 text-center font-semibold ${t.cls}`} style={t.mix ? { color: t.mix } : undefined}>{r}%</td>;
            })}
          </tr>
          <tr>
            <th className="pr-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">rateTone</th>
            {RATES.map((r) => <td key={r} className={`px-1.5 py-1 text-center ${rateTone(r)}`}>{r}%</td>)}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-keep">
        살아 있는 함수로 그린 줄입니다. 45%와 55%에서 두 규칙이 갈리고, 어두운 화면에서 winRateTint의 파랑·빨강은 밝아지지 않습니다.
      </p>
    </Box>
  );
}

function CoinExtra() {
  return (
    <Box className="p-4 flex flex-wrap items-center gap-6">
      <span className="flex items-center gap-2 text-sm"><EngineBadge className="w-10 h-10 text-lg" /> 엔진</span>
      <span className="flex items-center gap-2 text-sm"><UpdateBadge className="w-10 h-10 text-lg" /> 신규 업데이트 덱</span>
      <span className="flex items-center gap-2 text-sm"><EngineBadge className="w-6 h-6 text-xs" /><UpdateBadge className="w-6 h-6 text-xs" /> 덱 표지 위 크기(w-6, 폰 w-5)</span>
    </Box>
  );
}

const RARITIES = ["N", "R", "SR", "UR"];
const ICON_RARITIES = ["common", "rare", "epic", "legendary"] as const;

function RarityExtra() {
  return (
    <Box className="p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="flex items-center gap-2">
        {RARITIES.map((r) => <img key={r} src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-5 w-auto" />)}
        <span className="text-xs text-gray-500 dark:text-gray-400">카드 레어도(게임 그림)</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {ICON_RARITIES.map((r) => <span key={r} className={`text-xs px-1.5 py-0.5 rounded font-semibold ${RARITY_BADGE[r]}`}>{RARITY_LABEL[r]}</span>)}
        <span className="text-xs text-gray-500 dark:text-gray-400">포인트 상점 등급</span>
      </span>
    </Box>
  );
}

const SOURCE_NAMES: Record<string, string> = { postype: "포스타입", dcinside: "디시인사이드", notion: "노션", gdocs: "구글 문서", blog: "블로그", twitter: "X", other: "기타" };

function SourceExtra() {
  return (
    <Box className="p-4 flex flex-wrap items-center gap-1.5">
      {Object.entries(SOURCE_STYLE).map(([k, cls]) => <span key={k} className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${cls}`}>{SOURCE_NAMES[k] ?? k}</span>)}
      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-semibold">⏳ 2년 이상 지난 노트</span>
    </Box>
  );
}

const DARK_NAMES = new Set(["normal", "synchro"]);

function FrameExtra() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {Object.entries(FRAME_COLORS).map(([k, hex]) => (
        <div key={k} className={`rounded-xl p-1.5 dark:ring-1 dark:ring-white/10 ${DARK_NAMES.has(k) ? "text-gray-900" : "text-white"}`} style={{ background: hex }}>
          <p className="px-1.5 pt-0.5 text-sm font-extrabold">{k}</p>
          <div className="mt-1 h-6 rounded-lg bg-gray-200 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

const GROUP_EXTRAS: Record<string, () => ReactNode> = {
  "data-winrate": () => <WinRateScale />,
  "data-coin": () => <CoinExtra />,
  "data-rarity": () => <RarityExtra />,
  "data-source": () => <SourceExtra />,
  "data-frame": () => <FrameExtra />,
};

// ── usage ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type UsageColor = (typeof usage.colors)[number];
const FAMILY_TWINS: [string, string][] = [["purple", "violet"], ["green", "emerald"]];

/** Why a colour is a 정리 후보, from the counts: a minority button pair, a rarely used step, a twin family. */
function flagsOf(): Record<string, string> {
  const flags: Record<string, string> = {};
  const byFamily = new Map<string, typeof usage.buttons>();
  for (const b of usage.buttons) byFamily.set(b.family, [...(byFamily.get(b.family) ?? []), b]);
  const pair = (b: (typeof usage.buttons)[number]) => `bg-${b.base}→${b.hover.split("-").pop()}`;
  for (const list of byFamily.values()) for (const b of list.slice(1)) flags[b.base] = `버튼 ${pair(b)} ${b.total}곳, 보통 ${pair(list[0])}`;
  const families = usage.families as Record<string, number>;
  for (const [big, small] of FAMILY_TWINS)
    for (const c of usage.colors) if (c.name.startsWith(`${small}-`) && !flags[c.name]) flags[c.name] = `${small} 계열 — 비슷한 ${big}(${families[big] ?? 0}회)과 섞임`;
  for (const c of usage.colors) if (c.total <= 2 && !flags[c.name]) flags[c.name] = "두 번 이하로만 씀";
  return flags;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box className="px-4 py-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
    </Box>
  );
}

function FamilyBar() {
  const fam = Object.entries(usage.families as Record<string, number>);
  const total = fam.reduce((n, [, v]) => n + v, 0);
  const hexOf = (f: string) => (usage.palette as Record<string, string>)[f === "white" || f === "black" ? f : `${f}-500`] ?? "#9ca3af";
  return (
    <Box className="p-4">
      <h3 className="text-base font-semibold">색 계열별 비율</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">색 클래스 {total.toLocaleString()}개 — 계열마다 500 단계 색으로 칠함</p>
      <div className="mt-3 flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="색 계열별 비율">
        {fam.map(([f, n]) => (
          <span
            key={f}
            title={`${f} ${n}회 (${((n / total) * 100).toFixed(1)}%)`}
            className="h-full first:rounded-l last:rounded-r"
            style={{ width: `${(n / total) * 100}%`, minWidth: 2, background: hexOf(f), boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {fam.map(([f, n]) => (
          <li key={f} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: hexOf(f), boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }} />
            <span className="font-mono">{f}</span>
            <span className="tabular-nums text-gray-500 dark:text-gray-400">{n} · {((n / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </Box>
  );
}

const propsText = (c: UsageColor) =>
  Object.entries(c.props as Record<string, number | undefined>)
    .slice(0, 3)
    .map(([p, n]) => `${p} ${n}`)
    .join(" · ");

function TopColors({ flags }: { flags: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const list = all ? usage.colors : usage.colors.slice(0, 24);
  const max = usage.colors[0]?.total ?? 1;
  return (
    <Box className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">많이 쓰는 색</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">막대 = 쓴 횟수(그 색으로 칠함) · 밝게 / dark: 나눔 · 주로 쓰는 속성</span>
      </div>
      <ul className="mt-3 flex flex-col">
        {list.map((c) => (
          <li key={c.name} className="grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,16rem)] items-center gap-x-3 gap-y-0.5 py-1.5 border-t border-gray-100 dark:border-gray-700 first:border-t-0">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-4 h-4 shrink-0 rounded" style={{ background: c.hex, boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }} />
              <span className="font-mono text-xs truncate">{c.name}</span>
            </span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-3 shrink-0 rounded-r" style={{ width: `calc((100% - 3rem) * ${c.total / max})`, minWidth: 2, background: c.hex, boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }} />
              <span className="text-xs font-semibold tabular-nums">{c.total}</span>
            </span>
            <span className="col-span-2 sm:col-span-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 min-w-0">
              <Hex value={c.hex} />
              <span className="tabular-nums">밝게 {c.light} · dark: {c.dark}</span>
              <span className="truncate">{propsText(c)}</span>
              {flags[c.name] && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold break-keep">정리 후보 · {flags[c.name]}</span>}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setAll(!all)}
        className="mt-3 h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
      >
        {all ? "위 24가지만" : `${usage.colors.length}가지 모두 보기`}
      </button>
    </Box>
  );
}

const pairTone = (cls: string) => cls.replace(/^dark:/, "");

function PairTable() {
  return (
    <Box className="p-4 overflow-x-auto">
      <h3 className="text-base font-semibold">밝은 화면 ↔ 어두운 화면 짝</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-keep">같은 클래스 묶음 안에서 밝은 클래스와 가장 가까운 dark: 클래스를 짝지어 셈. 위 표의 역할 색은 이 짝에서 골랐습니다.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
            <th className="py-1 pr-3 font-semibold">밝게</th>
            <th className="py-1 pr-3 font-semibold">어둡게</th>
            <th className="py-1 text-right font-semibold">횟수</th>
          </tr>
        </thead>
        <tbody>
          {usage.darkPairs.slice(0, 20).map((p) => (
            <tr key={`${p.light}|${p.dark}`} className="border-t border-gray-100 dark:border-gray-700">
              {[p.light, p.dark].map((cls, i) => (
                <td key={cls} className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 shrink-0 rounded" style={{ background: toneCss(pairTone(cls)), boxShadow: `inset 0 0 0 1px ${i ? EDGE.dark : EDGE.light}` }} />
                    <span className="font-mono text-xs">{cls}</span>
                  </span>
                </td>
              ))}
              <td className="py-1.5 text-right tabular-nums">{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

function ButtonPairs() {
  const pal = usage.palette as Record<string, string>;
  return (
    <Box className="p-4">
      <h3 className="text-base font-semibold">채운 버튼의 색 쌍 (바탕 → hover)</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-keep">흰 글자에 bg-{"{색}"}와 같은 색의 hover:bg-를 함께 쓴 클래스 묶음. 견본에 마우스를 올리면 hover 색이 됩니다.</p>
      <ul className="mt-3 flex flex-col">
        {usage.buttons.map((b) => (
          <li key={b.pair} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-t border-gray-100 dark:border-gray-700 first:border-t-0">
            <span
              className="inline-flex h-8 items-center px-3 rounded-lg text-white text-sm font-semibold transition-colors"
              style={{ background: pal[b.base] }}
              onMouseEnter={(e) => (e.currentTarget.style.background = pal[b.hover])}
              onMouseLeave={(e) => (e.currentTarget.style.background = pal[b.base])}
            >
              버튼
            </span>
            <span className="font-mono text-xs">{b.pair}</span>
            <span className="text-xs font-semibold tabular-nums">{b.total}곳</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{b.files.map((f) => f.file).join(", ")}</span>
          </li>
        ))}
      </ul>
    </Box>
  );
}

function HexTable() {
  return (
    <Box className="p-4 overflow-x-auto">
      <h3 className="text-base font-semibold">코드 속 hex 색</h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-keep">
        style·캔버스·SVG에 직접 적은 색. 대부분 게임 연출(팩깡·미니게임·움직이는 프레임)이고, Tailwind 색과 같은 것은 이름을 붙였습니다.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
            <th className="py-1 pr-3 font-semibold">hex</th>
            <th className="py-1 pr-3 text-right font-semibold">횟수</th>
            <th className="py-1 pr-3 font-semibold">Tailwind</th>
            <th className="py-1 font-semibold">파일</th>
          </tr>
        </thead>
        <tbody>
          {usage.hex.slice(0, 24).map((h) => (
            <tr key={h.hex} className="border-t border-gray-100 dark:border-gray-700 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 rounded" style={{ background: h.hex, boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.35)" }} />
                  <Hex value={h.hex} />
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{h.total}</td>
              <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                {h.tailwind ? h.tailwind : <span className="text-gray-500 dark:text-gray-400">≈ {h.nearest.name} (ΔE {h.nearest.delta})</span>}
              </td>
              <td className="py-1.5 text-[11px] text-gray-500 dark:text-gray-400 break-all">{h.files.map((f) => f.file).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

function Cleanup() {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {usage.cleanup.map((c) => (
        <div key={c.title} className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 p-4">
          <p className="font-semibold break-keep">🧹 {c.title}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 break-words">{c.detail}</p>
          <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-300 break-keep">→ {c.suggest}</p>
        </div>
      ))}
    </div>
  );
}

function CountChips({ counts, limit = 14, prefix = "" }: { counts: Record<string, number>; limit?: number; prefix?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(counts)
        .slice(0, limit)
        .map(([k, n]) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 text-xs">
            <span className="font-mono">{prefix}{k}</span>
            <span className="tabular-nums text-gray-500 dark:text-gray-400">{n}</span>
          </span>
        ))}
    </div>
  );
}

// ── live components ───────────────────────────────────────────────────────────────────────────────────────────────

const FILTER_FIELDS: DexField[] = [
  { key: "strength", label: "파워", primary: true, options: POWER_COLORS.map((p) => ({ value: p.label, label: p.label })) },
  { key: "difficulty", label: "난이도", options: ["쉬움", "보통", "어려움"].map((v) => ({ value: v, label: v })) },
  { key: "deck_type", label: "덱 타입", options: ["전개", "미드레인지", "운영", "특이"].map((v) => ({ value: v, label: v })) },
  { key: "gimmick", label: "기믹", multi: true, options: ["묘지", "제외", "패 트랩", "특수 소환"].map((v) => ({ value: v, label: v })) },
];
const FILTER_EXTRA: DexField = {
  key: "other", label: "그 외", multi: true,
  options: [{ value: "engine", label: "엔진" }, { value: "upcoming", label: "신규 업데이트" }],
};

function PowerSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="h-9 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-800 transition"
    >
      덱 파워
      <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${on ? "bg-blue-600" : "bg-gray-400"}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  const choose = (next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private mode: the choice lasts until the tab closes */
    }
  };
  return [dark, choose] as const;
}

/** The site's own 화면 밝기 switch (더보기): it changes the whole site, this page included. */
function ThemeSwitch() {
  const [dark, choose] = useDark();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="화면 밝기"
      onClick={() => choose(!dark)}
      className="flex items-center gap-2 p-0 bg-transparent border-0"
    >
      <span className="text-sm text-gray-500 dark:text-gray-400">{dark ? "🌙 어둡게" : "☀️ 밝게"}</span>
      <span className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${dark ? "bg-blue-600" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function ButtonsLive() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="h-9 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition">저장</button>
        <button type="button" className="h-9 px-4 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition">닫기</button>
        <button type="button" className="h-9 px-4 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition">삭제</button>
        <button
          type="button"
          className="h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          테두리 버튼
        </button>
        <button type="button" disabled className="h-9 px-4 rounded-lg bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 font-semibold cursor-not-allowed">
          비활성
        </button>
        <button type="button" className="p-0 border-0 bg-transparent text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">더보기</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="inline-flex items-center gap-1 rounded-full font-semibold px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">📢 공지</span>
        <span className="relative inline-flex items-center gap-1 rounded-full font-semibold px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
          💬 문의
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center tabular-nums">3</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full font-semibold px-3 py-1.5 bg-rose-600 text-white">☕ 후원</span>
        <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">메뉴 막대의 알약 링크(Navbar SupportLinks)</span>
      </div>
    </div>
  );
}

function InputsLive() {
  const { say } = useContext(ToolsContext);
  const [q, setQ] = useState("");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        검색칸 (SearchForm + ui/Input, 엔터로 검색)
        <SearchForm onSearch={() => say(q.trim() ? `검색: ${q.trim()}` : "검색어 없음")}>
          <Input placeholder="카드 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </SearchForm>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        입력칸 (rounded-lg, 포커스 파란 고리)
        <input
          type="text"
          placeholder="닉네임"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        비활성 입력
        <input
          type="text"
          disabled
          placeholder="고칠 수 없음"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-sm opacity-60 cursor-not-allowed"
        />
      </label>
    </div>
  );
}

function FiltersLive() {
  const [values, setValues] = useState<DexValues>({ strength: [], difficulty: [], deck_type: ["전개"], gimmick: ["묘지"], other: [] });
  const [power, setPower] = useState(true);
  return (
    <DexFilterBar fields={FILTER_FIELDS} extra={FILTER_EXTRA} values={values} onChange={setValues} right={<PowerSwitch on={power} onChange={setPower} />} />
  );
}

function TabsLive() {
  const [view, setView] = useState("큰 그림");
  return (
    <div className="flex flex-col gap-3">
      <DexTabs />
      <div role="tablist" aria-label="보기 방식" className="flex w-fit rounded-lg bg-gray-200 dark:bg-gray-700 p-0.5 text-xs md:text-sm font-semibold">
        {["큰 그림", "작은 그림", "목록"].map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={v === view}
            onClick={() => setView(v)}
            className={`px-3 py-1 rounded-md border-0 transition ${
              v === view ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "bg-transparent text-gray-600 dark:text-gray-300"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function SwitchesLive() {
  const [power, setPower] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <PowerSwitch on={power} onChange={setPower} />
      <span className="flex items-center gap-3">
        <span className="text-sm font-medium">화면 밝기</span>
        <ThemeSwitch />
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400 break-keep">오른쪽 스위치는 진짜로 사이트 화면 밝기를 바꿉니다.</span>
    </div>
  );
}

const BAN_ICONS = [
  { key: "forbidden", label: "금지" },
  { key: "limited", label: "제한" },
  { key: "semi_limited", label: "준제한" },
];

function BadgesLive() {
  const cell = "flex flex-col items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400";
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
      <span className={cell}><EngineBadge className="w-6 h-6 text-xs" />엔진 E</span>
      <span className={cell}><UpdateBadge className="w-6 h-6 text-xs" />신규 N</span>
      <span className={cell}><span className="flex items-center gap-1"><PLogo size={16} /><PLogo size={18} /><PLogo size={24} /></span>포인트 P</span>
      <span className={cell}><span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">BETA</span>놀이터</span>
      <span className={cell}><span className="font-semibold text-sm">스킬 릴레이 <span className="text-amber-600 dark:text-amber-400">(베타)</span></span>제목 옆</span>
      <span className={cell}>
        <span className="flex gap-1">{ICON_RARITIES.map((r) => <span key={r} className={`text-xs px-1.5 py-0.5 rounded font-semibold ${RARITY_BADGE[r]}`}>{RARITY_LABEL[r]}</span>)}</span>
        상점 등급
      </span>
      <span className={cell}>
        <span className="flex items-center gap-1">{RARITIES.map((r) => <img key={r} src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" />)}</span>
        레어도
      </span>
      <span className={cell}>
        <span className="flex items-center gap-1">{BAN_ICONS.map((b) => <img key={b.key} src={`/media/md_ui/info/limit/${b.key}.webp`} alt={b.label} title={b.label} className="w-6 h-6" />)}</span>
        금제
      </span>
      <span className={cell}>
        <span className="relative inline-flex"><span className="w-7 h-7 rounded-full bg-gray-300 dark:bg-gray-600" /><span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-900" /></span>
        새 알림 점
      </span>
      <span className={cell}><span className="text-sm font-semibold">강의노트 <span className="text-gray-400">↗</span></span>외부 링크</span>
    </div>
  );
}

type DeckRow = { id: number; name: string; strength: string; cover_image: string | null; cover_image_phone?: string | null; is_engine?: boolean; is_upcoming?: boolean };
const powerRing = (color: string) => ({ boxShadow: `0 0 0 3px ${color}, 0 0 9px 2px ${color}99` });

/** One deck of each power, an engine and a 신규 업데이트 deck among them where the book has one. */
function pickDecks(decks: DeckRow[]) {
  let engine = false;
  let upcoming = false;
  return POWER_COLORS.map((p) => {
    const tier = decks.filter((d) => d.strength === p.label && d.cover_image);
    const d = (!upcoming && tier.find((x) => x.is_upcoming)) || (!engine && tier.find((x) => x.is_engine)) || tier[0];
    if (d?.is_upcoming) upcoming = true;
    if (d?.is_engine) engine = true;
    return d;
  }).filter((d): d is DeckRow => !!d);
}

function DeckTileSkeleton() {
  return (
    <div>
      <div className="w-full h-24 md:h-auto md:aspect-[4/3] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="mt-1 h-5 sm:h-6 flex items-center justify-center">
        <div className="h-3.5 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

function DecksLive() {
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [cards, setCards] = useState<CardListItem[] | null>(null);
  const [power, setPower] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/deck/")
      .then((r) => r.json())
      .then((d) => alive && setDecks(pickDecks(d.decks || [])))
      .catch(() => alive && setDecks([]));
    listCards(searchToFilters(""), 1)
      .then((r) => {
        if (!alive) return;
        const seen = new Set<string>();
        const varied = r.results.filter((c) => {
          const k = `${c.rarity}|${c.ban ? "ban" : ""}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setCards([...varied, ...r.results.filter((c) => !varied.includes(c))].slice(0, 6));
      })
      .catch(() => alive && setCards([]));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">덱 도감 목록 칸과 같은 모양(Database.tsx) — 단계마다 한 덱</span>
        <PowerSwitch on={power} onChange={setPower} />
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
        {decks === null
          ? POWER_COLORS.map((p) => <DeckTileSkeleton key={p.label} />)
          : decks.map((deck) => (
              <Link key={deck.id} to={`/database/${deck.id}`} className="block text-center text-inherit hover:text-inherit">
                <div className="relative">
                  <img
                    loading="lazy"
                    decoding="async"
                    src={deck.cover_image_phone || deck.cover_image || "/default_cover.png"}
                    alt={deck.name}
                    className="w-full h-24 md:h-auto md:aspect-[4/3] object-cover rounded-lg"
                    style={power ? powerRing(POWER_COLORS.find((p) => p.label === deck.strength)?.color ?? "transparent") : undefined}
                  />
                  {deck.is_engine && <EngineBadge className="absolute top-1 left-1 w-5 h-5 sm:w-6 sm:h-6 text-[11px] sm:text-xs" />}
                  {deck.is_upcoming && <UpdateBadge className="absolute top-1 right-1 w-5 h-5 sm:w-6 sm:h-6 text-[11px] sm:text-xs" />}
                </div>
                <p className="mt-1 h-5 sm:h-6 text-sm sm:text-base font-normal truncate">{deck.name}</p>
              </Link>
            ))}
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">카드 도감 칸(CardList의 CardTile): 서버가 그린 카드 그림, card-corner, 레어도·금제 그림</span>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {cards === null ? Array.from({ length: 6 }, (_, i) => <TileSkeleton key={i} />) : cards.map((c) => <CardTile key={c.id} card={c} />)}
      </div>
    </div>
  );
}

const AVATAR_SIZES = [26, 28, 48];

function AvatarLive() {
  const [icons, setIcons] = useState<AvatarIcon[] | null>(null);
  const [borders, setBorders] = useState<Border[] | null>(null);
  useEffect(() => {
    let alive = true;
    listShopIcons("용")
      .then((r) => alive && setIcons(r.icons.slice(0, 4)))
      .catch(() => alive && setIcons([]));
    listShopBorders()
      .then((r) => alive && setBorders(r.borders.slice(0, 4)))
      .catch(() => alive && setBorders([]));
    return () => {
      alive = false;
    };
  }, []);
  const ready = icons !== null && borders !== null;
  const icon = (i: number) => icons?.[i % Math.max(1, icons.length)] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {[null, ...(borders ?? [null, null, null, null])].slice(0, 5).map((b, i) => (
          <span key={i} className="flex items-center gap-2">
            {ready ? <Avatar icon={icon(i)} border={b} size={48} /> : <span className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />}
            <span className="flex flex-col">
              <span className="text-sm font-semibold">듀얼리스트{i + 1}</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{b ? `${b.name} 프레임` : "기본"}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        {AVATAR_SIZES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            {ready ? <Avatar icon={icon(0)} border={borders?.[1] ?? null} size={s} /> : <span className="rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" style={{ width: s, height: s }} />}
            {s}px
          </span>
        ))}
        <span>메뉴 막대: 폰 26px · PC 28px, 아이콘이 없으면 회색 원</span>
      </div>
    </div>
  );
}

function PickerLive() {
  const { say } = useContext(ToolsContext);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setOpen(true)} className="h-9 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition">
        📚 덱 고르기 창 열기
      </button>
      <span className="text-xs text-gray-500 dark:text-gray-400 break-keep">DeckPickerModal(PickerModal) 그대로. 골라도 이동하지 않습니다.</span>
      <DeckPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          setOpen(false);
          say(`덱 #${id}를 골랐습니다 (견본)`);
        }}
      />
    </div>
  );
}

function LoadingLive() {
  return (
    <div className="flex flex-wrap items-end gap-6">
      <div className="grid w-40 grid-cols-2 gap-3">
        <TileSkeleton />
        <TileSkeleton />
      </div>
      <div className="w-48 flex flex-col gap-2">
        <div className="h-5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-3.5 w-full rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-3.5 w-5/6 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-16 w-full rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
      <div className="flex items-end gap-4">
        {[24, 48, 96].map((s) => (
          <span key={s} className="flex flex-col items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <LogoLoader size={s} />
            {s}px
          </span>
        ))}
        <span className="flex items-center gap-2 text-sm"><LogoLoader size={22} /> 불러오는 중…</span>
      </div>
    </div>
  );
}

const NOTICES: SiteNotification[] = [
  { id: -1, sender: "YGO Decks", body: "새 프레임 '플래티넘'을 받았습니다. 마이페이지에서 바꿔 보세요.", action_label: "프레임 바꾸기", action_url: "/mypage", created_at: "2026-10-14T12:00:00+09:00", read: false, acted: false },
  { id: -2, sender: "운영진", body: "문의하신 내용에 답변이 달렸습니다.", action_label: "답변 보기", action_url: "/inquiry", created_at: "2026-10-13T12:00:00+09:00", read: true, acted: true },
];

function NoticeLive() {
  const { say } = useContext(ToolsContext);
  return (
    // a sample: its buttons are caught here so nothing is sent or opened
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          e.stopPropagation();
          e.preventDefault();
          say("견본이라 동작하지 않습니다");
        }
      }}
    >
      <section className="rounded-xl border-2 border-yellow-400 dark:border-yellow-500 bg-yellow-300/25 dark:bg-yellow-500/10 px-3 py-3 sm:px-4 max-w-xl">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="text-base font-semibold m-0">알림 2개</h4>
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">더보기</span>
        </div>
        <div className="space-y-2">
          {NOTICES.map((n) => <NotificationCard key={n.id} n={n} onClear={() => {}} onActed={() => {}} date="10/14" />)}
        </div>
      </section>
    </div>
  );
}

const RECENT: SheetSummary["recent"] = Array.from({ length: 17 }, (_, i) => ({
  r: [0, 2, 3, 5, 8, 9, 12, 15].includes(i) ? "lose" : "win",
  fs: i % 3 === 0 ? "second" : "first",
  coin: i % 2 === 0 ? "win" : "lose",
}));

function ChartsLive() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <ResultChips recent={RECENT} />
        {(["gray", "red", "amber"] as const).map((t, i) => (
          <div key={t} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="w-12 font-mono">{t}</span>
            <MeterBar value={[62, 48, 71][i]} track={t} className="flex-1" />
          </div>
        ))}
        <Link to="/manage/charts" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline">
          차트 견본 전체 (/manage/charts) →
        </Link>
      </div>
      <CoinSplit winGames={40} winWins={24} loseGames={38} loseWins={17} />
    </div>
  );
}

const LIVE: Record<string, () => ReactNode> = {
  buttons: () => <ButtonsLive />,
  inputs: () => <InputsLive />,
  filters: () => <FiltersLive />,
  tabs: () => <TabsLive />,
  switches: () => <SwitchesLive />,
  badges: () => <BadgesLive />,
  decks: () => <DecksLive />,
  avatar: () => <AvatarLive />,
  picker: () => <PickerLive />,
  loading: () => <LoadingLive />,
  notice: () => <NoticeLive />,
  charts: () => <ChartsLive />,
};

function Specimen({ doc }: { doc: ComponentDoc }) {
  return (
    <article id={`c-${doc.id}`} className="scroll-mt-4 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 bg-background">{LIVE[doc.id]?.()}</div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h3 className="text-base font-semibold">{doc.title}</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-keep">{doc.desc}</p>
        {!!doc.classes?.length && (
          <ul className="mt-2 flex flex-col gap-1">
            {doc.classes.map((c) => <li key={c}><Code>{c}</Code></li>)}
          </ul>
        )}
        {!!doc.states?.length && (
          <ul className="mt-2 list-disc pl-5 text-xs text-gray-500 dark:text-gray-400">
            {doc.states.map((s) => <li key={s} className="break-keep">{s}</li>)}
          </ul>
        )}
      </div>
    </article>
  );
}

// ── typography, layout, depth ─────────────────────────────────────────────────────────────────────────────────────

const WEIGHTS = [
  { w: 400, cls: "font-normal" },
  { w: 500, cls: "font-medium" },
  { w: 600, cls: "font-semibold" },
  { w: 700, cls: "font-bold" },
  { w: 800, cls: "font-extrabold" },
];

function Typography() {
  const weights = usage.fontWeights as Record<string, number>;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        {FONTS.map((f, i) => (
          <Box key={f.name} className="p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">{f.use}</p>
            <p className="mt-1 text-lg font-bold">{f.name}</p>
            {i === 0 ? (
              <div className="mt-2 flex flex-col gap-0.5">
                {WEIGHTS.map((w) => (
                  <p key={w.w} className={`${w.cls} text-base`}>
                    덱 도감 Deck 0123 <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{w.w} · {weights[w.cls.replace("font-", "")] ?? 0}회</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 break-keep">아래 '덱 표지 · 카드 그림' 견본의 카드 이름·공격력이 이 글꼴입니다.</p>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 break-keep">{f.detail}</p>
          </Box>
        ))}
      </div>
      <Box className="p-4 overflow-x-auto">
        <h3 className="text-base font-semibold">크기 위계</h3>
        <table className="mt-2 w-full text-left">
          <tbody>
            {TYPE_SCALE.map((t) => (
              <tr key={t.key} className="border-t border-gray-100 dark:border-gray-700 first:border-t-0 align-baseline">
                <td className="py-2 pr-4"><span className={t.cls}>{t.name} 유희왕 1234</span></td>
                <td className="py-2 pr-4 whitespace-nowrap"><Code>{t.cls}</Code></td>
                <td className="py-2 pr-4 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.px} · {sizeCount(t.cls)}회</td>
                <td className="py-2 text-xs text-gray-500 dark:text-gray-400 break-keep min-w-[12rem]">{t.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">text-* 크기를 쓴 횟수</p>
          <CountChips counts={usage.textSizes as Record<string, number>} limit={18} prefix="text-" />
        </div>
      </Box>
      <Box className="p-4">
        <h3 className="text-base font-semibold">원칙</h3>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1">
          {TYPE_RULES.map((r) => <li key={r} className="break-keep">{r}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">break-keep 없이</p>
            <p className="w-28 rounded-lg border border-dashed border-red-300 dark:border-red-800 p-2">링크 마커가 있는 몬스터</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">break-keep</p>
            <p className="w-28 rounded-lg border border-dashed border-green-400 dark:border-green-700 p-2 break-keep">링크 마커가 있는 몬스터</p>
          </div>
        </div>
      </Box>
    </>
  );
}

const MAX_W: Record<string, number> = { xs: 320, sm: 384, md: 448, lg: 512, xl: 576, "2xl": 672, "3xl": 768, "4xl": 896, "5xl": 1024, "6xl": 1152, "7xl": 1280 };
const SPACE = [1, 1.5, 2, 3, 4, 6];

function Layout() {
  const widths = Object.entries(usage.maxWidths as Record<string, number>).filter(([k]) => MAX_W[k]);
  return (
    <>
      <Box className="p-4">
        <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1">
          {LAYOUT.rules.map((r) => <li key={r} className="break-keep">{r}</li>)}
        </ul>
      </Box>
      <div className="grid gap-3 md:grid-cols-2">
        <Box className="p-4">
          <h3 className="text-base font-semibold">페이지 위 24px</h3>
          <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            <div className="h-10 flex items-center px-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 font-semibold">메뉴 막대</div>
            <div className="h-6 flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-mono">pt-6 · 24px</div>
            <div className="px-3 pb-3 bg-background">
              <p className="text-base font-bold">페이지 제목</p>
              <p className="text-gray-500 dark:text-gray-400">본문은 바깥 상자 px-4 안에서 시작</p>
            </div>
          </div>
        </Box>
        <Box className="p-4">
          <h3 className="text-base font-semibold">자주 쓰는 막대·격자</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {LAYOUT.bars.map((b) => (
              <div key={b.name} className="contents">
                <dt className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{b.name}</dt>
                <dd style={MONO} className="text-xs self-center break-all">{b.value}</dd>
              </div>
            ))}
          </dl>
        </Box>
      </div>
      <Box className="p-4">
        <h3 className="text-base font-semibold">폭 (max-w-*)</h3>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">막대 길이 = 그 폭(1280px 기준), 숫자 = 쓴 횟수</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {widths.sort((a, b) => MAX_W[a[0]] - MAX_W[b[0]]).map(([k, n]) => (
            <li key={k} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
              <span className="font-mono">{k}</span>
              <span className="h-3 rounded-r bg-gray-300 dark:bg-gray-600" style={{ width: `${(MAX_W[k] / 1280) * 100}%` }} title={`${MAX_W[k]}px`} />
              <span className="tabular-nums text-right">{MAX_W[k]}px · {n}</span>
            </li>
          ))}
        </ul>
      </Box>
      <Box className="p-4">
        <h3 className="text-base font-semibold">간격</h3>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          {SPACE.map((s) => (
            <span key={s} className="flex flex-col items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="bg-blue-600 rounded-sm" style={{ width: s * 4, height: 24 }} />
              {s} = {s * 4}px
            </span>
          ))}
        </div>
        <p className="mt-3 mb-1.5 text-xs text-gray-500 dark:text-gray-400">많이 쓰는 간격 클래스</p>
        <CountChips counts={usage.spacing as Record<string, number>} limit={24} />
      </Box>
    </>
  );
}

function Depth() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {DEPTH.map((d) => (
          <div key={d.cls} className="flex flex-col gap-2">
            <div className={`h-20 rounded-xl bg-white dark:bg-gray-800 ${d.cls}`} />
            <p className="text-sm font-semibold">{d.name}</p>
            <Code>{d.cls}</Code>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">{d.use} · {shadowCount(d.cls) || "–"}회</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {RADII.map((r) => (
          <div key={r.cls} className="flex flex-col gap-2">
            {r.cls === "card-corner" ? (
              <div className="h-20 aspect-[704/1024] card-corner bg-gray-300 dark:bg-gray-600" />
            ) : (
              <div className={`h-20 bg-gray-200 dark:bg-gray-700 border-2 border-gray-400 dark:border-gray-500 ${r.cls}`} />
            )}
            <p className="text-sm font-semibold">{r.cls} <span className="font-normal text-gray-500 dark:text-gray-400">{r.px}</span></p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">{r.use} · {radiusCount(r.cls)}회</p>
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <div className="relative h-20 rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700">
            <span className="absolute left-3 top-3 text-xs font-semibold">페이지</span>
            <span className="absolute inset-0 bg-black/60" />
            <span className="absolute inset-x-4 bottom-3 top-7 rounded-lg bg-white dark:bg-gray-800 shadow-xl" />
          </div>
          <p className="text-sm font-semibold">덮개 bg-black/60</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">모달 뒤 화면 — /50과 섞여 있음</p>
        </div>
      </div>
    </>
  );
}

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function Responsive() {
  const width = useWidth();
  const counts = usage.breakpoints as Record<string, number>;
  const now = [...BREAKPOINTS].reverse().find((b) => width >= b.px)?.name ?? "sm 미만";
  return (
    <>
      <Box className="p-4 overflow-x-auto">
        <p className="text-sm">
          지금 화면: <b className="tabular-nums">{width}px</b> → <b className="text-blue-600 dark:text-blue-400">{now}</b>
        </p>
        <table className="mt-3 w-full text-sm text-left">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400">
              <th className="py-1 pr-3 font-semibold">중단점</th>
              <th className="py-1 pr-3 font-semibold text-right">너비</th>
              <th className="py-1 pr-3 font-semibold text-right">쓴 횟수</th>
              <th className="py-1 font-semibold">바뀌는 것</th>
            </tr>
          </thead>
          <tbody>
            {BREAKPOINTS.map((b) => (
              <tr key={b.name} className={`border-t border-gray-100 dark:border-gray-700 ${b.name === now ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}>
                <td className="py-1.5 pr-3 font-mono">{b.name}:</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{b.px}px</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{counts[b.name] ?? 0}</td>
                <td className="py-1.5 text-xs text-gray-600 dark:text-gray-300 break-keep min-w-[14rem]">{b.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <Box className="p-4">
        <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1">
          {RESPONSIVE_RULES.map((r) => <li key={r} className="break-keep">{r}</li>)}
        </ul>
      </Box>
    </>
  );
}

function Toc({ className = "" }: { className?: string }) {
  return (
    <ul className={className}>
      {SECTIONS.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            onClick={(e) => jump(e, s.id)}
            className="block rounded-lg px-2.5 py-1 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
          >
            {s.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** /dev/palette (operators only, 참혈 2026-10-14): the site's colours, type, layout and components in one page, laid
 *  out like getdesign.md's DESIGN.md files, with live samples and how often each colour is used. frontend/DESIGN.md
 *  holds the same, from the same data. */
export default function DevPalette() {
  const admin = useAdminOnly();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);
  const copy = useCallback((text: string) => {
    const done = () => setToast(`${text} 복사됨`);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => copyByHand(text) && done());
    else if (copyByHand(text)) done();
  }, []);
  const tools = useMemo(() => ({ copy, say: setToast }), [copy]);
  const flags = useMemo(flagsOf, []);
  // an address with #section opens at it
  useEffect(() => {
    if (!admin || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [admin]);
  if (!admin) return <div className="min-h-screen" />;

  return (
    <ToolsContext.Provider value={tools}>
      <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">디자인 정리</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">
              색·글꼴·모양·컴포넌트를 한곳에 — getdesign.md의 DESIGN.md 구성을 따랐습니다. 자료 {usage.generated} · 운영진 전용 · hex를 누르면 복사됩니다.
            </p>
          </div>
          <ThemeSwitch />
        </header>
        <nav aria-label="목차" className="lg:hidden mt-4">
          <Toc className="flex flex-wrap gap-1" />
        </nav>

        <div className="mt-6 lg:grid lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-8">
          <nav aria-label="목차" className="hidden lg:block">
            <div className="sticky top-4">
              <p className="px-2.5 mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">목차</p>
              <Toc className="flex flex-col" />
            </div>
          </nav>

          <main className="min-w-0 flex flex-col gap-12">
            <Section id="overview" title="개요">
              <Box className="p-4 md:p-5">
                <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                  <LogoLoader size={96} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold break-keep">{OVERVIEW.summary}</p>
                    {OVERVIEW.paragraphs.map((p) => <p key={p} className="mt-2 text-sm text-gray-600 dark:text-gray-300 break-keep">{p}</p>)}
                  </div>
                </div>
                <ul className="mt-4 grid gap-1.5 sm:grid-cols-2 text-sm">
                  {OVERVIEW.traits.map((t) => (
                    <li key={t} className="flex gap-2 break-keep"><span className="text-blue-600 dark:text-blue-400">●</span>{t}</li>
                  ))}
                </ul>
              </Box>
            </Section>

            <Section id="colors" title="색" lead="역할마다 밝은 화면 값과 어두운 화면 값을 나란히. 견본은 각 화면의 페이지 바탕(#ffffff / #0a0a0a) 위에 그렸습니다.">
              {COLOR_GROUPS.map((g) => <GroupBox key={g.id} g={g} />)}
            </Section>

            <Section id="data-colors" title="데이터 색" lead="인터페이스가 아니라 데이터가 가진 색. 다른 뜻으로 쓰지 않습니다.">
              {DATA_GROUPS.map((g) => <GroupBox key={g.id} g={g} extra={GROUP_EXTRAS[g.id]?.()} />)}
            </Section>

            <Section
              id="usage"
              title="실제 사용 빈도"
              lead={`frontend/src를 훑어 센 값입니다(${usage.generated}). 다시 세려면: ${usage.command}`}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="훑은 파일" value={usage.files} />
                <Stat label="색 클래스" value={usage.totals.colorClasses.toLocaleString()} />
                <Stat label="서로 다른 Tailwind 색" value={usage.totals.distinctColors} />
                <Stat label="코드 속 hex" value={usage.totals.hexColors} />
              </div>
              <FamilyBar />
              <TopColors flags={flags} />
              <h3 className="text-base font-semibold -mb-2">정리 후보</h3>
              <Cleanup />
              <PairTable />
              <ButtonPairs />
              <HexTable />
            </Section>

            <Section id="typography" title="글꼴" lead="상업용·게임 추출 글꼴은 쓰지 않습니다 — Pretendard, 마루 부리, Noto 같은 무료 글꼴만.">
              <Typography />
            </Section>

            <Section id="layout" title="레이아웃">
              <Layout />
            </Section>

            <Section id="depth" title="깊이 · 모양" lead="그림자는 떠 있는 것에만, 어두운 화면에서는 옅은 고리. 모서리는 버튼·입력 8px, 상자 12px, 칩·알약은 둥글게.">
              <Depth />
            </Section>

            <Section id="components" title="컴포넌트" lead="실제 컴포넌트를 불러와 그린 견본입니다. 덱·카드·아바타는 지금 사이트의 자료를 읽어 옵니다(읽기만).">
              {COMPONENTS.map((c) => <Specimen key={c.id} doc={c} />)}
            </Section>

            <Section id="rules" title="해야 할 것 / 하지 말 것">
              <div className="grid gap-3 md:grid-cols-2">
                <Box className="p-4">
                  <h3 className="text-base font-semibold text-green-700 dark:text-green-300">해야 할 것</h3>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {DOS.map((d) => <li key={d} className="flex gap-2 break-keep"><span className="text-green-600 dark:text-green-400 font-bold">✓</span><span>{d}</span></li>)}
                  </ul>
                </Box>
                <Box className="p-4">
                  <h3 className="text-base font-semibold text-red-700 dark:text-red-300">하지 말 것</h3>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {DONTS.map((d) => <li key={d} className="flex gap-2 break-keep"><span className="text-red-600 dark:text-red-400 font-bold">✕</span><span>{d}</span></li>)}
                  </ul>
                </Box>
              </div>
            </Section>

            <Section id="responsive" title="반응형">
              <Responsive />
            </Section>

            <Section id="gaps" title="알려진 빈틈" lead="정리하면서 본 불일치. 고칠지는 정해지지 않았습니다 — 위 '정리 후보'와 함께 보세요.">
              <Box className="p-4">
                <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1.5">
                  {KNOWN_GAPS.map((g) => <li key={g} className="break-keep">{g}</li>)}
                </ol>
              </Box>
            </Section>

            <Section id="iteration" title="고치는 법">
              <Box className="p-4">
                <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-200 space-y-1.5">
                  {ITERATION.map((r) => <li key={r} className="break-all">{r}</li>)}
                </ol>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 break-keep">
                  같은 내용의 문서: 저장소 frontend/DESIGN.md (AI 코딩 도구에 주는 디자인 기준 문서 형식).
                </p>
              </Box>
            </Section>
          </main>
        </div>

        {toast && (
          <div role="status" className="fixed top-4 right-4 z-[100] bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </ToolsContext.Provider>
  );
}
