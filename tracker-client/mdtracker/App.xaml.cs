using System.Drawing;
using System.Windows;
using MdPeek;
using WinForms = System.Windows.Forms;

namespace MdTracker;

public partial class App : System.Windows.Application
{
    public const string Version = "0.5.3";
    internal static Tracker Tracker = null!;
    internal static MainWindow? MainWin;
    private OverlayWindow? _overlay;
    private LiveWindow? _live;
    private DeckPopupWindow? _deckPopup;
    private IdleWindow? _idle;
    private readonly System.Windows.Threading.DispatcherTimer _idleTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private TodayResponse? _today; private DateTime _todayAt; private bool _todayBusy;
    private static Mutex? s_single;

    /// Two copies (even different versions) would each save the same duel; only the first one lives.
    private static bool AnotherInstanceRunning()
    {
        s_single = new Mutex(true, @"Local\YGODecksTracker", out bool first);
        if (!first) return true;
        try
        {
            int me = Environment.ProcessId;
            return System.Diagnostics.Process.GetProcessesByName("mdtracker").Any(p => p.Id != me);
        }
        catch { return false; }
    }
    private WinForms.NotifyIcon? _tray;
    private bool _balloonShown;

    private static string CrashLog => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mdtracker", "crash.log");

    private static void ReportCrash(object? ex)
    {
        try
        {
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(CrashLog)!);
            System.IO.File.AppendAllText(CrashLog, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {ex}{Environment.NewLine}{Environment.NewLine}");
        }
        catch { }
        try { System.Windows.MessageBox.Show($"트래커에 오류가 발생했습니다.\n\n{(ex as Exception)?.Message ?? ex}\n\n자세한 내용: {CrashLog}", "YGO Decks 트래커", MessageBoxButton.OK, MessageBoxImage.Error); } catch { }
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Updater.WaitForPredecessor(e.Args);
        if (AnotherInstanceRunning())
        {
            if (!e.Args.Contains(AutoStart.MinimizedArg))
                System.Windows.MessageBox.Show("트래커가 이미 실행 중입니다. 트레이 아이콘을 확인하세요.\n(두 개를 켜면 같은 게임이 두 번 기록됩니다)", "YGO Decks 트래커", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }
        AppDomain.CurrentDomain.UnhandledException += (_, a) => ReportCrash(a.ExceptionObject);
        DispatcherUnhandledException += (_, a) => { ReportCrash(a.Exception); a.Handled = true; };
        TaskScheduler.UnobservedTaskException += (_, a) => { ReportCrash(a.Exception); a.SetObserved(); };
        var store = new Store();
        var api = new Api(store);
        Tracker = new Tracker(store, api);
        Tracker.MatchCaptured += m => Dispatcher.BeginInvoke(() => OnMatchCaptured(m));
        Tracker.LiveUpdated += () => Dispatcher.BeginInvoke(OnLiveUpdated);
        Tracker.LiveEnded += () => Dispatcher.BeginInvoke(CloseLive);
        Tracker.MatchesChanged += () => _todayAt = default;   // a finished game refreshes the idle card at once
        _idleTimer.Tick += (_, _) => IdleTick();
        _idleTimer.Start();

        _tray = new WinForms.NotifyIcon { Icon = MakeIcon(), Text = "YGO Decks 트래커", Visible = true };
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add("열기", null, (_, _) => ShowMain());
        menu.Items.Add("종료", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowMain();

        MainWin = new MainWindow();
        if (Tracker.Store.Config.StartWithWindows) AutoStart.Apply(true);
        if (e.Args.Contains(AutoStart.MinimizedArg)) HideToTray();
        else MainWin.Show();
        Tracker.Start();
        new Thread(Updater.Cleanup) { IsBackground = true }.Start();
        if (e.Args.Contains(Updater.UpdatedArg)) _tray?.ShowBalloonTip(5000, "YGO Decks 트래커", $"{Version}(으)로 업데이트했습니다.", WinForms.ToolTipIcon.Info);
        _startArgs = e.Args;
        new Thread(AutoUpdateLoop) { IsBackground = true, Name = "update" }.Start();

        if (e.Args.Contains("--demo"))
            new Thread(() => { Thread.Sleep(2500); Tracker.DemoMatch(); }) { IsBackground = true }.Start();
    }

    private void OnMatchCaptured(PendingMatch m)
    {
        if (!m.IsDemo && Tracker.Store.Config.Token == null)
        {
            ShowMain();
            _tray?.ShowBalloonTip(6000, "YGO Decks 트래커", "로그인하지 않아 이번 게임은 기록되지 않았습니다.", WinForms.ToolTipIcon.Warning);
            return;
        }
        if (!m.IsDemo && Tracker.Store.Config.RecordGroupId == null)
        {
            // No sheet yet: make one in the background rather than dropping the game, then carry on as usual.
            new Thread(() =>
            {
                bool ok = Tracker.EnsureRecordGroup();
                Dispatcher.BeginInvoke(() =>
                {
                    if (!ok)
                    {
                        ShowMain();
                        _tray?.ShowBalloonTip(6000, "YGO Decks 트래커", "시트를 만들지 못해 이번 게임은 기록되지 않았습니다.", WinForms.ToolTipIcon.Warning);
                        return;
                    }
                    _tray?.ShowBalloonTip(5000, "YGO Decks 트래커", $"기록할 시트 '{Tracker.Store.Config.RecordGroupName}'을(를) 만들었습니다.", WinForms.ToolTipIcon.Info);
                    MainWin?.Refresh();
                    ShowOverlay(m);
                });
            }) { IsBackground = true }.Start();
            return;
        }
        ShowOverlay(m);
    }

    private void OnLiveUpdated()
    {
        var s = Tracker.Live;
        if (s == null || !Tracker.Store.Config.LivePanel) return;
        try
        {
            if (_live == null)
            {
                var w = new LiveWindow();
                w.Closed += (_, _) => { if (ReferenceEquals(_live, w)) _live = null; };
                _live = w;
                w.Show();
            }
            _live.Update(s);
            // pop-up beside the cursor for the zone it rests on (my deck, an opponent's set card, their piles)
            var hover = WinApi.GameInFront() ? _live.HoverRows(s) : null;
            if (hover != null)
            {
                if (_deckPopup == null) { _deckPopup = new DeckPopupWindow(); _deckPopup.Show(); }
                _deckPopup.Update(hover.Value.title, hover.Value.rows);
            }
            else if (_deckPopup != null) { try { _deckPopup.Close(); } catch { } _deckPopup = null; }
        }
        catch (Exception ex) { Log.Info("live panel: " + ex.Message); }
    }

    private void CloseLive()
    {
        try { _live?.Close(); } catch { }
        _live = null;
        try { _deckPopup?.Close(); } catch { }
        _deckPopup = null;
    }

    // ---- self-update ----
    private string[] _startArgs = Array.Empty<string>();
    internal string UpdateState { get; private set; } = "";   // shown in the main window banner
    internal event Action? UpdateStateChanged;
    private bool _updateStaged;

    private void SetUpdateState(string s) { UpdateState = s; UpdateStateChanged?.Invoke(); }

    /// Check on start and every 30 minutes. A newer build is offered once per run — between duels, never mid-game —
    /// and only installed after the person says yes.
    private string _offered = "";
    private void AutoUpdateLoop()
    {
        Thread.Sleep(8000);
        while (true)
        {
            int wait = 30 * 60 * 1000;
            try
            {
                var info = Tracker.Api.LatestVersion();
                if (info != null && Behind(info.Latest) && !string.IsNullOrEmpty(info.Url) && _offered != info.Latest)
                {
                    if (Tracker.Live != null || _overlay != null) wait = 5000;   // ask after the duel
                    else
                    {
                        _offered = info.Latest;
                        Dispatcher.Invoke(() =>
                        {
                            SetUpdateState($"새 버전 {info.Latest}이 있습니다. (현재 {Version})");
                            ShowMain();
                            if (new UpdateDialog { Owner = MainWin }.ShowDialog() == true) UpdateNow();
                        });
                    }
                }
            }
            catch (Exception ex) { Log.Info("update check: " + ex.Message); }
            Thread.Sleep(wait);
        }
    }

    internal static bool Behind(string latest)
    {
        static int[] P(string v) => v.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var mine = P(Version); var theirs = P(latest);
        for (int i = 0; i < Math.Max(mine.Length, theirs.Length); i++)
        {
            int a = i < mine.Length ? mine[i] : 0, b = i < theirs.Length ? theirs[i] : 0;
            if (a != b) return a < b;
        }
        return false;
    }

    /// Manual path from the banner button: download now (if not yet), then swap and relaunch right away.
    internal void UpdateNow()
    {
        new Thread(() =>
        {
            try
            {
                if (!_updateStaged)
                {
                    var info = Tracker.Api.LatestVersion();
                    if (info == null || string.IsNullOrEmpty(info.Url)) { SetUpdateState("버전 정보를 가져오지 못했습니다"); return; }
                    SetUpdateState($"새 버전 {info.Latest} 내려받는 중…");
                    if (Updater.Download(info.Url, p => SetUpdateState($"새 버전 {info.Latest} 내려받는 중… {p}")) == null) { SetUpdateState("내려받기에 실패했습니다"); return; }
                    _updateStaged = true;
                }
                Dispatcher.Invoke(RestartForUpdate);
            }
            catch (Exception ex) { SetUpdateState("업데이트 실패: " + ex.Message); }
        }) { IsBackground = true }.Start();
    }

    private void RestartForUpdate()
    {
        SetUpdateState("업데이트 적용 중 — 재시작합니다");
        try { s_single?.Dispose(); } catch { }
        if (Updater.ApplyAndRelaunch(_startArgs)) Quit();
        else { _updateStaged = false; SetUpdateState("업데이트를 적용하지 못했습니다. 새 버전을 직접 받아 주세요."); }
    }

    /// Between duels: today's record at the top of the game window. Gone the moment a duel or the confirmation card is up.
    private void IdleTick()
    {
        try
        {
            // "in front" counts our own windows so dragging the card does not hide it — but the tracker's main window
            // being active means the person is looking at the tracker, not the game.
            bool show = Tracker.GameConnected && Tracker.Live == null && _overlay == null
                        && Tracker.Store.Config.LivePanel && Tracker.Store.Config.Token != null
                        && WinApi.GameInFront() && !(MainWin?.IsActive ?? false);
            if (!show) { if (_idle != null) { try { _idle.Close(); } catch { } _idle = null; } return; }
            if (_idle == null) { _idle = new IdleWindow(); _idle.Show(); _idle.Update(_today); }
            if (!_todayBusy && DateTime.Now - _todayAt > TimeSpan.FromSeconds(60))
            {
                _todayBusy = true;
                new Thread(() =>
                {
                    TodayResponse? t = null;
                    try { t = Tracker.Api.Today(); } catch { }
                    Dispatcher.BeginInvoke(() => { _todayBusy = false; _todayAt = DateTime.Now; if (t != null) { _today = t; _idle?.Update(t); } });
                }) { IsBackground = true }.Start();
            }
            _idle.Place();
        }
        catch (Exception ex) { Log.Info("idle card: " + ex.Message); }
    }

    /// One card at a time: a match left unsaved stays in the site's pending list, so closing it loses nothing.
    private void ShowOverlay(PendingMatch m)
    {
        try
        {
            CloseLive();
            try { _overlay?.Close(); } catch { }
            var w = new OverlayWindow(Tracker, m);
            w.Closed += (_, _) => { if (ReferenceEquals(_overlay, w)) _overlay = null; };
            _overlay = w;
            w.Show();
        }
        catch (Exception ex) { Log.Info("overlay error: " + ex.Message); }
    }

    internal void ShowMain()
    {
        if (MainWin == null) return;
        MainWin.Show();
        if (MainWin.WindowState == WindowState.Minimized) MainWin.WindowState = WindowState.Normal;
        MainWin.Activate();
    }

    internal void HideToTray()
    {
        MainWin?.Hide();
        if (!_balloonShown && _tray != null)
        {
            _balloonShown = true;
            _tray.ShowBalloonTip(3000, "YGO Decks 트래커", "트레이에서 계속 실행 중입니다. 게임이 끝나면 오버레이가 뜹니다.", WinForms.ToolTipIcon.Info);
        }
    }

    internal void Quit()
    {
        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
        Shutdown();
    }

    /// Tray icon = the site's logo (embedded app.ico).
    private static Icon MakeIcon()
    {
        using var st = typeof(App).Assembly.GetManifestResourceStream("app.ico")!;
        return new Icon(st, 32, 32);
    }
}
