using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace MdTracker;

/// Pops up beside the cursor while it rests on a zone in the game: my remaining deck, an opponent's set card,
/// or one of their piles — two columns.
public partial class DeckPopupWindow : Window
{
    private string _key = "";
    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(107, 114, 128));

    public DeckPopupWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) => WinApi.ClickThrough(new WindowInteropHelper(this).Handle);
    }

    private string _placedFor = "";

    public void Update(string title, List<(string text, int count, bool header)> rows)
    {
        // anchor once per zone: the pop-up stays put while the cursor wanders inside the same zone
        if (title != _placedFor) { _placedFor = title; Dispatcher.BeginInvoke(Place, System.Windows.Threading.DispatcherPriority.Loaded); }
        var key = title + "|" + string.Join("|", rows.Select(r => $"{r.text}:{r.count}"));
        if (key != _key)
        {
            _key = key;
            Rows.Children.Clear();
            Title.Text = title;
            foreach (var r in rows.Where(r => !r.header))
            {
                var fg = r.count == 0 ? Muted : Brushes.White;
                var g = new Grid { Width = 160, Margin = new Thickness(0, 1, 16, 1) };   // gap so a count never touches the next column
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var name = new TextBlock { Text = r.text, Foreground = fg, TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 11 };
                g.Children.Add(name);
                if (r.count >= 0)   // -1 means "name only" (a single set card)
                {
                    var cnt = new TextBlock { Text = r.count.ToString(), Foreground = fg, Margin = new Thickness(6, 0, 0, 0), FontWeight = FontWeights.SemiBold, FontSize = 11 };
                    Grid.SetColumn(cnt, 1);
                    g.Children.Add(cnt);
                }
                Rows.Children.Add(g);
            }
            if (rows.Count == 0) Rows.Children.Add(new TextBlock { Text = "아직 알려진 카드 없음", Foreground = Muted });
        }
    }

    /// Left of the cursor, vertically centred on it, kept on screen.
    private void Place()
    {
        if (WinApi.CursorPos() is not WinApi.POINT p) return;
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var c = fromDevice.Transform(new Point(p.X, p.Y));
        double w = ActualWidth > 0 ? ActualWidth : 380, h = ActualHeight > 0 ? ActualHeight : 200;
        double left = c.X - w - 24, top = c.Y - h / 2;
        if (left < 0) left = c.X + 24;
        top = Math.Max(0, Math.Min(top, SystemParameters.PrimaryScreenHeight - h));
        Left = left; Top = top;
    }
}
