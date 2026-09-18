using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace MdTracker;

public partial class MainWindow : Window
{
    private Tracker T => App.Tracker;
    private bool _loadingGroups;

    public MainWindow()
    {
        InitializeComponent();
        Title = $"YGO Decks 트래커 {App.Version}";
        T.StatusChanged += _ => Dispatcher.BeginInvoke(RefreshStatus);
        T.MatchesChanged += () => Dispatcher.BeginInvoke(() => { RefreshRecent(); RefreshToday(); });
        Loaded += (_, _) => { RefreshAll(); if (T.Store.Config.Token != null) LoadGroups(); CheckVersion(); };
    }

    private string _updateUrl = "https://ygodecks.com/media/tracker/mdtracker.exe";

    /// Compare this build against the server's current one and show the update banner if behind.
    private async void CheckVersion()
    {
        var info = await Task.Run(() => T.Api.LatestVersion());
        if (info == null || string.IsNullOrEmpty(info.Latest)) return;
        static int[] P(string v) => v.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var mine = P(App.Version); var theirs = P(info.Latest);
        bool behind = false;
        for (int i = 0; i < Math.Max(mine.Length, theirs.Length); i++)
        {
            int a = i < mine.Length ? mine[i] : 0, b = i < theirs.Length ? theirs[i] : 0;
            if (a != b) { behind = a < b; break; }
        }
        if (!behind) return;
        if (!string.IsNullOrEmpty(info.Url)) _updateUrl = info.Url;
        UpdateText.Text = $"새 버전 {info.Latest}이 나왔습니다. (현재 {App.Version}) 받아서 교체해 주세요.";
        UpdateBanner.Visibility = Visibility.Visible;
    }

