using System.Windows;
using System.Windows.Media;

namespace MdTracker;

/// Applies the configured overlay size to a window drawn over the game.
public static class OverlayScale
{
    /// Game window rectangle in WPF units for a given window, or null when the game is not visible.
    public static (Point tl, Point br)? GameRect(Window w)
    {
        if (WinApi.GameWindowRect() is not WinApi.RECT r) return null;
        var src = PresentationSource.FromVisual(w);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        return (fromDevice.Transform(new Point(r.Left, r.Top)), fromDevice.Transform(new Point(r.Right, r.Bottom)));
    }

    public static readonly (string label, double scale)[] Options = { ("작게", 0.85), ("보통", 1.0), ("크게", 1.2), ("더 크게", 1.4) };

    public static void Apply(Window w)
    {
        double s = App.Tracker?.Store.Config.OverlayScale ?? 1.0;
        if (s <= 0 || Math.Abs(s - 1.0) < 0.01 || w.Content is not FrameworkElement root) return;
        root.LayoutTransform = new ScaleTransform(s, s);
    }
}
