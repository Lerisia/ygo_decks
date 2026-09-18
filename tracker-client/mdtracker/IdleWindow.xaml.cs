using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace MdTracker;

/// Shown while the game is up but no duel is running: today's record, pinned to the top centre of the game window.
public partial class IdleWindow : Window
{
    private bool _dragged;

    public IdleWindow()
    {
        InitializeComponent();
        OverlayScale.Apply(this);
        Loaded += (_, _) => Place();
    }

    public void Update(TodayResponse? t)
    {
        if (t == null) { Line1.Text = "오늘의 전적을 불러오는 중…"; Line2.Text = ""; Line3.Visibility = Visibility.Collapsed; Place(); return; }
        if (t.Games == 0) { Line1.Text = "오늘 기록된 게임 없음"; Line2.Text = ""; Line3.Visibility = Visibility.Collapsed; Place(); return; }
        Line1.Text = $"오늘 {t.Games}전 {t.Wins}승 {t.Losses}패 · 승률 {t.WinRate}%";
        var parts = new List<string>();
        if (t.First is { Games: > 0 } f) parts.Add($"선공 승률 {Math.Round((double)f.Wins * 100 / f.Games)}%");
        if (t.Second is { Games: > 0 } s) parts.Add($"후공 승률 {Math.Round((double)s.Wins * 100 / s.Games)}%");
        if (t.CoinWinRate != null) parts.Add($"코인 {t.CoinWinRate}%");
        Line2.Text = string.Join(" · ", parts);
        string? line3 = null;
        if (t.Rank?.From != null) line3 = $"랭크 {OverlayWindow.RankLabel(t.Rank.From)} → {OverlayWindow.RankLabel(t.Rank.To)}";
        else if (t.Rating?.To != null) line3 = $"레이팅 {t.Rating.From:0.##} → {t.Rating.To:0.##}";
        Line3.Text = line3 ?? ""; Line3.Visibility = line3 == null ? Visibility.Collapsed : Visibility.Visible;
        Place();
    }

    /// Top centre of the game window unless the user dragged it elsewhere.
    public void Place()
    {
        if (_dragged || !IsLoaded) return;
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        double left, top, width;
        if (WinApi.GameWindowRect() is WinApi.RECT r)
        {
            var tl = fromDevice.Transform(new Point(r.Left, r.Top));
            var br = fromDevice.Transform(new Point(r.Right, r.Bottom));
            left = tl.X; top = tl.Y + 8; width = br.X - tl.X;
        }
        else { left = 0; top = 8; width = SystemParameters.PrimaryScreenWidth; }
        Left = left + (width - ActualWidth) / 2;
        Top = top;
    }

    private void Panel_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || e.OriginalSource is not (Border or Panel or TextBlock)) return;
        var before = new Point(Left, Top);
        try { DragMove(); } catch { }
        if (Math.Abs(Left - before.X) > 2 || Math.Abs(Top - before.Y) > 2) _dragged = true;
    }
}
