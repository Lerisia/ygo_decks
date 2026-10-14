const INITIALS = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ",
  "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

// Compound (겹받침) jamo produced when two consonants are typed in a row
// without a vowel, e.g. ㄹ+ㅌ → ㄾ. Expanded back to their components so
// "ㅋㄾ" is searched as "ㅋㄹㅌ".
const COMPOUND_JAMO: Record<string, string> = {
  "ㄳ": "ㄱㅅ", "ㄵ": "ㄴㅈ", "ㄶ": "ㄴㅎ", "ㄺ": "ㄹㄱ", "ㄻ": "ㄹㅁ",
  "ㄼ": "ㄹㅂ", "ㄽ": "ㄹㅅ", "ㄾ": "ㄹㅌ", "ㄿ": "ㄹㅍ", "ㅀ": "ㄹㅎ", "ㅄ": "ㅂㅅ",
};

export const expandCompoundJamo = (text: string): string =>
  Array.from(text).map((ch) => COMPOUND_JAMO[ch] ?? ch).join("");

export const isInitialsOnly = (text: string): boolean => /^[ㄱ-ㅎ]+$/.test(text);

/** Initial consonants of each Hangul syllable; bare initials pass through, everything else is dropped. */
export const getInitials = (text: string): string =>
  Array.from(text)
    .map((char) => {
      const code = char.charCodeAt(0) - 44032;
      if (code >= 0 && code <= 11171) return INITIALS[Math.floor(code / 588)];
      if (INITIALS.includes(char)) return char;
      return "";
    })
    .join("");

/** Does `text` (or any alias) start with the given initials query, after expanding compound jamo? */
export const matchesInitials = (query: string, text: string, aliases: string[] = []): boolean => {
  const q = expandCompoundJamo(query);
  return [text, ...aliases].some((t) => getInitials(t).startsWith(q));
};


const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Deck-select search: chosung when the query is bare consonants, otherwise a
 *  space- and case-insensitive substring match over the name and aliases. */
export const matchesDeckQuery = (query: string, label: string, aliases: string[] = []): boolean => {
  const compact = squash(query);
  if (!compact) return true;
  if (isInitialsOnly(compact)) {
    return matchesInitials(compact, label.toLowerCase(), aliases.map((a) => a.toLowerCase()));
  }
  return [label, ...aliases].some((t) => squash(t).includes(compact));
};

const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ", "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ",
  "ㅡ", "ㅡㅣ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ",
  "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const COMPOUND_VOWELS: Record<string, string> = { "ㅘ": "ㅗㅏ", "ㅙ": "ㅗㅐ", "ㅚ": "ㅗㅣ", "ㅝ": "ㅜㅓ", "ㅞ": "ㅜㅔ", "ㅟ": "ㅜㅣ", "ㅢ": "ㅡㅣ" };

/** Hangul as single jamo, compound vowels and 받침 split too (괜 → ㄱㅗㅐㄴ): a word half typed on a Korean keyboard
 *  ("블ㄹ", "맺" on the way to 블랙, 매지) is then part of the word it becomes. */
export const toJamo = (text: string): string =>
  Array.from(text)
    .map((ch) => {
      const code = ch.charCodeAt(0) - 44032;
      if (code >= 0 && code <= 11171) return INITIALS[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28];
      return COMPOUND_JAMO[ch] ?? COMPOUND_VOWELS[ch] ?? ch;
    })
    .join("");

export type NameKeys = { jamo: string; initials: string };

/** A name made ready for makeMatcher, once. */
export const nameKeys = (name: string): NameKeys => {
  const s = squash(name);
  return { jamo: toJamo(s), initials: getInitials(s) };
};

/** How closely a name answers a query, for ordering what makeMatcher kept: 0 the whole name, 1 its start, 2 anywhere
 *  (bare consonants are held against the name's initials). */
export const matchRank = (query: string): ((keys: NameKeys) => 0 | 1 | 2) => {
  const q = squash(query);
  if (isInitialsOnly(q)) {
    const initials = expandCompoundJamo(q);
    return (k) => (k.initials === initials ? 0 : k.initials.startsWith(initials) ? 1 : 2);
  }
  const jamo = toJamo(q);
  return (k) => (k.jamo === jamo ? 0 : k.jamo.startsWith(jamo) ? 1 : 2);
};

/** One query's test over many names (the 카드군 dropdown, 엘리스 2026-10-12): bare consonants match the names'
 *  initials from the start, anything else matches as jamo, so the list holds steady while a syllable is being
 *  composed instead of emptying at "블ㄹ" and filling again at "블랙". */
export const makeMatcher = (query: string): ((keys: NameKeys) => boolean) => {
  const q = squash(query);
  if (!q) return () => true;
  if (isInitialsOnly(q)) {
    const initials = expandCompoundJamo(q);
    return (k) => k.initials.startsWith(initials);
  }
  const jamo = toJamo(q);
  return (k) => k.jamo.includes(jamo);
};
