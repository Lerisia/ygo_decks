using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace MdTracker;

/// Post-game card shown over the game window: confirms decks + memo, saves on timeout with the suggestions.
public partial class OverlayWindow : Window
{
    private readonly Tracker _t;
    private readonly PendingMatch _m;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private int _left;
    private bool _paused, _busy;
    private SiteDeck? _myDeck, _oppDeck;
    private bool _oppUnknown;

    private static readonly Dictionary<string, string> RankKo = new()
    { ["rookie"] = "루키", ["bronze"] = "브론즈", ["silver"] = "실버", ["gold"] = "골드", ["platinum"] = "플래티넘", ["diamond"] = "다이아", ["master"] = "마스터" };

    public OverlayWindow(Tracker t, PendingMatch m)
    {
        InitializeComponent();
        _t = t; _m = m;
        _left = Math.Max(5, t.Store.Config.OverlaySeconds);
        Fill();
        Loaded += (_, _) => Place();
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
    }

    public static string RankLabel(string? code)
    {
        if (code == null) return "";
        var m = System.Text.RegularExpressions.Regex.Match(code, "^([a-z]+)([1-5])$");
        return m.Success && RankKo.TryGetValue(m.Groups[1].Value, out var ko) ? $"{ko} {m.Groups[2].Value}" : code;
    }

