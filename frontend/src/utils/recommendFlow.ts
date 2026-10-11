// Pure rules of the tendency-test flow, shared by QuestionPage and its tests.

export type Question = {
  key: string;
  question: string;
  options: { value: number; label: string }[];
};
export type Answer = { key: string; value: number | string | null };
/** Per question key, the option values that still leave >= 1 candidate deck. */
export type Available = Record<string, number[]>;

const INDIFFERENT_LABEL = "상관 없음";

export const buildAnswerKey = (answers: Answer[]): string => {
  const pairs = answers.filter((a) => a.value !== null && a.value !== undefined).map((a) => `${a.key}=${a.value}`);
  return pairs.length ? pairs.sort().join("|") : "empty";
};

export const visibleOptions = (question: Question, available: Available | null) => {
  if (!available) return [];
  const viable = available[question.key] ?? [];
  let options = question.options.filter((o) => o.value === null || o.value === undefined || viable.includes(o.value));
  // A question with one real choice plus 상관 없음 is effectively decided.
  if (options.length === 2) options = options.filter((o) => o.label !== INDIFFERENT_LABEL);
  return options;
};

export const hiddenOptionalCount = (optional: Question[], answers: Answer[], available: Available | null): number =>
  optional.filter((q) => !answers.some((a) => a.key === q.key) && visibleOptions(q, available).length <= 1).length;

export const isFinished = ({ answered, hidden, total, candidateCount }:
  { answered: number; hidden: number; total: number; candidateCount: number }): boolean => {
  if (candidateCount === 0) return false;
  return candidateCount === 1 || answered + hidden >= total;
};

// Deck power bar (특이점 2026-10-11): tiers 0=최상위 … 5=최하위 from left to right; two points mark the range.
export const STRENGTH_TIERS = ["최상위", "상위", "중상위", "중하위", "하위", "최하위"];
const LAST_TIER = STRENGTH_TIERS.length - 1;

/** Answer value for the chosen tiers; the whole bar is the same as 상관 없음. */
export const strengthRangeValue = (lo: number, hi: number): string | null =>
  lo === 0 && hi === LAST_TIER ? null : `${lo}-${hi}`;

export const countInRange = (counts: number[], lo: number, hi: number): number =>
  counts.slice(lo, hi + 1).reduce((sum, n) => sum + n, 0);

/** Which point a press at `step` takes hold of: the nearer one (ties go to the strong end). */
export const pickHandle = (step: number, lo: number, hi: number): "lo" | "hi" => {
  if (step <= lo) return "lo";
  if (step >= hi) return "hi";
  return step - lo <= hi - step ? "lo" : "hi";
};

/** Move one point to `step`, stopping where the other point is. */
export const moveHandle = (handle: "lo" | "hi", step: number, lo: number, hi: number): [number, number] =>
  handle === "lo" ? [Math.min(step, hi), hi] : [lo, Math.max(step, lo)];
