using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace MdTracker;

/// Side panel pinned to the game window while a duel runs: opponent deck read, matchup record, turn clock, revealed cards.
public partial class LiveWindow : Window
{
    private static bool s_collapsed;   // remembered across duels in this session
    private bool _dragged;
    private string _cardsKey = "";

    public LiveWindow()
    {
        InitializeComponent();
        Loaded += (_, _) => { ApplyCollapse(); Place(); };
    }

    private static string Mmss(int s) => $"{s / 60}:{s % 60:00}";

    public void Update(LiveDuel s)
    {
        Head.Text = $"vs {s.OppName}";
        var top2 = s.OppCandidates.Take(2).Select(c => $"{c.Name} {Math.Round(c.Share * 100)}%").ToList();
        OppDeck.Text = top2.Count > 0 ? string.Join(" · 또는 ", top2) : s.OppCards.Count == 0 ? "아직 공개된 카드 없음" : "판독 중…";
        Matchup.Text = s.MatchupText ?? "";
        Matchup.Visibility = s.MatchupText == null ? Visibility.Collapsed : Visibility.Visible;

        int el = s.TurnElapsed;
        int mine = s.MySec + (s.TurnMe ? el : 0), theirs = s.OppSec + (s.TurnMe ? 0 : el);
        TurnLine.Text = s.Turn == 0 ? "듀얼 시작" : $"{s.Turn}턴 · {(s.TurnMe ? "내" : "상대")} 턴 {Mmss(el)}   ·   누적 내 {Mmss(mine)} / 상대 {Mmss(theirs)}";
        PillText.Text = s.Turn == 0 ? "◂ 듀얼" : $"◂ {s.Turn}턴 {Mmss(el)}";

        var key = string.Join(",", s.OppCardNames.Select(c => $"{c.Id}x{c.Count}"));
        if (key != _cardsKey)
        {
            _cardsKey = key;
            Cards.Children.Clear();
            foreach (var c in s.OppCardNames.Take(16))
                Cards.Children.Add(new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(55, 65, 81)), CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 4, 4),
                    Child = new TextBlock { Text = c.Count > 1 ? $"{c.Name} ×{c.Count}" : c.Name, FontSize = 11 },
                });
            CardsLabel.Text = s.OppCardNames.Count > 16 ? $"상대 공개 카드 (상위 16장 / {s.OppCardNames.Count})" : "상대 공개 카드";
        }
        Place();
    }

    /// Upper-right corner of the game window, unless the user has dragged it somewhere.
    private void Place()
    {
        if (_dragged || !IsLoaded) return;
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        double right, top;
        if (WinApi.GameWindowRect() is WinApi.RECT r)
        {
            var tl = fromDevice.Transform(new Point(r.Left, r.Top));
            var br = fromDevice.Transform(new Point(r.Right, r.Bottom));
            right = br.X; top = tl.Y + 56;
        }
        else { right = SystemParameters.PrimaryScreenWidth; top = 56; }
        Left = right - ActualWidth - 12;
        Top = top;
    }

    private void ApplyCollapse()
    {
        Body.Visibility = s_collapsed ? Visibility.Collapsed : Visibility.Visible;
        Pill.Visibility = s_collapsed ? Visibility.Visible : Visibility.Collapsed;
        Dispatcher.BeginInvoke(Place, DispatcherPriority.Loaded);
    }

    private void Collapse_Click(object sender, RoutedEventArgs e) { s_collapsed = true; ApplyCollapse(); }
    private void Expand_Click(object sender, MouseButtonEventArgs e) { if (!_dragging) { s_collapsed = false; ApplyCollapse(); } }

    private bool _dragging;
    private void Panel_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || e.OriginalSource is not (Border or Panel or TextBlock)) return;
        var before = new Point(Left, Top);
        _dragging = false;
        try { DragMove(); } catch { }
        if (Math.Abs(Left - before.X) > 2 || Math.Abs(Top - before.Y) > 2) { _dragged = true; _dragging = true; }
    }
}
