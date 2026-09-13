using System.Text.Json;
using System.Text.Json.Serialization;

namespace MdTracker;

public sealed class Config
{
    public string ServerUrl { get; set; } = "https://ygodecks.com";
    public string? Token { get; set; }
    public string? Email { get; set; }
    /// Locally tracked ranked win gauge (the game only reports promotions/demotions at low ranks).
    public Gauge? Gauge { get; set; }
}

public sealed class Gauge
{
    public int Rank { get; set; }
    public int Tier { get; set; }
    public int Wins { get; set; }
}

public sealed class PendingUploadResponse
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("suggested_deck")] public JsonElement? SuggestedDeck { get; set; }
    [JsonPropertyName("suggested_opp_deck")] public JsonElement? SuggestedOppDeck { get; set; }
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
    [JsonPropertyName("error")] public JsonElement? Error { get; set; }
}

/// One duel captured from memory, waiting for the user's confirmation in the UI.
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
    public string? RankCode { get; set; }
    public int? Wins { get; set; }              // site's tier win gauge after this match (-4 demotion … 5 promotion)
    public bool WinsEstimated { get; set; }     // true when computed locally rather than read from the game
    public string? RawDuelResult { get; set; }  // $.DuelResult as captured (kept locally for schema research)
    public double? RatingBefore { get; set; }
    public double? RatingAfter { get; set; }
    public int Turn { get; set; }
    public string? MyMdDeckId { get; set; }
    public List<int> MyCards { get; set; } = new();
    public List<int> OppCards { get; set; } = new();
    public string Status { get; set; } = "captured";  // captured / uploaded / failed
    public int? ServerId { get; set; }
    public string? SuggestedDeckName { get; set; }
    public string? SuggestedOppDeckName { get; set; }
    public string? Error { get; set; }
}





[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = true)]
[JsonSerializable(typeof(Config))]
[JsonSerializable(typeof(Gauge))]
[JsonSerializable(typeof(PendingUploadResponse))]
[JsonSerializable(typeof(TokenResponse))]
[JsonSerializable(typeof(AddMatchResponse))]
[JsonSerializable(typeof(PendingMatch))]
[JsonSerializable(typeof(List<PendingMatch>))]
public partial class J : JsonSerializerContext { }
