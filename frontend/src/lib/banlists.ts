/** The 금제 a deck list is checked by (참혈 2026-10-16): Master Duel's, the OCG's or the TCG's — its newest, which a deck
 *  following it moves on with when the next one comes, or one list held to by its day — or one of ours by its code
 *  (커스텀, none yet). Kept with the deck as a key, as the server reads it (carddb/banlist.py parse_key): "md",
 *  "md:2026-10-06", "ocg", "custom:<code>". */
import type { CardListItem } from "@/api/cardDexApi";

export type BanFormat = "md" | "ocg" | "tcg";
export type BanKind = BanFormat | "custom";
export type BanLimit = "forbidden" | "limited" | "semi_limited";
export type BanChoice = { kind: BanFormat; day: string | null } | { kind: "custom"; code: string };

export const DEFAULT_BANLIST = "md";
export const BAN_KINDS: { kind: BanKind; label: string }[] = [
  { kind: "md", label: "마스터 듀얼" }, { kind: "ocg", label: "OCG" }, { kind: "tcg", label: "TCG" }, { kind: "custom", label: "커스텀" },
];
const KIND_LABEL = Object.fromEntries(BAN_KINDS.map((k) => [k.kind, k.label])) as Record<BanKind, string>;
const FOLLOWS = "새 금제가 나오면 따라갑니다";

const KEY_RE = /^(md|ocg|tcg)(?::(\d{4}-\d\d-\d\d))?$|^custom:([A-Za-z0-9_-]{1,32})$/;
export const isCode = (code: string) => /^[A-Za-z0-9_-]{1,32}$/.test(code);

export function parseBanlistKey(key: string | null | undefined): BanChoice | null {
  const m = key ? KEY_RE.exec(key) : null;
  if (!m) return null;
  return m[3] ? { kind: "custom", code: m[3] } : { kind: m[1] as BanFormat, day: m[2] ?? null };
}

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

/** label: in the open list; shown: in the closed box. */
export type BanOption = { value: string; label: string; shown: string; title: string };

/** A game's choices: 최신 first — 「최신」 closed, with its newest list's day in the open list, so the list says which one
 *  is in effect (참혈 2026-10-16) —, then each list by day, newest first. */
export function banlistOptions(format: BanFormat, index: BanlistIndex | null): BanOption[] {
  const latest = index && latestDay(index, format);
  const days = index?.lists[format] ?? [];
  return [
    latest
      ? { value: format, label: `최신 (${dayLabel(format, latest, days)})`, shown: "최신", title: `${fullDay(latest)} · ${FOLLOWS}` }
      : { value: format, label: "최신", shown: "최신", title: FOLLOWS },
    ...days.map((day) => {
      const label = dayLabel(format, day, days);
      return { value: `${format}:${day}`, label, shown: label, title: fullDay(day) };
    }),
  ];
}

// a deck's page names the game as the picker does (참혈 2026-10-16)
const PAGE_LABEL = KIND_LABEL;

/** A deck's list for its page (참혈 2026-10-16): "마스터 듀얼 • 최신" — the newest with no day —,
 *  "마스터 듀얼 • 2026.07.01", "OCG • 2026.01" (by month as the picker has it). */
export function banlistName(key: string, index: BanlistIndex | null) {
  const choice = parseBanlistKey(key) ?? { kind: "md" as const, day: null };
  if (choice.kind === "custom") return `${PAGE_LABEL.custom} • ${choice.code}`;
  if (!choice.day) return `${PAGE_LABEL[choice.kind]} • 최신`;
  const label = dayLabel(choice.kind, choice.day, index?.lists[choice.kind]);
  return `${PAGE_LABEL[choice.kind]} • ${choice.day.slice(0, 2)}${label}`;
}

/** Its title: the list's whole day, the newest's too. */
export function banlistTitle(key: string, index: BanlistIndex | null) {
  const choice = parseBanlistKey(key) ?? { kind: "md" as const, day: null };
  if (choice.kind === "custom") return "";
  if (choice.day) return fullDay(choice.day);
  const latest = index && latestDay(index, choice.kind);
  return latest ? `${fullDay(latest)} · ${FOLLOWS}` : FOLLOWS;
}

/** A list as the server sends it (/api/banlists/<game>/<day or latest>/): the cards it limits, and the day a card
 *  must be out by — the list's own, today for the newest. */
export type BanTable = {
  format: BanFormat; code?: string; day: string | null; released_by: string; latest: boolean; today: string;
  limits: Record<string, BanLimit>;
};

/** What a deck's cards are judged by: the cards its list limits (null: today's Master Duel list as each card carries
 *  it, CardListItem.ban, until the table comes), its game, and the day a card must be out by (null: not known yet,
 *  so none is 미출시). */
export type BanRule = { format: BanFormat; limits: Record<string, BanLimit> | null; releasedBy: string | null };

export const TODAY_MD: BanRule = { format: "md", limits: null, releasedBy: null };

export const ruleOf = (t: BanTable): BanRule => ({ format: t.format, limits: t.limits, releasedBy: t.released_by });

/** The rule while a list's table is on its way: Master Duel's newest is what the cards already carry; any other
 *  limits nothing yet rather than showing the wrong list's marks. */
export function pendingRule(key: string): BanRule {
  const choice = parseBanlistKey(key);
  if (!choice || (choice.kind === "md" && !choice.day)) return TODAY_MD;
  return { format: choice.kind === "custom" ? "md" : choice.kind, limits: {}, releasedBy: null };
}

/** A card's 금제 under the rule, "" when it is free. */
export const banOf = (card: Pick<CardListItem, "id" | "ban">, rule: BanRule = TODAY_MD): BanLimit | "" =>
  rule.limits ? rule.limits[card.id] ?? "" : card.ban;

/** Whether a card was not out yet in the rule's game by its day (미출시); one whose days aren't known is taken as out. */
export function notOut(card: Pick<CardListItem, "released">, rule: BanRule) {
  const day = card.released?.[rule.format];
  if (day === undefined || rule.releasedBy === null) return false;
  return day === null || (day !== true && day > rule.releasedBy);
}