    private void Fill()
    {
        bool win = _m.Result == "win";
        ResultText.Text = win ? "승리" : _m.Result == "lose" ? "패배" : _m.Result;
        ResultBadge.Background = new SolidColorBrush(win ? Color.FromRgb(34, 197, 94) : Color.FromRgb(239, 68, 68));
        Headline.Text = $"vs {_m.OppName}";
        var parts = new List<string> { _m.CoinWin ? "코인 승" : "코인 패", _m.First ? "선공" : "후공" };
        if (_m.GameMode == 19) parts.Add(_m.RatingAfter is double r ? $"레이팅 {_m.RatingBefore:0.##} → {r:0.##}" : "레이팅");
        else if (_m.RankCode != null) parts.Add($"{RankLabel(_m.RankCode)}{(_m.Wins is int w ? $" · {w}승" : "")}");
        parts.Add($"{_m.Turn}턴");
        SubLine.Text = string.Join(" · ", parts);

        _myDeck = _t.Store.Decks.FirstOrDefault(d => d.Id == _m.SuggestedMyDeckId);
        MyDeckBox.Text = _myDeck?.Name ?? "";
        _oppDeck = _t.Store.Decks.FirstOrDefault(d => d.Id == _m.SuggestedOppDeckId);
        _oppUnknown = _oppDeck == null;
        OppDeckBox.Text = _oppDeck?.Name ?? "모름/기타";
        var top = _m.OppCandidates.FirstOrDefault();
        OppHint.Text = top != null ? $"추천 {top.Name} {Math.Round(top.Share * 100)}%" : "판독 근거 없음";
        if (_m.Error != null) Msg.Text = _m.Error;
        if (_m.IsDemo) { Headline.Text += "   (미리보기 — 저장되지 않음)"; }

        CardsPanel.Children.Clear();
        foreach (var c in _m.OppCardNames.Take(14))
            CardsPanel.Children.Add(new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(55, 65, 81)), CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 4, 4),
                Child = new TextBlock { Text = c.Count > 1 ? $"{c.Name} ×{c.Count}" : c.Name, FontSize = 11 },
            });
        if (_m.OppCardNames.Count == 0) CardsLabel.Text = "상대가 보여준 카드 없음";
        else if (_m.OppCardNames.Count > 14) CardsLabel.Text = $"상대가 보여준 카드 (상위 14장 / {_m.OppCardNames.Count})";
        UpdateCountdown();
    }

    /// Top-center of the game window; falls back to the primary screen.
    private void Place()
    {
        double left, top, width;
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var rect = WinApi.GameWindowRect();
        if (rect is WinApi.RECT r)
        {
            var tl = fromDevice.Transform(new Point(r.Left, r.Top));
            var br = fromDevice.Transform(new Point(r.Right, r.Bottom));
            left = tl.X; top = tl.Y + 56; width = br.X - tl.X;
        }
        else { left = 0; top = 56; width = SystemParameters.PrimaryScreenWidth; }
        Left = left + (width - ActualWidth) / 2;
        Top = top;
    }

    // ---- countdown ----
    private void Tick()
    {
        if (_paused || _busy) return;
        _left--;
        UpdateCountdown();
        if (_left <= 0) { _timer.Stop(); _ = SaveAsync(auto: true); }
    }

    private void UpdateCountdown() => Countdown.Text = _paused ? "" : $"{_left}초 후 자동 저장";
    private void Pause() { if (!_paused) { _paused = true; UpdateCountdown(); } }
    private void Input_Focus(object sender, RoutedEventArgs e) => Pause();
    private void Input_Changed(object sender, TextChangedEventArgs e) => Pause();
    private void Card_MouseDown(object sender, MouseButtonEventArgs e) { Pause(); if (e.ChangedButton == MouseButton.Left && e.OriginalSource is Border or Panel) try { DragMove(); } catch { } }

    // ---- deck search ----
    private void MyDeckBox_TextChanged(object sender, TextChangedEventArgs e) { Pause(); if (MyDeckBox.IsKeyboardFocusWithin) Search(MyDeckBox, MyDeckList); }
    private void OppDeckBox_TextChanged(object sender, TextChangedEventArgs e) { Pause(); if (OppDeckBox.IsKeyboardFocusWithin) { _oppUnknown = false; Search(OppDeckBox, OppDeckList); } }

    private void Search(TextBox box, ListBox list)
    {
        var q = box.Text.Trim();
        if (q.Length == 0) { list.Visibility = Visibility.Collapsed; return; }
        var hits = _t.Store.Decks.Where(d => Hangul.Matches(q, d.Name, d.Aliases)).Take(6).ToList();
        list.ItemsSource = hits; list.DisplayMemberPath = "Name";
        list.Visibility = hits.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void DeckBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        var (box, list) = sender == MyDeckBox ? (MyDeckBox, MyDeckList) : (OppDeckBox, OppDeckList);
        if (e.Key == Key.Down && list.Visibility == Visibility.Visible) { list.Focus(); list.SelectedIndex = 0; e.Handled = true; }
        else if (e.Key == Key.Enter && list.Visibility == Visibility.Visible && list.Items.Count > 0) { list.SelectedIndex = 0; e.Handled = true; }
        else if (e.Key == Key.Escape) { list.Visibility = Visibility.Collapsed; }
    }

    private void MyDeckList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (MyDeckList.SelectedItem is SiteDeck d) { _myDeck = d; MyDeckBox.Text = d.Name; MyDeckList.Visibility = Visibility.Collapsed; MemoBox.Focus(); }
    }

    private void OppDeckList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (OppDeckList.SelectedItem is SiteDeck d) { _oppDeck = d; _oppUnknown = false; OppDeckBox.Text = d.Name; OppDeckList.Visibility = Visibility.Collapsed; MemoBox.Focus(); }
    }

    private void Unknown_Click(object sender, RoutedEventArgs e)
    {
        Pause(); _oppDeck = null; _oppUnknown = true; OppDeckBox.Text = "모름/기타"; OppDeckList.Visibility = Visibility.Collapsed;
    }

    // ---- actions ----
    private void Save_Click(object sender, RoutedEventArgs e) => _ = SaveAsync(auto: false);

    private async Task SaveAsync(bool auto)
    {
        if (_busy) return;
        // resolve typed names that were never picked from the list
        if (_myDeck == null || _myDeck.Name != MyDeckBox.Text.Trim()) _myDeck = _t.Store.Decks.FirstOrDefault(d => d.Name == MyDeckBox.Text.Trim()) ?? _myDeck;
        if (!_oppUnknown && (_oppDeck == null || _oppDeck.Name != OppDeckBox.Text.Trim())) _oppDeck = _t.Store.Decks.FirstOrDefault(d => d.Name == OppDeckBox.Text.Trim()) ?? _oppDeck;
        if (_myDeck == null) { _timer.Stop(); Pause(); Msg.Text = "내 덱을 선택해 주세요"; MyDeckBox.Focus(); return; }
        _busy = true; SaveBtn.IsEnabled = false; Msg.Foreground = new SolidColorBrush(Color.FromRgb(156, 163, 175)); Msg.Text = "저장 중…";
        var memo = MemoBox.Text.Trim();
        var notes = auto && memo.Length == 0 ? null : memo;
        var oppId = _oppUnknown ? null : _oppDeck?.Id;
        var err = await Task.Run(() => _t.Save(_m, _myDeck.Id, oppId, notes));
        _busy = false;
        if (err != null)
        {
            _timer.Stop(); Pause(); SaveBtn.IsEnabled = true;
            Msg.Foreground = new SolidColorBrush(Color.FromRgb(252, 165, 165)); Msg.Text = "저장 실패: " + err;
            return;
        }
        Msg.Foreground = new SolidColorBrush(Color.FromRgb(134, 239, 172));
        Msg.Text = _m.IsDemo ? "미리보기 종료 (저장 안 됨)" : $"기록됨 ✓ {(_oppUnknown || _oppDeck == null ? "상대 모름" : _oppDeck.Name)}";
        await Task.Delay(1500);
        Close();
    }

    private async void Later_Click(object sender, RoutedEventArgs e)
    {
        _timer.Stop(); Pause();
        var err = await Task.Run(() => _t.Defer(_m));
        Msg.Text = err == null ? "사이트 '확인 대기'로 보냈습니다" : "보내기 실패: " + err;
        await Task.Delay(1200);
        Close();
    }

    private void Discard_Click(object sender, RoutedEventArgs e) { _timer.Stop(); _t.Discard(_m); Close(); }

    protected override void OnClosed(EventArgs e) { _timer.Stop(); base.OnClosed(e); }
}
