using System.IO;
using MdPeek;

namespace MdTracker;

/// Background orchestration: watch the game, enrich each captured duel, hand it to the UI (overlay), save.
public sealed class Tracker
{
    public readonly Store Store;
    public readonly Api Api;
    public event Action<string>? StatusChanged;
    public event Action<PendingMatch>? MatchCaptured;
    public event Action? MatchesChanged;
    public event Action? LiveUpdated;
    public event Action? LiveEnded;
    public LiveDuel? Live { get; private set; }
    public string Status { get; private set; } = "마스터듀얼 실행을 기다리는 중…";
    public bool GameConnected { get; private set; }
    private PendingMatch? _liveMatch;
    private string _liveKey = "";
    private bool _liveBusy;
    private readonly Dictionary<int, int> _knownOpp = new();   // uid → card id, once the engine has shown it

    public Tracker(Store store, Api api)
    {
        Store = store; Api = api;
        Log.Sink = line => { try { File.AppendAllText(store.LogPath, line + Environment.NewLine); } catch { } };
    }

    public void Start()
    {
        new Thread(GameLoop) { IsBackground = true, Name = "game" }.Start();
        new Thread(RetryLoop) { IsBackground = true, Name = "retry" }.Start();
        new Thread(() => { try { RefreshDecks(); } catch { } }) { IsBackground = true }.Start();
    }

    private void SetStatus(string s, bool connected)
    {
        Status = s; GameConnected = connected; StatusChanged?.Invoke(s);
    }

    private void GameLoop()
    {
        while (true)
        {
            Mem? mem = null;
            try
            {
                SetStatus("마스터듀얼 실행을 기다리는 중…", false);
                mem = Mem.Open();
                var g = new Game(mem);
                SetStatus("마스터듀얼 연결됨 — 랭크/레이팅 게임을 자동으로 기록합니다", true);
                Log.Info("game connected");
                var rec = new Recorder(g, OnMatch, did => Store.Has(did)) { OnLive = OnLiveTick, OnLiveEnd = EndLive, OnMyInputOpened = AlertIfAway };
                rec.Run();
            }
            catch (Exception ex)
            {
                if (!ex.Message.Contains("not found")) Log.Info("game: " + ex.Message);
            }
            finally { mem?.Dispose(); }
            Thread.Sleep(5000);
        }
    }

    // ---- mid-duel panel ----
    private void OnLiveTick(PendingMatch m, LiveTick t)
    {
        if (_liveMatch != m) { _liveMatch = m; Live = new LiveDuel { OppName = m.OppName, MyExtraIds = m.MyExtraCards.ToHashSet() }; _liveKey = ""; _knownOpp.Clear(); _liveStart = DateTime.Now; }
        var L = Live!;
        // What was shown once stays known: the game log's uid → id table (hand opens, searches, flips) plus anything
        // the engine has named on a tick. A revealed card that goes back to hand or is set face-down keeps its name.
        var stamp = (DateTime.Now - _liveStart).TotalSeconds;
        foreach (var kv in t.LogUids)
            if (!_knownOpp.ContainsKey(kv.Key)) { _knownOpp[kv.Key] = kv.Value; Reveal(m, stamp, kv.Key, kv.Value, t.Cards, "log"); }
        var engineIds = new Dictionary<int, int>();
        foreach (var c in t.Cards)
        {
            if (c.Me || c.Uid == 0) continue;
            engineIds[c.Uid] = c.Id;
            if (c.Id != 0) { if (!_knownOpp.ContainsKey(c.Uid)) Reveal(m, stamp, c.Uid, c.Id, t.Cards, "engine"); _knownOpp[c.Uid] = c.Id; }
            else if (_knownOpp.TryGetValue(c.Uid, out var known)) c.Id = known;
        }
        // research feed: the opponent's whole table every ~5s, engine id and shown id side by side
        if (++_tableTick % 10 == 0 && m.TableLog.Count < 400)
            m.TableLog.Add($"{stamp:0}|" + string.Join(",", t.Cards.Where(c => !c.Me).Select(c => $"{c.Uid}:{c.Zone}:{engineIds.GetValueOrDefault(c.Uid)}:{c.Id}:{(c.Face ? 1 : 0)}")));
        L.Turn = t.Turn; L.TurnMe = t.TurnMe; L.Cards = t.Cards; L.HoverMe = t.HoverMe; L.HoverZone = t.HoverZone; L.HoverIndex = t.HoverIndex;
        L.MySecLeft = t.MySecLeft; L.OppSecLeft = t.OppSecLeft;
        var opp = t.Cards.Where(c => !c.Me).Select(c => c.Id).ToList();
        var key = string.Join(",", opp.OrderBy(x => x));
        // First call names my decklist even before the opponent shows anything; later calls follow new opponent cards.
        if ((key != _liveKey || L.MyDeckList.Count == 0) && !_liveBusy && Store.Config.Token != null)
        {
            _liveKey = key; _liveBusy = true;
            new Thread(() => LiveLookup(m, L, opp)) { IsBackground = true }.Start();
        }
        LiveUpdated?.Invoke();
    }

