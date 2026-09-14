using System.Drawing;
using System.Windows;
using MdPeek;
using WinForms = System.Windows.Forms;

namespace MdTracker;

public partial class App : System.Windows.Application
{
    public const string Version = "0.4.0";
    internal static Tracker Tracker = null!;
    internal static MainWindow? MainWin;
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
        AppDomain.CurrentDomain.UnhandledException += (_, a) => ReportCrash(a.ExceptionObject);
        DispatcherUnhandledException += (_, a) => { ReportCrash(a.Exception); a.Handled = true; };
        TaskScheduler.UnobservedTaskException += (_, a) => { ReportCrash(a.Exception); a.SetObserved(); };
        var store = new Store();
        var api = new Api(store);
        Tracker = new Tracker(store, api);
        Tracker.MatchCaptured += m => Dispatcher.BeginInvoke(() => OnMatchCaptured(m));

        _tray = new WinForms.NotifyIcon { Icon = MakeIcon(), Text = "YGO Decks 트래커", Visible = true };
        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add("열기", null, (_, _) => ShowMain());
        menu.Items.Add("종료", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowMain();

        MainWin = new MainWindow();
        MainWin.Show();
        Tracker.Start();

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

    private void ShowOverlay(PendingMatch m)
    {
        try { new OverlayWindow(Tracker, m).Show(); }
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
