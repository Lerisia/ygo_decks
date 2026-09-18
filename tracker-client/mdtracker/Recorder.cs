using System.IO;
using System.Text.Json;
using MdPeek;

namespace MdTracker;

/// Polls the game and turns each finished duel into a PendingMatch.
internal sealed class Recorder
{
    private readonly Game _g;
    private readonly Action<PendingMatch> _onMatch;
    private readonly Func<string, bool> _alreadyKnown;
    public static readonly HashSet<int> RecordedModes = new() { 3, 19 }; // Rank, Rate
    public Action<PendingMatch, LiveTick>? OnLive;
    public Action? OnLiveEnd;
    public Action? OnMyInputOpened;   // my clock just started running: a prompt opened or my turn began

    public Recorder(Game g, Action<PendingMatch> onMatch, Func<string, bool> alreadyKnown)
    {
        _g = g; _onMatch = onMatch; _alreadyKnown = alreadyKnown;
    }

    private JsonDocument? ReadJson(string path)
    {
        var p = _g.Path(path);
        if (p == 0) return null;
        var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms)) _g.IL.WriteObject(w, p);
        return JsonDocument.Parse(ms.ToArray());
    }

    private static int? GetInt(JsonElement e, string key) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;
    private static double? GetDouble(JsonElement e, string key)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(key, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d)) return d;
        return null;
    }
    private static JsonElement? Get(JsonElement e, string key) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind != JsonValueKind.Null ? v : null;

    /// Runs until the game process exits.
    public void Run()
    {
        PendingMatch? cur = null;      // duel in progress
        int lastStep = -999;
        int clockTurn = -1; DateTime turnStart = default;   // raw nTurnNum being timed (0-based in the engine)
        bool liveShown = false; int liveTick = 0; List<LiveCard> liveCards = new(); Dictionary<int, int> logUids = new();
        string lastProbe = ""; DateTime probeStart = default;
        // Opponent clock estimate. The client never receives the opponent's timer, but their clock only runs while
        // they are deciding: no prompt open on my side and nothing animating. Verified against my own clock (2% off).
        double oppBank = 300; int bankTurn = -1; DateTime lastTick = default;
        bool lastMyInput = false;
        void EndLive() { if (liveShown) { liveShown = false; OnLiveEnd?.Invoke(); } }
        while (true)
        {
            try
            {
                var d = _g.ReadDuel();
                if (d == null)
                {
                    if (cur != null) { Log.Info("duel client gone before result — dropped"); cur = null; EndLive(); }
                    lastStep = -999; clockTurn = -1;
                }
                else
                {
                    if (d.Step != lastStep)
                    {
                        Log.Info($"step {Enums.Step(d.Step)} (mode {Enums.GameMode(d.GameMode)})");
                        lastStep = d.Step;
                    }
                    if (d.Step == 16 && cur == null) { cur = CaptureStart(d); clockTurn = -1; lastProbe = ""; probeStart = DateTime.Now; oppBank = 300; bankTurn = -1; lastTick = default; }
                    var ui = cur == null ? null : _g.DuelTimerUi();
                    if (cur != null && d.Step == 16)
                    {
                        var now = DateTime.Now;
                        if (bankTurn != (int)d.Turn)
                        {
                            // from turn 2 on: +60 when the opponent's turn starts, +30 when mine does, never above 300
                            if (bankTurn >= 0) oppBank = Math.Min(300, oppBank + (IsMyTurn(cur, (int)d.Turn) ? 30 : 60));
                            bankTurn = (int)d.Turn;
                        }
                        bool myInput = ui?.input ?? false, noEffect = d.RunningEffect == -1 && d.CurrentRunEffect == -1;
                        if (lastTick != default && !myInput && noEffect) oppBank = Math.Max(0, oppBank - (now - lastTick).TotalSeconds);
                        lastTick = now;
                        if (myInput && !lastMyInput && RecordedModes.Contains(cur.GameMode)) OnMyInputOpened?.Invoke();
                        lastMyInput = myInput;
                    }
                    // Clock probe: one sample per change of the engine's time/turn state, uploaded with the game.
                    if (cur != null && cur.TimeProbe.Count < 3000)
                    {
                        var lp = string.Join("/", d.LP);
                        int uiDuel = ui == null ? -1 : (int)ui.Value.duel, uiTurn = ui == null ? -1 : (int)ui.Value.turn;
                        bool uiInput = ui?.input ?? false;
                        var key = $"{d.Step}|{d.Turn}|{d.WhichTurn}|{d.InputGuard}|{d.TimeLeft}|{d.TimeTotal}|{lp}|{uiInput}|{uiDuel}|{uiTurn}|{d.RunningEffect}|{d.CurrentRunEffect}";
                        if (key != lastProbe)
                        {
                            lastProbe = key;
                            cur.TimeProbe.Add(new TimeSample
                            {
                                T = (DateTime.Now - probeStart).TotalSeconds, Step = d.Step, Turn = (int)d.Turn, Which = d.WhichTurn, Guard = d.InputGuard,
                                Left = d.TimeLeft, Total = d.TimeTotal, Lp = lp, UiInput = uiInput, UiDuel = uiDuel, UiTurn = uiTurn,
                                RunEff = d.RunningEffect, CurEff = d.CurrentRunEffect,
                            });
                        }
                    }
                    // Turn clock: the counter only moves while the duel runs (step 16); leaving that step ends the last turn.
                    if (cur != null && clockTurn >= 0 && (d.Step != 16 || (int)d.Turn != clockTurn)) { CloseTurn(cur, clockTurn, turnStart); clockTurn = -1; }
                    if (cur != null && d.Step == 16 && clockTurn < 0) { clockTurn = (int)d.Turn; turnStart = DateTime.Now; }
                    if (cur != null && d.Step == 16 && OnLive != null && RecordedModes.Contains(cur.GameMode))
                    {
                        // Card table every poll: the engine lists ~120 instances, and a searched card shows its id only briefly.
                        if (liveTick++ % 1 == 0)
                        {
                            liveCards = new List<LiveCard>();
                            foreach (var c in _g.ReadPvpCards(includeUnknown: true))
                                liveCards.Add(new LiveCard { Me = (c.pos & 0xFF) == cur.MyId, Zone = (c.pos >> 8) & 0xFF, Index = (c.pos >> 16) & 0xFF, Id = c.cardId, Face = c.face, Uid = c.uid });
                            try { logUids = _g.LogUidTable(); } catch (Exception ex) { Log.Info("log uid table: " + ex.Message); }
                            if (liveTick == 1 || liveTick % 120 == 0) Log.Info("card table " + _g.LastTableStats);
                            if (cur.TableStats.Count < 60 && liveTick % 20 == 0) cur.TableStats.Add($"{(DateTime.Now - probeStart).TotalSeconds:0}s {_g.LastTableStats}");
                        }
                        liveShown = true;
                        var hover = _g.Hover();
                        OnLive(cur, new LiveTick
                        {
                            Turn = (int)d.Turn + 1, TurnMe = IsMyTurn(cur, (int)d.Turn), Cards = liveCards,
                            HoverMe = hover != null && hover.Value.player == cur.MyId, HoverZone = hover?.position ?? -1, HoverIndex = hover?.index ?? 0,
                            MySecLeft = (int)d.TimeTotal, OppSecLeft = (int)Math.Round(oppBank), LogUids = logUids,
                        });
                    }
                    else if (d.Step != 16) { EndLive(); lastMyInput = false; }
                    if (d.Step >= 19 && cur != null)
                    {
                        CaptureEnd(cur, d);
                        cur = null;
                    }
                }
            }
            catch (Exception ex)
            {
                if (_g.M.Proc.HasExited) { Log.Info("game exited"); return; }
                Log.Info("read error: " + ex.Message);
            }
            Thread.Sleep(500);
        }
    }

    /// The engine's nTurnNum is 0-based (turn 1 reads 0). Turns strictly alternate, so odd turns belong to whoever
    /// went first — no need for the game's (inverted) turn-owner flag.
    private static bool IsMyTurn(PendingMatch m, int rawTurn) => ((rawTurn + 1) % 2 == 1) == m.First;

    private static void CloseTurn(PendingMatch m, int rawTurn, DateTime start)
    {
        int sec = (int)Math.Round((DateTime.Now - start).TotalSeconds);
        bool me = IsMyTurn(m, rawTurn);
        m.TurnTimes.Add(new TurnTime { Turn = rawTurn + 1, Me = me, Sec = sec });
        if (me) m.MySec += sec; else m.OppSec += sec;
    }

    private PendingMatch? CaptureStart(Game.DuelState d)
    {
        using var duel = ReadJson("$.Duel");
        if (duel == null) { Log.Info("$.Duel missing at duel start"); return null; }
        var r = duel.RootElement;
        int myid = GetInt(r, "myid") ?? GetInt(r, "MyID") ?? 0;
        int mode = GetInt(r, "GameMode") ?? d.GameMode;
        var m = new PendingMatch
        {
            StartedAt = DateTime.Now.ToString("s"),
            GameMode = mode, GameModeName = Enums.GameMode(mode), MyId = myid,
            CoinWin = (GetInt(r, "Choice") ?? GetInt(r, "choice") ?? -1) == myid,
            First = (GetInt(r, "FirstPlayer") ?? GetInt(r, "first") ?? -1) == myid,
        };
        if (Get(r, "name") is { ValueKind: JsonValueKind.Array } names && names.GetArrayLength() >= 2)
        {
            m.MyName = names[myid].GetString() ?? ""; m.OppName = names[1 - myid].GetString() ?? "";
        }
        if (Get(r, "Deck") is { ValueKind: JsonValueKind.Array } decks && decks.GetArrayLength() > myid)
        {
            var mine = decks[myid];
            foreach (var part in new[] { "Main", "Extra" })
                if (Get(mine, part) is { } sec && Get(sec, "CardIds") is { ValueKind: JsonValueKind.Array } ids)
                    foreach (var id in ids.EnumerateArray())
                        if (id.ValueKind == JsonValueKind.Number)
                        {
                            m.MyCards.Add(id.GetInt32());
                            if (part == "Extra") m.MyExtraCards.Add(id.GetInt32());
                        }
        }
        using var profile = ReadJson("$.User.profile");
        if (profile != null) { m.RankBefore = GetInt(profile.RootElement, "rank"); m.TierBefore = GetInt(profile.RootElement, "rate"); }
        foreach (var path in mode == 19 ? new[] { "$.DuelMenu.RateDuel.deck_info.deck_id", "$.Deck.ratedeck_id" } : new[] { "$.Deck.maindeck_id" })
        {
            var p = _g.Path(path);
            if (p != 0) { var s = ScalarString(p); if (s != null && s != "0") { m.MyMdDeckId = s; break; } }
        }
        if (mode == 19)
        {
            using var rate = ReadJson("$.RateDuel");
            if (rate != null)
                foreach (var season in rate.RootElement.EnumerateObject())
                    if (Get(season.Value, "info") is { } info && GetDouble(info, "rate") is { } rv) m.RatingBefore = rv;
        }
        Log.Info($"duel start: {m.MyName} vs {m.OppName}, mode {m.GameModeName}, coin {(m.CoinWin ? "win" : "lose")}, {(m.First ? "first" : "second")}, {m.MyCards.Count} cards in my deck");
        return m;
    }

    private string? ScalarString(ulong p)
    {
        var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms)) _g.IL.WriteObject(w, p);
        return System.Text.Encoding.UTF8.GetString(ms.ToArray()).Trim('"');
    }

    private void CaptureEnd(PendingMatch m, Game.DuelState d)
    {
        m.Did = d.Did.ToString();
        m.EndedAt = DateTime.Now.ToString("s");
        m.Result = d.Result switch { 1 => "win", 2 => "lose", 3 => "draw", _ => d.WinMe ? "win" : d.WinRival ? "lose" : "" };
        m.Finish = Enums.Finish(d.Finish);
        m.Turn = (int)d.Turn + 1;   // engine counts from 0; the site counts turns the way players do
        if (string.IsNullOrEmpty(m.OppName)) m.OppName = d.Rival ?? "";
        if (string.IsNullOrEmpty(m.MyName)) m.MyName = d.Me ?? "";
        try { m.FinalLogUids = _g.LogUidTable(); } catch { }
        foreach (var c in _g.ReadPvpCards(includeUnknown: true))
        {
            m.FinalCards.Add(new LiveCard { Me = (c.pos & 0xFF) == m.MyId, Zone = (c.pos >> 8) & 0xFF, Id = c.cardId, Face = c.face, Uid = c.uid });
            if (c.cardId != 0 && (c.pos & 0xFF) != m.MyId)
            {
                m.OppCards.Add(c.cardId);
                m.OppCardDetails.Add(new OppCard { Id = c.cardId, Pos = c.pos, Face = c.face });
            }
        }
        using var res = ReadJson("$.DuelResult");
        if (res != null) m.RawDuelResult = res.RootElement.GetRawText();
        if (res != null && Get(res.RootElement, "resultInfo") is { } info)
        {
            if (string.IsNullOrEmpty(m.Result) && GetInt(info, "result") is { } rr) m.Result = rr == 1 ? "win" : rr == 2 ? "lose" : "draw";
            if (Get(info, "rankChange") is { } rc)
            {
                if (Get(rc, "before") is { } b) { m.RankBefore = GetInt(b, "rank") ?? m.RankBefore; m.TierBefore = GetInt(b, "rate") ?? m.TierBefore; }
                if (Get(rc, "after") is { } a) { m.RankAfter = GetInt(a, "rank"); m.TierAfter = GetInt(a, "rate"); }
            }
            if (Get(info, "RateDuel") is { } rd && Get(rd, "rate") is { } rate)
            {
                m.RatingBefore = GetDouble(rate, "old_rate") ?? m.RatingBefore;
                m.RatingAfter = GetDouble(rate, "new_rate");
            }
        }
        m.RankCode = RankCode(m.RankBefore, m.TierBefore);
        if (m.Did == "0" || _alreadyKnown(m.Did)) { Log.Info($"duel {m.Did} already recorded / no id — skipped"); return; }
        if (!RecordedModes.Contains(m.GameMode)) { Log.Info($"mode {m.GameModeName} not recorded — skipped"); return; }
        Log.Info($"duel end: {m.Result} ({m.Finish}), turn {m.Turn}, time me {m.MySec}s / opp {m.OppSec}s, rank {m.RankCode}, rating {m.RatingBefore}→{m.RatingAfter}, {m.OppCards.Count} opp cards");
        _onMatch(m);
    }

    public static (int rank, int tier)? ParseRankCode(string code)
    {
        var m = System.Text.RegularExpressions.Regex.Match(code, "^([a-z]+)([1-5])$");
        if (!m.Success) return null;
        int r = m.Groups[1].Value switch { "rookie" => 1, "bronze" => 2, "silver" => 3, "gold" => 4, "platinum" => 5, "diamond" => 6, "master" => 7, _ => 0 };
        return r == 0 ? null : (r, int.Parse(m.Groups[2].Value));
    }

    public static string? RankCode(int? rank, int? tier)
    {
        var name = rank switch { 1 => "rookie", 2 => "bronze", 3 => "silver", 4 => "gold", 5 => "platinum", 6 => "diamond", 7 => "master", _ => null };
        return name != null && tier is >= 1 and <= 5 ? $"{name}{tier}" : null;
    }
}
