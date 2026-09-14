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
        T.MatchesChanged += () => Dispatcher.BeginInvoke(RefreshRecent);
        Loaded += (_, _) => { RefreshAll(); if (T.Store.Config.Token != null) LoadGroups(); };
    }

    private void RefreshAll() { RefreshStatus(); RefreshPanels(); RefreshRecent(); }

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
        bool noSheet = T.Store.Config.RecordGroupId == null;
        SetupMsg.Text = noSheet ? "⚠ 기록할 시트를 먼저 골라주세요. 시트가 없으면 아래에서 새로 만들면 됩니다. (고르기 전까지는 게임이 사이트의 '확인 대기'로만 쌓입니다.)"
                                : $"게임은 '{T.Store.Config.RecordGroupName}' 시트에 기록됩니다.";
        SetupMsg.Foreground = noSheet ? System.Windows.Media.Brushes.OrangeRed : (System.Windows.Media.Brush)FindResource("Muted");
    }

    private void RefreshRecent()
    {
        RecentList.ItemsSource = T.Store.Recent().Where(m => m.Status != "discarded").Select(m => new
        {
            Time = DateTime.TryParse(m.EndedAt, out var t) ? t.ToString("MM-dd HH:mm") : "",
            Opp = m.OppName,
            Result = m.Result == "win" ? "승" : m.Result == "lose" ? "패" : m.Result,
            MyDeck = m.SavedDeckName ?? DeckName(m.SuggestedMyDeckId) ?? "?",
            OppDeck = m.SavedOppDeckName ?? (m.Status == "saved" ? "모름" : DeckName(m.SuggestedOppDeckId) ?? "모름"),
            Rank = m.GameMode == 19
                ? (m.RatingAfter is double r ? $"레이팅 {r:0.##}" : "레이팅")
                : $"{OverlayWindow.RankLabel(m.RankCode)}{(m.Wins is int w ? $" · {w}승" : "")}",
        }).ToList();
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
