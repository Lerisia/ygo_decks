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

// What each deck power tier means, shown under the bar for the tier under the cursor or the one just chosen
// (특이점 2026-10-11).
export const STRENGTH_NOTES = [
  "현재 기준으로 마스터 듀얼에서 맹활약중인, 가장 강력한 최상위 티어 덱",
  "티어 덱만큼은 아니지만, 분명한 강점이 존재해 티어 게임에서 고를 가치가 있는 덱",
  "티어 게임에서는 다소 사용하기 힘들지만, 강점이 뚜렷하고 준수한 성능을 보여주는 덱",
  "체급이 다소 부족하지만, 무난하고 자신만의 개성이 존재하는 덱",
  "덱 파워가 약하여 개인적인 애정이 없다면 플레이하기 어려운 덱",
  "사용에 도전 정신이 필요할 정도로 매우 약한 덱",
];

// Difficulty on a bar too (특이점 2026-10-15): 0=쉬움 … 2=어려움, two neighbouring ones may be chosen together.
export const DIFFICULTY_TIERS = ["쉬움", "보통", "어려움"];

/** Answer value for the chosen tiers of a bar with `last` the rightmost; the whole bar is the same as 상관 없음. */
export const rangeValue = (lo: number, hi: number, last: number): string | null =>
  lo === 0 && hi === last ? null : `${lo}-${hi}`;
export const strengthRangeValue = (lo: number, hi: number): string | null => rangeValue(lo, hi, LAST_TIER);

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
