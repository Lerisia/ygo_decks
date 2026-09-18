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

    // "보통" is 1.2× the overlays' native size; up to 0.6.0 it was 1.0× and the options started at 0.85.
    public static readonly (string label, double scale)[] Options = { ("작게", 1.0), ("보통", 1.2), ("크게", 1.4), ("더 크게", 1.6) };

    public static void Apply(Window w)
    {
        double s = App.Tracker?.Store.Config.OverlayScale ?? 1.0;
        if (w.Content is not FrameworkElement root) return;
        if (s <= 0) s = 1.2;
        root.LayoutTransform = new ScaleTransform(s, s);
    }
}
