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
                var rec = new Recorder(g, OnMatch, did => Store.Has(did)) { OnLive = OnLiveTick, OnLiveEnd = EndLive };
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
        if (_liveMatch != m) { _liveMatch = m; Live = new LiveDuel { OppName = m.OppName }; _liveKey = ""; }
        var L = Live!;
        L.Turn = t.Turn; L.TurnMe = t.TurnMe; L.TurnElapsed = t.TurnElapsed; L.MySec = m.MySec; L.OppSec = m.OppSec; L.OppCards = t.OppCards;
        var key = string.Join(",", t.OppCards.OrderBy(x => x));
        if (key != _liveKey && !_liveBusy && t.OppCards.Count > 0 && Store.Config.Token != null)
        {
            _liveKey = key; _liveBusy = true;
            new Thread(() => LiveLookup(m, L, t.OppCards)) { IsBackground = true }.Start();
        }
        LiveUpdated?.Invoke();
    }

    /// Opponent deck read + this user's record in that matchup, refreshed whenever new opponent cards appear.
    private void LiveLookup(PendingMatch m, LiveDuel L, List<int> opp)
    {
        try
        {
            var inf = Api.Infer(m.MyCards, opp);
            L.OppCandidates = inf.Opp.Candidates; L.OppCardNames = inf.Opp.Cards;
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

    public static string? MatchupLine(MatchupResponse? r)
    {
        if (r == null) return null;
        if (r.Matchup is { Games: > 0 } m)
        {
            var s = $"{r.Deck} vs {r.Opponent}  {m.Games}전 {m.Wins}승 ({m.WinRate}%)";
            if (r.First is { Games: > 0 } f) s += $"   ·   선공 {f.Wins}/{f.Games}";
            if (r.Second is { Games: > 0 } s2) s += $"   후공 {s2.Wins}/{s2.Games}";
            return s;
        }
        if (r.Total is { Games: > 0 } t) return $"{r.Deck} 전체 {t.Games}전 {t.Wins}승 ({t.WinRate}%)   ·   이 상대와는 첫 대결";
        return null;
    }

    private void OnMatch(PendingMatch m)
    {
        if (m.GameMode == 3 && !m.IsDemo) ApplyGauge(m);
        Enrich(m);
        if (!m.IsDemo) Store.Save(m);
        MatchesChanged?.Invoke();
        MatchCaptured?.Invoke(m);
        if (!m.IsDemo) new Thread(() => ArchiveGame(m)) { IsBackground = true }.Start();
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
