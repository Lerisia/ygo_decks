namespace MdTracker;

/// Master Duel ranked ladder rules, mirrored from the site's frontend utils/rankUtils.ts.
/// A record's `wins` is the gauge after its duel. The game itself gives the rank and the gauge from 0 up
/// (Gauge); the rules only fill in what it does not show, the demotion count below 0 (Settle), or stand in
/// when the game's ladder data could not be read at all (NextState).
internal static class RankRules
{
    public static readonly string[] Order =
    {
        "rookie2", "rookie1",
        "bronze5", "bronze4", "bronze3", "bronze2", "bronze1",
        "silver5", "silver4", "silver3", "silver2", "silver1",
        "gold5", "gold4", "gold3", "gold2", "gold1",
        "platinum5", "platinum4", "platinum3", "platinum2", "platinum1",
        "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
        "master5", "master4", "master3", "master2", "master1",
    };

    static string Upper(string r) { int i = Array.IndexOf(Order, r); return i < 0 || i == Order.Length - 1 ? r : Order[i + 1]; }
    static string Lower(string r) { int i = Array.IndexOf(Order, r); return i <= 0 ? r : Order[i - 1]; }
    static string Tier(string r) => new string(r.Where(c => !char.IsDigit(c)).ToArray());

    public static (string rank, int? wins) NextState(string rank, int? currentWins, string result)
    {
        var tier = Tier(rank); int w = currentWins ?? 0; bool win = result == "win";
        if (rank == "master1") return (rank, null);
        if (result != "win" && result != "lose") return (rank, ValidWins(rank).Contains(w) ? w : 0);   // a draw moves nothing
        if (tier is "rookie" or "bronze") return win ? (Upper(rank), 0) : (rank, 0);
        if (tier == "silver") return win ? (w + 1 >= 2 ? (Upper(rank), 0) : (rank, w + 1)) : (rank, w);
        if (tier == "gold") return win ? (w + 1 >= 4 ? (Upper(rank), 0) : (rank, w + 1)) : (rank, w);
        if (tier == "platinum")
        {
            if (win) { int n = w < 0 ? 1 : w + 1; return n >= 4 ? (Upper(rank), 0) : (rank, n); }
            if (rank == "platinum5") return (rank, Math.Max(0, w - 1));
            return w <= -3 ? (Lower(rank), 0) : (rank, w - 1);
        }
        if (tier == "diamond")
        {
            if (win) { int n = w < 0 ? 1 : w + 1; return n >= 4 ? (Upper(rank), 0) : (rank, n); }
            if (rank == "diamond5") return (rank, Math.Max(0, w - 1));
            return w <= -2 ? (Lower(rank), 0) : (rank, w - 1);
        }
        if (tier == "master")
        {
            if (win) { int n = w < 0 ? 1 : w + 1; return n >= 5 ? (Upper(rank), 0) : (rank, n); }
            if (rank == "master5") return (rank, Math.Max(0, w - 1));
            return w <= -2 ? (Lower(rank), 0) : (rank, w - 1);
        }
        return (rank, w);
    }

    public static int[] ValidWins(string? rank)
    {
        if (string.IsNullOrEmpty(rank)) return Array.Empty<int>();
        var tier = Tier(rank);
        return tier switch
        {
            "rookie" or "bronze" => new[] { 0 },
            "silver" => new[] { 0, 1 },
            "gold" => new[] { 0, 1, 2, 3 },
            "platinum" => rank == "platinum5" ? new[] { 0, 1, 2, 3 } : new[] { -3, -2, -1, 0, 1, 2, 3 },
            "diamond" => rank == "diamond5" ? new[] { 0, 1, 2, 3 } : new[] { -2, -1, 0, 1, 2, 3 },
            "master" => rank == "master1" ? Array.Empty<int>() : rank == "master5" ? new[] { 0, 1, 2, 3, 4 } : new[] { -2, -1, 0, 1, 2, 3, 4 },
            _ => Array.Empty<int>(),
        };
    }

    /// The gauge at `rank` when the game says `require` more wins promote; null for a rank without one. Anything
    /// at or below 0 reads as 0: the game keeps the demotion count to itself.
    public static int? Gauge(string? rank, int require)
    {
        var valid = ValidWins(rank);
        return valid.Length == 0 ? null : Math.Clamp(valid.Max() + 1 - require, 0, valid.Max());
    }

    /// The gauge to record after a duel the game reported on. `seenBefore`/`seenAfter` are what the game showed
    /// going in and coming out, `believed` what we carried over from this account's last duel at this rank (null
    /// when there is none). Only a 0 at a rank that can demote needs more than the game's word: it means "0 or
    /// below", and the count below 0 is ours to keep.
    public static (int? wins, bool estimated) Settle(string rankBefore, string rankAfter, int? believed, int? seenBefore, int? seenAfter, string result)
    {
        var valid = ValidWins(rankAfter);
        if (valid.Length == 0 || seenAfter is not int after) return (null, false);
        after = Math.Clamp(after, 0, valid.Max());
        if (after > 0 || rankAfter != rankBefore || valid.Min() == 0) return (after, false);
        int? before = believed is int bv ? Math.Clamp(bv, valid.Min(), valid.Max()) : null;
        if (seenBefore is int sb)
        {
            if (sb > 0) before = sb;                              // exact above 0
            else if (before is null or > 0) before = 0;          // duels we never saw brought it down, to 0 at least
        }
        if (before is not int b || b > 0) return (0, false);
        if (result != "lose") return (b, b < 0);                 // a draw moves nothing
        return (Math.Max(valid.Min(), b - 1), true);             // at the floor already: the game kept the rank, so it sits there
    }
}
