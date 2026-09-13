using System.Text;
using MdPeek;

namespace MdTracker;

/// YGO Decks Master Duel tracker: watches the game, captures each ranked/rate duel and sends it to the site,
/// where it waits on the record group page for the user's confirmation. Read-only memory access, no injection.
internal static class Program
{
    public const string Version = "0.2.0";
    private const string RecordsUrl = "https://ygodecks.com/record-groups";

    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;
        Native.DisableQuickEdit();
        Console.Title = "YGO Decks 트래커";
        var store = new Store();
        var api = new Api(store);

        Console.WriteLine($"YGO Decks 마스터듀얼 트래커 {Version}");
        Console.WriteLine("게임이 끝날 때마다 사이트의 기록 시트 페이지에 '확인 대기'로 올라갑니다. 이 창은 닫지 말고 두세요.");
        Console.WriteLine();

        if (args.Contains("--logout")) { store.Config.Token = null; store.SaveConfig(); }
        if (store.Config.Token == null || args.Contains("--login")) Login(store, api);
        else Console.WriteLine($"로그인됨: {store.Config.Email}   (다른 계정: mdtracker.exe --login)");
        Console.WriteLine($"확인은 여기서: {RecordsUrl}");
        Console.WriteLine();

        if (args.Contains("--demo")) { Demo(store, api); }
        else
        {
            new Thread(() => RetryLoop(store, api)) { IsBackground = true, Name = "retry" }.Start();
            new Thread(() => GameLoop(store, api)) { IsBackground = true, Name = "game" }.Start();
        }

