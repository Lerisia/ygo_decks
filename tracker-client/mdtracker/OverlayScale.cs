using System.Windows;
using System.Windows.Media;

namespace MdTracker;

/// Applies the configured overlay size to a window drawn over the game.
public static class OverlayScale
{
    public static readonly (string label, double scale)[] Options = { ("작게", 0.85), ("보통", 1.0), ("크게", 1.2), ("더 크게", 1.4) };

    public static void Apply(Window w)
    {
        double s = App.Tracker?.Store.Config.OverlayScale ?? 1.0;
        if (s <= 0 || Math.Abs(s - 1.0) < 0.01 || w.Content is not FrameworkElement root) return;
        root.LayoutTransform = new ScaleTransform(s, s);
    }
}
