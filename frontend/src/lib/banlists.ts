/** The 금제 a deck list is checked by (참혈 2026-10-16): Master Duel's, the OCG's or the TCG's — its newest, which a deck
 *  following it moves on with when the next one comes, or one list held to by its day — or one of ours by its code
 *  (커스텀, none yet), or 무금제, a preset among 커스텀's that limits nothing (참혈 2026-10-17). Kept with the deck as a key,
 *  as the server reads it (carddb/banlist.py parse_key): "md", "md:2026-10-06", "ocg", "custom:<code>", "none". */
import type { CardListItem } from "@/api/cardDexApi";

export type BanFormat = "md" | "ocg" | "tcg";
export type BanKind = BanFormat | "custom";
export type BanLimit = "forbidden" | "limited" | "semi_limited";
export type BanChoice = { kind: BanFormat; day: string | null } | { kind: "custom"; code: string } | { kind: "none" };

export const DEFAULT_BANLIST = "md";
export const NO_BANLIST = "none";
export const NO_BANLIST_LABEL = "무금제";
export const BAN_KINDS: { kind: BanKind; label: string }[] = [
  { kind: "md", label: "마스터 듀얼" }, { kind: "ocg", label: "OCG" }, { kind: "tcg", label: "TCG" }, { kind: "custom", label: "커스텀" },
];
const KIND_LABEL = Object.fromEntries(BAN_KINDS.map((k) => [k.kind, k.label])) as Record<BanKind, string>;
const FOLLOWS = "새 금제가 나오면 따라갑니다";

const KEY_RE = /^(md|ocg|tcg)(?::(\d{4}-\d\d-\d\d))?$|^custom:([A-Za-z0-9_-]{1,32})$|^(none)$/;
export const isCode = (code: string) => /^[A-Za-z0-9_-]{1,32}$/.test(code);

export function parseBanlistKey(key: string | null | undefined): BanChoice | null {
  const m = key ? KEY_RE.exec(key) : null;
  if (!m) return null;
  if (m[4]) return { kind: "none" };
  return m[3] ? { kind: "custom", code: m[3] } : { kind: m[1] as BanFormat, day: m[2] ?? null };
}

/** The picker's kind a key is under: 무금제 is one of 커스텀's presets. */
export const pickerKind = (choice: BanChoice | null): BanKind => (!choice ? "md" : choice.kind === "none" ? "custom" : choice.kind);

/** Each game's lists by day, newest first, and the server's today. */
export type BanlistIndex = { today: string; lists: Record<BanFormat, string[]> };

/** "2026.10.06", for a title. */
export const fullDay = (day: string) => day.split("-").join(".");

/** A list's day as the picker writes it: "26.10.06"; the OCG's by month ("26.10", its lists come on the 1st of a
 *  quarter) unless it had two that month (days: the game's lists). */
export function dayLabel(format: BanFormat, day: string, days: string[] = []) {
  const [y, m, d] = day.split("-");
  const byMonth = format === "ocg" && days.filter((x) => x.slice(0, 7) === day.slice(0, 7)).length < 2;
  return byMonth ? `${y.slice(2)}.${m}` : `${y.slice(2)}.${m}.${d}`;
}

/** A game's newest list in effect on the index's day (one announced for a later day waits for it). */
export const latestDay = (index: BanlistIndex, format: BanFormat) => index.lists[format].find((d) => d <= index.today) ?? null;

/** A list in the picker's years: its key, "10.06", and whether it is announced for a later day (예정). */
export type BanDay = { key: string; day: string; label: string; later: boolean };

/** A game's lists by year for the picker (참혈 2026-10-17): the newest year first, each year's lists newest first. */
export function banlistYears(format: BanFormat, index: BanlistIndex | null): { year: string; days: BanDay[] }[] {
  const out: { year: string; days: BanDay[] }[] = [];
  for (const day of index?.lists[format] ?? []) {
    const year = day.slice(0, 4);
    if (out[out.length - 1]?.year !== year) out.push({ year, days: [] });
    out[out.length - 1].days.push({ key: `${format}:${day}`, day, label: day.slice(5).replace("-", "."), later: day > index!.today });
  }
  return out;
}

/** The note on a game's 최신 in the picker. */
export const followsTitle = (index: BanlistIndex | null, format: BanFormat) => {
  const latest = index && latestDay(index, format);
  return latest ? `${fullDay(latest)} · ${FOLLOWS}` : FOLLOWS;
};

