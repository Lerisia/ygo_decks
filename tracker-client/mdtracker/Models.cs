using System.Text.Json;
using System.Text.Json.Serialization;

namespace MdTracker;

public sealed class Config
{
    public string ServerUrl { get; set; } = "https://ygodecks.com";
    public string? Token { get; set; }
    public string? Email { get; set; }
    public int? RecordGroupId { get; set; }
    public string? RecordGroupName { get; set; }
    /// Master Duel deck id → site deck id, remembered after the first save.
    public Dictionary<string, int> DeckMap { get; set; } = new();
    /// Seconds the overlay waits before saving with the suggested values.
    public int OverlaySeconds { get; set; } = 20;
    public bool ShowedFullscreenTip { get; set; }
    /// Registered in HKCU Run so the tracker is already in the tray when the game starts.
    public bool StartWithWindows { get; set; }
    /// Side panel during the duel (opponent deck read, matchup record, turn clock, revealed cards).
    public bool LivePanel { get; set; } = true;
    /// Locally tracked ranked win gauge (the game only reports promotions/demotions at low ranks).
    public Gauge? Gauge { get; set; }
}

public sealed class Gauge
{
    public int Rank { get; set; }
    public int Tier { get; set; }
    public int Wins { get; set; }
}

public sealed class DeckCandidate
{
    [JsonPropertyName("deck_id")] public int DeckId { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("score")] public double Score { get; set; }
    [JsonPropertyName("share")] public double Share { get; set; }
}

public sealed class CardInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("count")] public int Count { get; set; }
}

public sealed class InferSide
{
    [JsonPropertyName("candidates")] public List<DeckCandidate> Candidates { get; set; } = new();
    [JsonPropertyName("unknown_ids")] public List<int> UnknownIds { get; set; } = new();
    [JsonPropertyName("cards")] public List<CardInfo> Cards { get; set; } = new();
}

public sealed class InferResponse
{
    [JsonPropertyName("my")] public InferSide My { get; set; } = new();
    [JsonPropertyName("opp")] public InferSide Opp { get; set; } = new();
}

public sealed class SiteDeck
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("aliases")] public List<string> Aliases { get; set; } = new();
    public override string ToString() => Name;
}

public sealed class DecksResponse
{
    [JsonPropertyName("decks")] public List<SiteDeck> Decks { get; set; } = new();
}

public sealed class RecordGroup
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    public override string ToString() => Name;
}

public sealed class TokenResponse
{
    [JsonPropertyName("access")] public string? Access { get; set; }
    [JsonPropertyName("refresh")] public string? Refresh { get; set; }
    [JsonPropertyName("detail")] public string? Detail { get; set; }
}

public sealed class AddMatchResponse
{
    [JsonPropertyName("match_id")] public int? MatchId { get; set; }
    [JsonPropertyName("points_added")] public int PointsAdded { get; set; }
    [JsonPropertyName("error")] public JsonElement? Error { get; set; }
}

public sealed class VersionResponse
{
    [JsonPropertyName("latest")] public string Latest { get; set; } = "";
    [JsonPropertyName("min_supported")] public string MinSupported { get; set; } = "";
    [JsonPropertyName("url")] public string Url { get; set; } = "";
}

public sealed class StatBlock
{
    [JsonPropertyName("games")] public int Games { get; set; }
    [JsonPropertyName("wins")] public int Wins { get; set; }
    [JsonPropertyName("win_rate")] public double? WinRate { get; set; }
}

public sealed class MatchupResponse
{
    [JsonPropertyName("deck")] public string? Deck { get; set; }
    [JsonPropertyName("opponent")] public string? Opponent { get; set; }
    [JsonPropertyName("total")] public StatBlock? Total { get; set; }
    [JsonPropertyName("matchup")] public StatBlock? Matchup { get; set; }
    [JsonPropertyName("first")] public StatBlock? First { get; set; }
    [JsonPropertyName("second")] public StatBlock? Second { get; set; }
}

public sealed class RankSpan
{
    [JsonPropertyName("from")] public string? From { get; set; }
    [JsonPropertyName("to")] public string? To { get; set; }
}

public sealed class RatingSpan
{
    [JsonPropertyName("from")] public double? From { get; set; }
    [JsonPropertyName("to")] public double? To { get; set; }
}

public sealed class TodayResponse
{
    [JsonPropertyName("games")] public int Games { get; set; }
    [JsonPropertyName("wins")] public int Wins { get; set; }
    [JsonPropertyName("losses")] public int Losses { get; set; }
    [JsonPropertyName("win_rate")] public double? WinRate { get; set; }
    [JsonPropertyName("coin_win_rate")] public double? CoinWinRate { get; set; }
    [JsonPropertyName("first")] public StatBlock? First { get; set; }
    [JsonPropertyName("second")] public StatBlock? Second { get; set; }
    [JsonPropertyName("avg_turns")] public double? AvgTurns { get; set; }
    [JsonPropertyName("rank")] public RankSpan? Rank { get; set; }
    [JsonPropertyName("rating")] public RatingSpan? Rating { get; set; }
}

