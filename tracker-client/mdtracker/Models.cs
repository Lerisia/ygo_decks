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
    /// Side panel during the duel (kept for configs written before OverlayMode existed).
    public bool LivePanel { get; set; } = true;
    /// What is drawn over the game: 0 nothing, 1 record only (idle card + deck read/record lines), 2 everything
    /// (card lists by zone, opponent clock estimate, cursor pop-ups). -1 = not set yet → derived from LivePanel.
    public int OverlayMode { get; set; } = -1;
    public int EffectiveOverlayMode => OverlayMode >= 0 ? OverlayMode : (LivePanel ? 2 : 0);
    /// Sound when my clock starts running (a choice opens or my turn begins) while the game is not the front window.
    public bool AlertMyTurn { get; set; }
    /// Upload per-duel research samples (clock, card table, reveals) to the site. Off by default; set in config.json.
    public bool ResearchFeed { get; set; }
    /// Fetch a newer build in the background and swap it in between duels.
    public bool AutoUpdate { get; set; } = true;
    /// Size of everything drawn over the game (1.0 = as designed).
    public double OverlayScale { get; set; } = 1.2;
    public int OverlayScaleVersion { get; set; }   // 2: the 1.0/1.2/1.4/1.6 steps; missing = a 0.6.0 config
    /// Where the person dragged the overlays, as offsets from the game window's top-left (null = default spot).
    public double? LiveCardX { get; set; }
    public double? LiveCardY { get; set; }
    public double LiveCardW { get; set; } = 240;
    public double? IdleCardX { get; set; }
    public double? IdleCardY { get; set; }
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
    [JsonPropertyName("frame")] public string Frame { get; set; } = "";   // effect / spell / trap / fusion / xyz / link / …
}

public sealed class InferSide
{
    [JsonPropertyName("candidates")] public List<DeckCandidate> Candidates { get; set; } = new();
    [JsonPropertyName("unknown_ids")] public List<int> UnknownIds { get; set; } = new();
    [JsonPropertyName("cards")] public List<CardInfo> Cards { get; set; } = new();
    /// alt-art id (as read from the game) → base id used by names and the decklist
    [JsonPropertyName("aliases")] public Dictionary<string, int> Aliases { get; set; } = new();
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

public sealed class TodayDeck
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("games")] public int Games { get; set; }
    [JsonPropertyName("wins")] public int Wins { get; set; }
    public override string ToString() => $"{Name} {Wins}승 {Games - Wins}패";
}

public sealed class TodayResponse
{
    /// "랭크 A → B" or "레이팅 X → Y". At Master 1 the rank cannot move, so the rating is the number that matters.
    public string? ProgressLine()
    {
        bool topOfLadder = Rank?.From == "master1" && Rank?.To == "master1";
        if (Rank?.From != null && !topOfLadder) return $"랭크 {OverlayWindow.RankLabel(Rank.From)} → {OverlayWindow.RankLabel(Rank.To)}";
        if (Rating?.To != null) return $"레이팅 {Rating.From:0.##} → {Rating.To:0.##}";
        if (Rank?.From != null) return $"랭크 {OverlayWindow.RankLabel(Rank.From)}";
        return null;
    }