    /// Opponent deck read + this user's record in that matchup, refreshed whenever new opponent cards appear.
    private void LiveLookup(PendingMatch m, LiveDuel L, List<int> opp)
    {
        try
        {
            var inf = Api.Infer(m.MyCards, opp);
            L.OppCandidates = inf.Opp.Candidates;
            L.MyDeckList = inf.My.Cards;
            foreach (var c in inf.My.Cards.Concat(inf.Opp.Cards)) L.Names[c.Id] = c.Name;
            foreach (var kv in inf.My.Aliases.Concat(inf.Opp.Aliases)) if (int.TryParse(kv.Key, out var raw)) L.Aliases[raw] = kv.Value;
            int? my = m.MyMdDeckId != null && Store.Config.DeckMap.TryGetValue(m.MyMdDeckId, out var mapped) ? mapped : inf.My.Candidates.FirstOrDefault()?.DeckId;
            var oppId = inf.Opp.Candidates.FirstOrDefault()?.DeckId;
            if (my != null && (L.MatchupText == null || oppId != L.MatchupOppId))
            {
                L.MatchupOppId = oppId;
                L.MatchupText = MatchupLine(Api.Matchup(my.Value, oppId));
            }
            LiveUpdated?.Invoke();
        }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); }
        catch (Exception ex) { Log.Info("live lookup: " + ex.Message); }
        finally { _liveBusy = false; }
    }

    private void EndLive() { _liveMatch = null; Live = null; LiveEnded?.Invoke(); }

    private DateTime _liveStart;
    private int _tableTick;
    /// Research feed: note the moment an opponent card in a hidden zone (hand/deck/extra) first got a name.
    private static void Reveal(PendingMatch m, double t, int uid, int id, List<LiveCard> cards, string src)
    {
        var c = cards.FirstOrDefault(x => x.Uid == uid);
        if (c == null || c.Me || m.RevealLog.Count >= 500) return;
        m.RevealLog.Add($"{t:0.0}|{uid}|{id}|{c.Zone}|{(c.Face ? 1 : 0)}|{src}");
    }

    private DateTime _lastAlert;
    /// Optional: a sound when my clock starts while the game is minimized or behind another window.
    private void AlertIfAway()
    {
        if (!Store.Config.AlertMyTurn || WinApi.GameIsForeground()) return;
        if ((DateTime.Now - _lastAlert).TotalSeconds < 5) return;
        _lastAlert = DateTime.Now;
        Chime();
    }

    /// A short two-note chime of our own, so it never reads as a Windows error sound.
    public static void Chime()
    {
        new Thread(() => { try { Console.Beep(880, 120); Console.Beep(1175, 180); } catch { } }) { IsBackground = true }.Start();
    }

    public static string? MatchupLine(MatchupResponse? r)
    {
        if (r == null) return null;
        // two lines: the deck overall, then this matchup
        var lines = new List<string>();
        if (r.Total is { Games: > 0 } t) lines.Add($"{r.Deck} {t.Wins}승 {t.Games - t.Wins}패");
        if (r.Matchup is { Games: > 0 } m) lines.Add($"vs {r.Opponent} {m.Wins}승 {m.Games - m.Wins}패");
        else if (r.Opponent != null && lines.Count > 0) lines.Add($"vs {r.Opponent} 첫 대결");
        return lines.Count == 0 ? null : string.Join("\n", lines);
    }

    private void OnMatch(PendingMatch m)
    {
        if (m.GameMode == 3 && !m.IsDemo) ApplyGauge(m);
        Enrich(m);
        if (!m.IsDemo) Store.Save(m);
        MatchesChanged?.Invoke();
        MatchCaptured?.Invoke(m);
        if (!m.IsDemo) new Thread(() => ArchiveGame(m)) { IsBackground = true }.Start();
        if (!m.IsDemo && Store.Config.ResearchFeed && (m.TimeProbe.Count > 0 || m.FinalCards.Count > 0))
            new Thread(() => { try { Api.UploadProbe(m); } catch (Exception ex) { Log.Info("time probe upload: " + ex.Message); } }) { IsBackground = true }.Start();
    }

    /// Raw capture → site archive; failures are retried by RetryLoop.
    private void ArchiveGame(PendingMatch m)
    {
        if (m.GameUploaded || Store.Config.Token == null) return;
        try { Api.UploadGame(m); m.GameUploaded = true; Store.Save(m); }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); }
        catch (Exception ex) { Log.Info("archive failed: " + ex.Message); }
    }

    public void RefreshDecks()
    {
        if (Store.Decks.Count > 0 && DateTime.Now - Store.DecksLoadedAt < TimeSpan.FromHours(12)) return;
        Store.SaveDecks(Api.Decks());
    }

    /// Ask the server for deck candidates / card names; my-deck suggestion prefers the remembered mapping.
    public void Enrich(PendingMatch m)
    {
        try
        {
            if (Store.Config.Token != null)
            {
                var inf = Api.Infer(m.MyCards, m.OppCards);
                m.MyCandidates = inf.My.Candidates; m.OppCandidates = inf.Opp.Candidates;
                m.MyCardNames = inf.My.Cards; m.OppCardNames = inf.Opp.Cards;
                m.SuggestedOppDeckId = inf.Opp.Candidates.FirstOrDefault()?.DeckId;
                m.Error = null;
            }
        }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); m.Error = "로그인이 만료되었습니다"; }
        catch (Exception ex) { m.Error = "서버 조회 실패: " + ex.Message; }
        if (m.MyMdDeckId != null && Store.Config.DeckMap.TryGetValue(m.MyMdDeckId, out var mapped)) m.SuggestedMyDeckId = mapped;
        else m.SuggestedMyDeckId = m.MyCandidates.FirstOrDefault()?.DeckId;
    }

    /// Make sure a record sheet exists: use the newest one, or create a default so a first game is never lost.
    public bool EnsureRecordGroup()
    {
        if (Store.Config.RecordGroupId != null) return true;
        try
        {
            var g = Api.Groups().FirstOrDefault() ?? Api.CreateGroup($"{DateTime.Now:yyyy-MM} 시즌");
            Store.Config.RecordGroupId = g.Id; Store.Config.RecordGroupName = g.Name; Store.SaveConfig();
            Log.Info($"record sheet ready: {g.Name}");
            return true;
        }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); return false; }
        catch (Exception ex) { Log.Info("sheet auto-create failed: " + ex.Message); return false; }
    }

    /// Save to the selected record group. Returns null on success, else an error message.
    public string? Save(PendingMatch m, int deckId, int? oppDeckId, string? notes)
    {
        if (m.IsDemo) { Thread.Sleep(400); m.Status = "discarded"; return null; }
        if (Store.Config.RecordGroupId is not int gid) return "기록할 시트가 선택되지 않았습니다";
        try
        {
            var (id, points) = Api.AddMatch(gid, m, deckId, oppDeckId, notes);
            m.Status = "saved"; m.MatchId = id; m.PointsAdded = points; m.Error = null; m.Notes = notes;
            m.SavedDeckName = Store.Decks.FirstOrDefault(d => d.Id == deckId)?.Name;
            m.SavedOppDeckName = oppDeckId.HasValue ? Store.Decks.FirstOrDefault(d => d.Id == oppDeckId)?.Name : null;
            if (m.MyMdDeckId != null) { Store.Config.DeckMap[m.MyMdDeckId] = deckId; Store.SaveConfig(); }
            Store.Save(m); MatchesChanged?.Invoke();
            Log.Info($"saved match {id}: {m.Result} vs {m.OppName} ({m.SavedOppDeckName ?? "?"})");
            return null;
        }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); m.Status = "failed"; m.Error = "로그인 만료"; }
        catch (Exception ex) { m.Status = "failed"; m.Error = ex.Message; Log.Info("save failed: " + ex.Message); }
        Store.Save(m); MatchesChanged?.Invoke();
        return m.Error;
    }

    /// "나중에": park it on the site's record page as 확인 대기.
    public string? Defer(PendingMatch m)
    {
        if (m.IsDemo) { m.Status = "discarded"; return null; }
        try { Api.UploadPending(m); m.Status = "pending"; m.Error = null; }
        catch (UnauthorizedAccessException) { Store.Config.Token = null; Store.SaveConfig(); m.Status = "failed"; m.Error = "로그인 만료"; }
        catch (Exception ex) { m.Status = "failed"; m.Error = ex.Message; }
        Store.Save(m); MatchesChanged?.Invoke();
        return m.Error;
    }

    public void Discard(PendingMatch m) { m.Status = "discarded"; if (!m.IsDemo) { Store.Save(m); MatchesChanged?.Invoke(); } }
    public void NotifyMatchesChanged() => MatchesChanged?.Invoke();

    /// Games whose save failed (network hiccup) are parked on the site once a minute so nothing is lost.
    private void RetryLoop()
    {
        while (true)
        {
            Thread.Sleep(60_000);
            if (Store.Config.Token == null) continue;
            foreach (var m in Store.Matches.Where(x => x.Status == "failed").ToList()) Defer(m);
            foreach (var m in Store.Matches.Where(x => !x.GameUploaded && !x.IsDemo && x.Status != "discarded").ToList()) ArchiveGame(m);
        }
    }

    /// Ranked ladder state, kept locally with the site's rules (RankRules). The site stores the rank/wins
    /// *after* each game, so the record gets NextState(before, result); a promotion/demotion reported by the
    /// game overrides the computed rank (and resets wins to 0) so drift can't accumulate.
    public void ApplyGauge(PendingMatch m)
    {
        if (m.RankCode == null || m.RankBefore is not int rb || m.TierBefore is not int tb) return;
        var g = Store.Config.Gauge;
        if (g == null || g.Rank != rb || g.Tier != tb) g = new Gauge { Rank = rb, Tier = tb, Wins = 0 };
        var next = RankRules.NextState(m.RankCode, g.Wins, m.Result);
        var gameAfter = m.RankAfter is int ra && m.TierAfter is int ta ? Recorder.RankCode(ra, ta) : null;
        if (gameAfter != null && gameAfter != next.rank) { Log.Info($"ladder resync: rules said {next.rank}, game says {gameAfter}"); next = (gameAfter, 0); }
        m.RankCode = next.rank;
        var valid = RankRules.ValidWins(next.rank);
        m.Wins = valid.Length == 0 ? null : next.wins is int w && valid.Contains(w) ? w : valid[0];
        m.WinsEstimated = valid.Length > 0;
        var (nr, nt) = Recorder.ParseRankCode(next.rank) ?? (rb, tb);
        Store.Config.Gauge = new Gauge { Rank = nr, Tier = nt, Wins = next.wins ?? 0 };
        Store.SaveConfig();
    }

    /// A fake game (real ids from the 2026-09-13 recon game) to exercise the overlay without the game.
    public PendingMatch DemoMatch()
    {
        var m = new PendingMatch
        {
            IsDemo = true, Did = "demo-" + DateTime.Now.Ticks, StartedAt = DateTime.Now.AddMinutes(-9).ToString("s"), EndedAt = DateTime.Now.ToString("s"),
            GameMode = 3, GameModeName = "Rank", Result = "win", Finish = "Normal", CoinWin = true, First = true, MyId = 0,
            MyName = "Elyss", OppName = "ヤヤトゥーレ", RankBefore = 2, TierBefore = 3, RankAfter = 2, TierAfter = 2, RankCode = "bronze3", Turn = 2,
            MyMdDeckId = "28860507",
            MyCards = new() { 4007, 3801, 8933, 8933, 9279, 9279, 12292, 12292, 12292, 20602, 20602, 20602, 9455, 3891, 3891, 3891, 3892, 3892, 20607, 11931, 16653, 12331, 16842, 11123, 20780, 16386, 19184, 20609, 13496, 19188, 18825, 20500, 20536 },
            OppCards = new() { 9015, 15060, 12695, 19014, 9518 },
        };
        OnMatch(m);
        return m;
    }
}
