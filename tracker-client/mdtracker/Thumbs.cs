using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace MdTracker;

/// Card thumbnails from the site, fetched on first use and kept for the session.
public static class Thumbs
{
    private static readonly Dictionary<int, BitmapImage> s_cache = new();
    public const int Size = 20;

    public static ImageSource? Get(int cardId)
    {
        if (cardId <= 0) return null;
        if (s_cache.TryGetValue(cardId, out var img)) return img;
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.UriSource = new Uri($"{App.Tracker.Store.Config.ServerUrl.TrimEnd('/')}/api/card-thumb/{cardId}/");
            bmp.DecodePixelWidth = 48;
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.EndInit();
            s_cache[cardId] = bmp;
            return bmp;
        }
        catch { return null; }
    }

    /// Card frame colours (the real card borders), drawn translucent behind each row.
    public static Brush? FrameTint(string frame)
    {
        var hex = frame switch
        {
            "spell" => "#1D9E74",
            "trap" => "#BC5A84",
            "normal" or "normal_pendulum" => "#C7A85F",
            "effect" or "effect_pendulum" => "#C0602B",
            "ritual" or "ritual_pendulum" => "#6F8FCB",
            "fusion" or "fusion_pendulum" => "#8968A8",
            "synchro" or "synchro_pendulum" => "#D9D9D9",
            "xyz" or "xyz_pendulum" => "#3A3A3A",
            "link" => "#1B4F9C",
            _ => null,
        };
        if (hex == null) return null;
        var c = (Color)ColorConverter.ConvertFromString(hex);
        return new SolidColorBrush(Color.FromArgb(0x55, c.R, c.G, c.B));
    }

    /// A row as the overlays draw it: [thumb] name ····· count. fitContent: the row is only as wide as its text
    /// (for pop-ups that size themselves), otherwise the name stretches and the count sits at the right edge.
    public static Grid RowElement(Row r, double fontSize = 12, bool fitContent = false)
    {
        var g = new Grid { Background = FrameTint(r.Frame) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = System.Windows.GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = fitContent ? System.Windows.GridLength.Auto : new System.Windows.GridLength(1, System.Windows.GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = System.Windows.GridLength.Auto });
        var fg = r.Count == 0 ? new SolidColorBrush(Color.FromRgb(107, 114, 128)) : Brushes.White;
        var img = new Border
        {
            Width = Size, Height = Size, CornerRadius = new System.Windows.CornerRadius(3), Margin = new System.Windows.Thickness(2, 1, 6, 1),
            Background = new SolidColorBrush(Color.FromRgb(55, 65, 81)), Opacity = r.Count == 0 ? 0.45 : 1,
            Child = new Image { Source = Get(r.Id), Stretch = Stretch.UniformToFill },
        };
        var name = new TextBlock { Text = r.Text, Foreground = fg, TextTrimming = System.Windows.TextTrimming.CharacterEllipsis, VerticalAlignment = System.Windows.VerticalAlignment.Center, FontSize = fontSize };
        if (fitContent) name.MaxWidth = 260;
        Grid.SetColumn(name, 1);
        g.Children.Add(img); g.Children.Add(name);
        if (r.Count >= 0)
        {
            var cnt = new TextBlock { Text = r.Count.ToString(), Foreground = fg, Margin = new System.Windows.Thickness(8, 0, 4, 0), FontWeight = System.Windows.FontWeights.SemiBold, VerticalAlignment = System.Windows.VerticalAlignment.Center, FontSize = fontSize };
            Grid.SetColumn(cnt, 2);
            g.Children.Add(cnt);
        }
        return g;
    }
}