// a deck's page names the game as the picker does (참혈 2026-10-16)
const PAGE_LABEL = KIND_LABEL;

/** A deck's list for its page (참혈 2026-10-16): "마스터 듀얼 • 최신" — the newest with no day —,
 *  "마스터 듀얼 • 2026.07.01", "OCG • 2026.01" (by month as the picker has it). */
export function banlistName(key: string, index: BanlistIndex | null) {
  const choice = parseBanlistKey(key) ?? { kind: "md" as const, day: null };
  if (choice.kind === "none") return NO_BANLIST_LABEL;
  if (choice.kind === "custom") return `${PAGE_LABEL.custom} • ${choice.code}`;
  if (!choice.day) return `${PAGE_LABEL[choice.kind]} • 최신`;
  const label = dayLabel(choice.kind, choice.day, index?.lists[choice.kind]);
  return `${PAGE_LABEL[choice.kind]} • ${choice.day.slice(0, 2)}${label}`;
}

/** Its title: the list's whole day, the newest's too. */
export function banlistTitle(key: string, index: BanlistIndex | null) {
  const choice = parseBanlistKey(key) ?? { kind: "md" as const, day: null };
  if (choice.kind === "none") return "금제를 적용하지 않습니다";
  if (choice.kind === "custom") return "";
  if (choice.day) return fullDay(choice.day);
  return followsTitle(index, choice.kind);
}

/** The custom codes this browser used last (최근 사용, 참혈 2026-10-17), the last first. */
const RECENT_KEY = "banlist_recent_codes";
const RECENT_MAX = 5;

export function recentCodes(): string[] {
  try {
    const got = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(got) ? got.filter((c) => typeof c === "string" && isCode(c)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberCode(code: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([code, ...recentCodes().filter((c) => c !== code)].slice(0, RECENT_MAX)));
  } catch { /* not kept */ }
}

/** A list as the server sends it (/api/banlists/<game>/<day or latest>/): the cards it limits, and the day a card
 *  must be out by — the list's own, today for the newest. */
export type BanTable = {
  format: BanFormat; code?: string; day: string | null; released_by: string; latest: boolean; today: string;
  limits: Record<string, BanLimit>;
};

/** What a deck's cards are judged by: the cards its list limits (null: today's Master Duel list as each card carries
 *  it, CardListItem.ban, until the table comes), its game (null: 무금제's, none), and the day a card must be out by
 *  (null: not known yet, or 무금제, so none is 미출시). */
export type BanRule = { format: BanFormat | null; limits: Record<string, BanLimit> | null; releasedBy: string | null };

export const TODAY_MD: BanRule = { format: "md", limits: null, releasedBy: null };
/** 무금제: nothing limited, nothing 미출시; the page knows it without asking. */
export const NO_RULE: BanRule = { format: null, limits: {}, releasedBy: null };

export const ruleOf = (t: BanTable): BanRule => ({ format: t.format, limits: t.limits, releasedBy: t.released_by });

/** The rule while a list's table is on its way: Master Duel's newest is what the cards already carry; any other
 *  limits nothing yet rather than showing the wrong list's marks. */
export function pendingRule(key: string): BanRule {
  const choice = parseBanlistKey(key);
  if (choice?.kind === "none") return NO_RULE;
  if (!choice || (choice.kind === "md" && !choice.day)) return TODAY_MD;
  return { format: choice.kind === "custom" ? "md" : choice.kind, limits: {}, releasedBy: null };
}

/** A card's 금제 under the rule, "" when it is free. */
export const banOf = (card: Pick<CardListItem, "id" | "ban">, rule: BanRule = TODAY_MD): BanLimit | "" =>
  rule.limits ? rule.limits[card.id] ?? "" : card.ban;

/** Whether a card wears 미출시 under the rule for not being in Master Duel (CardListItem.unreleased): only under
 *  Master Duel's own rule — another game's rule judges a card by that game's release days (notOut) and limits it like
 *  any other (엘리스 2026-10-17). */
export const unreleasedUnder = (card: Pick<CardListItem, "unreleased">, rule: BanRule = TODAY_MD) =>
  rule.format === "md" && !!card.unreleased;

/** Whether a card was not out yet in the rule's game by its day (미출시); one whose days aren't known is taken as out. */
export function notOut(card: Pick<CardListItem, "released">, rule: BanRule) {
  if (rule.format === null || rule.releasedBy === null) return false;
  const day = card.released?.[rule.format];
  if (day === undefined) return false;
  return day === null || (day !== true && day > rule.releasedBy);
}