        var exit = new ManualResetEvent(false);
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; exit.Set(); };
        exit.WaitOne();
        return 0;
    }

    private static void Login(Store store, Api api)
    {
        while (true)
        {
            Console.Write("ygodecks.com 이메일: ");
            var email = (Console.ReadLine() ?? "").Trim();
            Console.Write("비밀번호: ");
            var pw = ReadPassword();
            if (email.Length == 0 || pw.Length == 0) continue;
            var err = api.Login(email, pw);
            if (err == null) { Console.WriteLine($"로그인 성공: {email}"); return; }
            Console.WriteLine("로그인 실패: " + err);
        }
    }

    private static string ReadPassword()
    {
        var sb = new StringBuilder();
        while (true)
        {
            var k = Console.ReadKey(intercept: true);
            if (k.Key == ConsoleKey.Enter) { Console.WriteLine(); return sb.ToString(); }
            if (k.Key == ConsoleKey.Backspace) { if (sb.Length > 0) { sb.Length--; Console.Write("\b \b"); } continue; }
            if (!char.IsControl(k.KeyChar)) { sb.Append(k.KeyChar); Console.Write('*'); }
        }
    }

    private static void GameLoop(Store store, Api api)
    {
        bool announcedWaiting = false;
        while (true)
        {
            Mem? mem = null;
            try
            {
                if (!announcedWaiting) { Log.Info("마스터듀얼 실행을 기다리는 중…"); announcedWaiting = true; }
                mem = Mem.Open();
                var g = new Game(mem);
                Log.Info("마스터듀얼 연결됨 — 랭크/레이트 듀얼을 감지하면 자동으로 올립니다");
                announcedWaiting = false;
                var rec = new Recorder(g, m => OnMatch(m, store, api), did => store.Has(did));
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

    private static void OnMatch(PendingMatch m, Store store, Api api)
    {
        if (m.GameMode == 3) ApplyGauge(m, store);
        store.Save(m);
        Upload(m, store, api);
        Console.Beep();
    }

    private static void Upload(PendingMatch m, Store store, Api api)
    {
        try
        {
            var res = api.UploadPending(m);
            m.Status = "uploaded"; m.ServerId = res.Id; m.Error = null;
            m.SuggestedDeckName = res.SuggestedDeck?.TryGetProperty("name", out var n) == true ? n.GetString() : null;
            m.SuggestedOppDeckName = res.SuggestedOppDeck?.TryGetProperty("name", out var o) == true ? o.GetString() : null;
            Log.Info($"올림: {m.MyName} vs {m.OppName} — {(m.Result == "win" ? "승리" : m.Result == "lose" ? "패배" : m.Result)}, 내 덱 {m.SuggestedDeckName ?? "?"}, 상대 {m.SuggestedOppDeckName ?? "모름"} → 사이트에서 확인해 주세요");
        }
        catch (UnauthorizedAccessException)
        {
            m.Status = "failed"; m.Error = "login expired";
            Log.Info("로그인이 만료되었습니다. 트래커를 다시 실행해 로그인해 주세요 (mdtracker.exe --login)");
            store.Config.Token = null; store.SaveConfig();
        }
        catch (Exception ex) { m.Status = "failed"; m.Error = ex.Message; Log.Info("업로드 실패(나중에 재시도): " + ex.Message); }
        store.Save(m);
    }

    /// Re-send games whose upload failed (network hiccup) once a minute.
    private static void RetryLoop(Store store, Api api)
    {
        while (true)
        {
            Thread.Sleep(60_000);
            if (store.Config.Token == null) continue;
            foreach (var m in store.Failed()) Upload(m, store, api);
        }
    }

    /// Ranked ladder state, kept locally with the site's rules (RankRules). The site stores the rank/wins
    /// *after* each game, so the record gets NextState(before, result); a promotion/demotion reported by the
    /// game overrides the computed rank (and resets wins to 0) so drift can't accumulate.
    public static void ApplyGauge(PendingMatch m, Store store)
    {
        if (m.RankCode == null || m.RankBefore is not int rb || m.TierBefore is not int tb) return;
        var g = store.Config.Gauge;
        if (g == null || g.Rank != rb || g.Tier != tb) g = new Gauge { Rank = rb, Tier = tb, Wins = 0 };
        var next = RankRules.NextState(m.RankCode, g.Wins, m.Result);
        var gameAfter = m.RankAfter is int ra && m.TierAfter is int ta ? Recorder.RankCode(ra, ta) : null;
        if (gameAfter != null && gameAfter != next.rank) { Log.Info($"ladder resync: rules said {next.rank}, game says {gameAfter}"); next = (gameAfter, 0); }
        m.RankCode = next.rank;
        var valid = RankRules.ValidWins(next.rank);
        m.Wins = valid.Length == 0 ? null : next.wins is int w && valid.Contains(w) ? w : valid[0];
        m.WinsEstimated = valid.Length > 0;
        var (nr, nt) = Recorder.ParseRankCode(next.rank) ?? (rb, tb);
        store.Config.Gauge = new Gauge { Rank = nr, Tier = nt, Wins = next.wins ?? 0 };
        store.SaveConfig();
    }

    /// --demo: upload one fake game (real ids from the 2026-09-13 recon game) to exercise the server flow.
    private static void Demo(Store store, Api api)
    {
        var m = new PendingMatch
        {
            Did = DateTime.Now.Ticks.ToString(), StartedAt = DateTime.Now.AddMinutes(-9).ToString("s"), EndedAt = DateTime.Now.ToString("s"),
            GameMode = 3, GameModeName = "Rank", Result = "win", Finish = "Normal", CoinWin = true, First = true, MyId = 0,
            MyName = "Elyss", OppName = "ヤヤトゥーレ", RankBefore = 1, TierBefore = 2, RankAfter = 1, TierAfter = 1, RankCode = "rookie2", Turn = 2,
            MyMdDeckId = "28860507",
            MyCards = new() { 4007, 3801, 8933, 8933, 9279, 9279, 12292, 12292, 12292, 20602, 20602, 20602, 9455, 3891, 3891, 3891, 3892, 3892, 20607, 11931, 16653, 12331, 16842, 11123, 20780, 16386, 19184, 20609, 13496, 19188, 18825, 20500, 20536 },
            OppCards = new() { 9015, 15060, 12695, 19014, 9518 },
        };
        OnMatch(m, store, api);
    }
}