public sealed class PendingUploadResponse
{
    [JsonPropertyName("id")] public int Id { get; set; }
}

public sealed class OppCard
{
    public int Id { get; set; }
    public int Pos { get; set; }
    public bool Face { get; set; }
}

/// What the poll sees mid-duel (not persisted).
public sealed class LiveTick
{
    public int Turn { get; set; }
    public bool TurnMe { get; set; }
    public int TurnElapsed { get; set; }
    public List<int> OppCards { get; set; } = new();
}

/// Mid-duel state for the side panel: the poll fills the clock, background lookups fill the rest.
public sealed class LiveDuel
{
    public string OppName { get; set; } = "";
    public int Turn { get; set; }
    public bool TurnMe { get; set; }
    public int TurnElapsed { get; set; }
    public int MySec { get; set; }
    public int OppSec { get; set; }
    public List<int> OppCards { get; set; } = new();
    public List<DeckCandidate> OppCandidates { get; set; } = new();
    public List<CardInfo> OppCardNames { get; set; } = new();
    public int? MatchupOppId { get; set; }
    public string? MatchupText { get; set; }
}

/// Wall-clock seconds one turn took, as seen by the 0.5s poll.
public sealed class TurnTime
{
    public int Turn { get; set; }
    public bool Me { get; set; }
    public int Sec { get; set; }
}

/// One duel captured from memory.
public sealed class PendingMatch
{
    public string Did { get; set; } = "";
    public string StartedAt { get; set; } = "";
    public string EndedAt { get; set; } = "";
    public int GameMode { get; set; }
    public string GameModeName { get; set; } = "";
    public string Result { get; set; } = "";        // win / lose / draw
    public string Finish { get; set; } = "";
    public bool CoinWin { get; set; }
    public bool First { get; set; }
    public int MyId { get; set; }
    public string MyName { get; set; } = "";
    public string OppName { get; set; } = "";
    public int? RankBefore { get; set; }
    public int? TierBefore { get; set; }
    public int? RankAfter { get; set; }
    public int? TierAfter { get; set; }
    public string? RankCode { get; set; }       // post-game rank code (site convention)
    public int? Wins { get; set; }              // post-game gauge (site convention)
    public bool WinsEstimated { get; set; }
    public string? RawDuelResult { get; set; }  // $.DuelResult as captured (kept locally for schema research)
    public double? RatingBefore { get; set; }
    public double? RatingAfter { get; set; }
    public int Turn { get; set; }
    public string? MyMdDeckId { get; set; }
    public List<int> MyCards { get; set; } = new();
    public List<int> OppCards { get; set; } = new();
    public List<OppCard> OppCardDetails { get; set; } = new();
    public List<TurnTime> TurnTimes { get; set; } = new();
    public int MySec { get; set; }
    public int OppSec { get; set; }
    public bool GameUploaded { get; set; }      // raw capture archived on the site (/api/tracker/games/)
    public List<DeckCandidate> MyCandidates { get; set; } = new();
    public List<DeckCandidate> OppCandidates { get; set; } = new();
    public List<CardInfo> MyCardNames { get; set; } = new();
    public List<CardInfo> OppCardNames { get; set; } = new();
    public int? SuggestedMyDeckId { get; set; }
    public int? SuggestedOppDeckId { get; set; }
    public string Status { get; set; } = "captured";  // captured / saved / pending / failed / discarded
    public int? MatchId { get; set; }
    public string? Error { get; set; }
    public string? SavedDeckName { get; set; }
    public string? SavedOppDeckName { get; set; }
    public string? Notes { get; set; }
    public int PointsAdded { get; set; }
    public bool IsDemo { get; set; }   // preview: never saved, never sent
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = true)]
[JsonSerializable(typeof(Config))]
[JsonSerializable(typeof(Gauge))]
[JsonSerializable(typeof(InferResponse))]
[JsonSerializable(typeof(DecksResponse))]
[JsonSerializable(typeof(List<RecordGroup>))]
[JsonSerializable(typeof(RecordGroup))]
[JsonSerializable(typeof(TokenResponse))]
[JsonSerializable(typeof(AddMatchResponse))]
[JsonSerializable(typeof(PendingUploadResponse))]
[JsonSerializable(typeof(VersionResponse))]
[JsonSerializable(typeof(MatchupResponse))]
[JsonSerializable(typeof(TodayResponse))]
[JsonSerializable(typeof(PendingMatch))]
[JsonSerializable(typeof(OppCard))]
[JsonSerializable(typeof(TurnTime))]
public partial class J : JsonSerializerContext { }