    private void Update_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo(_updateUrl) { UseShellExecute = true }); } catch { }
    }

    private void RefreshAll() { RefreshStatus(); RefreshPanels(); RefreshRecent(); RefreshToday(); }

    /// Called after the tracker creates a sheet on its own.
    public void Refresh() => Dispatcher.BeginInvoke(() => { RefreshPanels(); LoadGroups(); });

    private void RefreshStatus()
    {
        StatusText.Text = T.Status;
        Dot.Fill = new SolidColorBrush(T.GameConnected ? Color.FromRgb(34, 197, 94) : Color.FromRgb(245, 158, 11));
    }

    private void RefreshPanels()
    {
        bool loggedIn = T.Store.Config.Token != null;
        LoginPanel.Visibility = loggedIn ? Visibility.Collapsed : Visibility.Visible;
        SetupPanel.Visibility = loggedIn ? Visibility.Visible : Visibility.Collapsed;
        AccountText.Text = loggedIn ? $"로그인됨: {T.Store.Config.Email}" : "";
        bool noSheet = loggedIn && T.Store.Config.RecordGroupId == null;
        NoSheetWarn.Visibility = noSheet ? Visibility.Visible : Visibility.Collapsed;
        SetupMsg.Text = noSheet ? "시트를 만들면 다음 게임부터 기록됩니다."
                                : $"게임은 '{T.Store.Config.RecordGroupName}' 시트에 기록됩니다.";
        SetupMsg.Foreground = (System.Windows.Media.Brush)FindResource("Muted");
        _settingAutoStart = true;
        AutoStartBox.IsChecked = T.Store.Config.StartWithWindows;
        LivePanelBox.IsChecked = T.Store.Config.LivePanel;
        _settingAutoStart = false;
    }

    private bool _settingAutoStart;

    private void LivePanel_Changed(object sender, RoutedEventArgs e)
    {
        if (_settingAutoStart) return;
        T.Store.Config.LivePanel = LivePanelBox.IsChecked == true; T.Store.SaveConfig();
    }

    private void AutoStart_Changed(object sender, RoutedEventArgs e)
    {
        if (_settingAutoStart) return;
        bool on = AutoStartBox.IsChecked == true;
        if (!AutoStart.Apply(on)) { SetupMsg.Text = "시작 프로그램 등록에 실패했습니다."; return; }
        T.Store.Config.StartWithWindows = on; T.Store.SaveConfig();
    }

    private void RefreshRecent()
    {
        RecentList.ItemsSource = T.Store.Recent().Where(m => m.Status != "discarded").Select(m => new
        {
            Time = DateTime.TryParse(m.EndedAt, out var t) ? t.ToString("MM-dd HH:mm") : "",
            Opp = m.OppName,
            Result = m.Result == "win" ? "승" : m.Result == "lose" ? "패" : m.Result,
            Coin = m.CoinWin ? "앞면" : "뒷면",
            Turn = m.First ? "선공" : "후공",
            MyDeck = m.SavedDeckName ?? DeckName(m.SuggestedMyDeckId) ?? "?",
            OppDeck = m.SavedOppDeckName ?? (m.Status == "saved" ? "모름" : DeckName(m.SuggestedOppDeckId) ?? "모름"),
            Rank = m.GameMode == 19
                ? (m.RatingAfter is double r ? $"레이팅 {r:0.##}" : "레이팅")
                : $"{OverlayWindow.RankLabel(m.RankCode)}{(m.Wins is int w ? $" · {w}승" : "")}",
        }).ToList();
    }

    /// Today's record, straight from the server so it follows the account across PCs.
    private async void RefreshToday()
    {
        if (T.Store.Config.Token == null) { TodayPanel.Visibility = Visibility.Collapsed; return; }
        var t = await Task.Run(() => { try { return T.Api.Today(); } catch { return null; } });
        TodayPanel.Visibility = Visibility.Visible;
        if (t == null) { TodayText.Text = "불러오지 못했습니다."; return; }
        if (t.Games == 0) { TodayText.Text = "오늘 기록된 게임이 없습니다."; return; }
        var parts = new List<string> { $"{t.Games}전 {t.Wins}승 {t.Losses}패 ({t.WinRate}%)" };
        if (t.CoinWinRate != null) parts.Add($"코인 {t.CoinWinRate}%");
        if (t.First is { Games: > 0 } f) parts.Add($"선공 {f.Wins}/{f.Games}");
        if (t.Second is { Games: > 0 } s) parts.Add($"후공 {s.Wins}/{s.Games}");
        if (t.AvgTurns != null) parts.Add($"평균 {t.AvgTurns}턴");
        var line = string.Join("   ·   ", parts);
        if (t.Rank?.From != null) line += $"\n랭크 {OverlayWindow.RankLabel(t.Rank.From)} → {OverlayWindow.RankLabel(t.Rank.To)}";
        else if (t.Rating?.To != null) line += $"\n레이팅 {t.Rating.From:0.##} → {t.Rating.To:0.##}";
        TodayText.Text = line;
    }

    private string? DeckName(int? id) => id == null ? null : T.Store.Decks.FirstOrDefault(d => d.Id == id)?.Name;

    // ---- login ----
    private void PwBox_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) LoginBtn_Click(sender, e); }

    private async void LoginBtn_Click(object sender, RoutedEventArgs e)
    {
        var email = EmailBox.Text.Trim(); var pw = PwBox.Password;
        if (email.Length == 0 || pw.Length == 0) { LoginMsg.Text = "이메일과 비밀번호를 입력하세요"; return; }
        LoginBtn.IsEnabled = false; LoginMsg.Text = "";
        var err = await Task.Run(() => T.Api.Login(email, pw));
        LoginBtn.IsEnabled = true;
        if (err != null) { LoginMsg.Text = err; return; }
        PwBox.Password = "";
        RefreshPanels();
        LoadGroups();
        _ = Task.Run(() => { try { T.RefreshDecks(); } catch { } });
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        T.Store.Config.Token = null; T.Store.SaveConfig();
        GroupBox.ItemsSource = null;
        RefreshPanels();
    }

    // ---- record group ----
    private async void LoadGroups()
    {
        _loadingGroups = true;
        try
        {
            var groups = await Task.Run(() => T.Api.Groups());
            GroupBox.ItemsSource = groups;
            GroupBox.DisplayMemberPath = "Name";
            var cur = groups.FirstOrDefault(g => g.Id == T.Store.Config.RecordGroupId);
            // Nothing chosen yet: take the newest sheet (the API returns them newest-first),
            // so games never pile up unrecorded.
            if (cur == null && groups.Count > 0) cur = groups[0];
            GroupBox.SelectedItem = cur;
            if (cur != null && T.Store.Config.RecordGroupId != cur.Id)
            {
                T.Store.Config.RecordGroupId = cur.Id; T.Store.Config.RecordGroupName = cur.Name; T.Store.SaveConfig();
            }
            if (groups.Count == 0 && NewGroupBox.Text.Length == 0) NewGroupBox.Text = $"{DateTime.Now:yyyy-MM} 시즌";
            RefreshPanels();
        }
        catch (UnauthorizedAccessException) { T.Store.Config.Token = null; T.Store.SaveConfig(); RefreshPanels(); LoginMsg.Text = "로그인이 만료되었습니다. 다시 로그인하세요."; }
        catch (Exception ex) { SetupMsg.Text = "시트 목록을 불러오지 못했습니다: " + ex.Message; }
        finally { _loadingGroups = false; }
    }

    private void RefreshGroups_Click(object sender, RoutedEventArgs e) => LoadGroups();

    private void GroupBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loadingGroups || GroupBox.SelectedItem is not RecordGroup g) return;
        T.Store.Config.RecordGroupId = g.Id; T.Store.Config.RecordGroupName = g.Name; T.Store.SaveConfig();
        RefreshPanels();
    }

    private async void CreateGroup_Click(object sender, RoutedEventArgs e)
    {
        var name = NewGroupBox.Text.Trim();
        if (name.Length == 0) return;
        try
        {
            var g = await Task.Run(() => T.Api.CreateGroup(name));
            T.Store.Config.RecordGroupId = g.Id; T.Store.Config.RecordGroupName = g.Name; T.Store.SaveConfig();
            NewGroupBox.Text = "";
            LoadGroups();
            RefreshPanels();
        }
        catch (Exception ex) { SetupMsg.Text = ex.Message; }
    }

    private void OpenSite_Click(object sender, RoutedEventArgs e)
    {
        var gid = T.Store.Config.RecordGroupId;
        var url = gid == null ? $"{T.Store.Config.ServerUrl}/record-groups" : $"{T.Store.Config.ServerUrl}/record-groups/{gid}";
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    // Closing the window keeps the tracker running in the tray.
    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        ((App)System.Windows.Application.Current).HideToTray();
    }
}