    [JsonPropertyName("decks")] public List<TodayDeck> Decks { get; set; } = new();
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

/// One line in an overlay card list: thumbnail (by card id), name, count, frame type for the tint.
/// Count -1 = name only; Header = section title.
public record struct Row(int Id, string Text, int Count, bool Header = false, string Frame = "");

/// One card the engine knows about, with its zone (BindingDuelFieldCards.FieldPostion: 0-4 monster, 5-6 extra monster,
/// 7-11 spell/trap, 12 field, 13 hand, 14 extra deck, 15 deck, 16 graveyard, 17 banished).
public sealed class LiveCard
{
    public bool Me { get; set; }
    public int Zone { get; set; }
    public int Id { get; set; }
    public bool Face { get; set; }
    public int Uid { get; set; }   // the engine's per-card instance id — stable while the card stays in the duel
    public int Index { get; set; } // slot within the zone (nPos >> 16)
    public const int Hand = 13, ExtraDeck = 14, Deck = 15, Grave = 16, Banished = 17;
}

/// What the poll sees mid-duel (not persisted).
public sealed class LiveTick
{
    public int Turn { get; set; }
    public bool TurnMe { get; set; }
    public List<LiveCard> Cards { get; set; } = new();
    public bool HoverMe { get; set; }
    public int HoverZone { get; set; } = -1;   // FieldPostion code under the game cursor, -1 = none
    public int HoverIndex { get; set; }
    public int MySecLeft { get; set; }         // engine's own clock (bank)
    public int OppSecLeft { get; set; }        // estimate: the rules replayed, minus the time the opponent was deciding
    public List<LiveCard> ListCards { get; set; } = new();   // the open card-list window (reveals, confirms): id + owner/zone/slot, no uid
    public Dictionary<int, int> LogUids { get; set; } = new();   // the game log's uid → card id table
}

/// Mid-duel state for the side panel: the poll fills the clock and zones, background lookups fill names and decks.
public sealed class LiveDuel
{
    public string OppName { get; set; } = "";
    public int Turn { get; set; }
    public bool TurnMe { get; set; }
    public bool HoverMe { get; set; }
    public int HoverZone { get; set; } = -1;
    public int HoverIndex { get; set; }
    public int MySecLeft { get; set; }
    public int OppSecLeft { get; set; }
    public List<LiveCard> Cards { get; set; } = new();
    public List<CardInfo> MyDeckList { get; set; } = new();
    public HashSet<int> MyExtraIds { get; set; } = new();
    public Dictionary<int, string> Names { get; } = new();
    public Dictionary<int, string> Frames { get; } = new();
    public Dictionary<int, int> Aliases { get; } = new();
    public int Base(int id) => Aliases.TryGetValue(id, out var b) ? b : id;
    public List<DeckCandidate> OppCandidates { get; set; } = new();
    public int? MatchupOppId { get; set; }
    public string? MatchupText { get; set; }
}

/// One change of the engine's clock/turn state during a duel (research feed for the remaining-time feature).
public sealed class TimeSample
{
    public double T { get; set; }
    public int Step { get; set; }
    public int Turn { get; set; }
    public int Which { get; set; }
    public bool Guard { get; set; }
    public uint Left { get; set; }
    public uint Total { get; set; }
    public string Lp { get; set; } = "";
    // the on-screen timer (DuelTimer3D): whose input it is showing and its two remaining values
    public bool UiInput { get; set; }
    public int UiDuel { get; set; }
    public int UiTurn { get; set; }
    // engine animation state — the opponent's clock only runs while they are prompted and nothing is animating
    public int RunEff { get; set; }
    public int CurEff { get; set; }
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
    public List<int> MyExtraCards { get; set; } = new();   // the extra-deck part of MyCards
    public List<int> OppCards { get; set; } = new();
    public List<OppCard> OppCardDetails { get; set; } = new();
    public List<TurnTime> TurnTimes { get; set; } = new();
    public List<TimeSample> TimeProbe { get; set; } = new();
    public List<LiveCard> FinalCards { get; set; } = new();   // both players' card table at duel end (research feed)
    public Dictionary<int, int> FinalLogUids { get; set; } = new();
    public List<string> RevealLog { get; set; } = new();   // "t|uid|id|zone|src" whenever a hidden opponent card became known
    public List<string> TableLog { get; set; } = new();    // every 5s: "t|uid:zone:engineId:shownId:face,..." for the opponent's cards
    public List<string> ListLog { get; set; } = new();     // each time the card-list window opens: "t|type|n|id:uid:bits,..." 
    public List<string> TableStats { get; set; } = new();  // every 10s: which engine table the card list came from
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
    public bool Paused { get; set; }   // captured while recording was paused: archived for research, excluded from my record
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
[JsonSerializable(typeof(TodayDeck))]
[JsonSerializable(typeof(PendingMatch))]
[JsonSerializable(typeof(OppCard))]
[JsonSerializable(typeof(TurnTime))]
[JsonSerializable(typeof(TimeSample))]
[JsonSerializable(typeof(LiveCard))]
public partial class J : JsonSerializerContext { }
