using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace MdTracker;

/// Pops up beside the cursor while it rests on a zone in the game: my remaining deck, an opponent's set card,
/// or one of their piles — two columns of [thumb] name · count.
public partial class DeckPopupWindow : Window
{
    private string _key = "";
    private string _placedFor = "";
    private bool _toRight;
    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(107, 114, 128));

    public DeckPopupWindow()
    {
        InitializeComponent();
        OverlayScale.Apply(this);
        SourceInitialized += (_, _) => WinApi.ClickThrough(new WindowInteropHelper(this).Handle);
    }

    /// toRight: open on the right of the cursor (my piles sit on the right of the field, so a pop-up on the left
    /// would cover it); the opponent's piles are on the left, so theirs open leftwards.
    public void Update(string title, List<Row> rows, bool toRight = false)
    {
        // anchor once per zone: the pop-up stays put while the cursor wanders inside the same zone
        if (title != _placedFor) { _placedFor = title; _toRight = toRight; Dispatcher.BeginInvoke(Place, System.Windows.Threading.DispatcherPriority.Loaded); }
        var key = title + "|" + string.Join("|", rows.Select(r => $"{r.Id}:{r.Text}:{r.Count}"));
        if (key == _key) return;
        _key = key;
        Rows.Children.Clear();
        Title.Text = title;
        foreach (var r in rows.Where(r => !r.Header))
        {
            var g = Thumbs.RowElement(r, 12, fitContent: true);
            g.Margin = new Thickness(0, 1, 0, 1);
            Rows.Children.Add(g);
        }
        if (rows.Count == 0) Rows.Children.Add(new TextBlock { Text = "아직 알려진 카드 없음", Foreground = Muted });
    }

    /// Beside the cursor (left by default, right for my own zones), vertically centred on it, kept on screen.
    private void Place()
    {
        if (WinApi.CursorPos() is not WinApi.POINT p) return;
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var c = fromDevice.Transform(new Point(p.X, p.Y));
        double w = ActualWidth > 0 ? ActualWidth : 200, h = ActualHeight > 0 ? ActualHeight : 200;
        double screenW = SystemParameters.PrimaryScreenWidth;
        double left = _toRight ? c.X + 24 : c.X - w - 24, top = c.Y - h / 2;
        if (left < 0) left = c.X + 24;
        else if (left + w > screenW) left = Math.Max(0, c.X - w - 24);
        top = Math.Max(0, Math.Min(top, SystemParameters.PrimaryScreenHeight - h));
        Left = left; Top = top;
    }
}
