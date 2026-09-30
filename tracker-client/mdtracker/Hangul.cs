namespace MdTracker;

/// Deck search, a line-by-line port of the site's frontend/src/utils/hangul.ts (matchesDeckQuery).
/// Both are tested against frontend/src/utils/deckSearchCases.json; change them together.
internal static class Hangul
{
    private const string Initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

    // Compound (겹받침) jamo produced when two consonants are typed in a row without a vowel, e.g. ㄹ+ㅌ → ㄾ.
    private static readonly Dictionary<char, string> CompoundJamo = new()
    {
        ['ㄳ'] = "ㄱㅅ", ['ㄵ'] = "ㄴㅈ", ['ㄶ'] = "ㄴㅎ", ['ㄺ'] = "ㄹㄱ", ['ㄻ'] = "ㄹㅁ",
        ['ㄼ'] = "ㄹㅂ", ['ㄽ'] = "ㄹㅅ", ['ㄾ'] = "ㄹㅌ", ['ㄿ'] = "ㄹㅍ", ['ㅀ'] = "ㄹㅎ", ['ㅄ'] = "ㅂㅅ",
    };

    public static string ExpandCompoundJamo(string text) =>
        string.Concat(text.Select(c => CompoundJamo.TryGetValue(c, out var s) ? s : c.ToString()));

    public static bool IsInitialsOnly(string text) => text.Length > 0 && text.All(c => c >= 'ㄱ' && c <= 'ㅎ');

    /// Initial consonants of each Hangul syllable; bare initials pass through, everything else is dropped.
    public static string GetInitials(string text)
    {
        var sb = new System.Text.StringBuilder(text.Length);
        foreach (var c in text)
        {
            int code = c - '가';
            if (code >= 0 && code <= 11171) sb.Append(Initials[code / 588]);
            else if (Initials.Contains(c)) sb.Append(c);
        }
        return sb.ToString();
    }

    public static bool MatchesInitials(string query, string text, IEnumerable<string> aliases)
    {
        var q = ExpandCompoundJamo(query);
        return aliases.Prepend(text).Any(t => GetInitials(t).StartsWith(q, StringComparison.Ordinal));
    }

    private static string Squash(string s) => string.Concat(s.ToLowerInvariant().Where(c => !char.IsWhiteSpace(c)));

    /// Chosung when the query is bare consonants, otherwise a space- and case-insensitive substring match over name and aliases.
    public static bool Matches(string query, string name, IEnumerable<string> aliases)
    {
        var compact = Squash(query);
        if (compact.Length == 0) return true;
        var all = aliases.ToList();
        if (IsInitialsOnly(compact))
            return MatchesInitials(compact, name.ToLowerInvariant(), all.Select(a => a.ToLowerInvariant()));
        return all.Prepend(name).Any(t => Squash(t).Contains(compact, StringComparison.Ordinal));
    }
}
