namespace MdTracker;

/// Deck search like the site: substring on name/aliases, or Hangul initial consonants when the query is all consonants.
internal static class Hangul
{
    private const string Cho = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

    private static bool IsConsonant(char c) => c >= 'ㄱ' && c <= 'ㅎ';

    public static string Initials(string s)
    {
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var c in s)
        {
            if (c >= '가' && c <= '힣') sb.Append(Cho[(c - '가') / 588]);
            else if (!char.IsWhiteSpace(c)) sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    public static bool Matches(string query, string name, IEnumerable<string> aliases)
    {
        query = query.Trim();
        if (query.Length == 0) return true;
        var q = query.Replace(" ", "").ToLowerInvariant();
        var names = new List<string> { name }; names.AddRange(aliases);
        if (q.All(IsConsonant))
            return names.Any(n => Initials(n).Contains(q));
        return names.Any(n => n.Replace(" ", "").ToLowerInvariant().Contains(q));
    }
}
