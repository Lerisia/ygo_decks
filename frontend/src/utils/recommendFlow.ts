// Pure rules of the tendency-test flow, shared by QuestionPage and its tests.

export type Question = {
  key: string;
  question: string;
  options: { value: number; label: string }[];
};
export type Answer = { key: string; value: number | null };
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
