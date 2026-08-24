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
