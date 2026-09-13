using System.Diagnostics;
using System.Runtime.InteropServices;

namespace MdTracker;

internal static class WinApi
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    /// Screen rectangle of the Master Duel window (physical pixels), or null if not found / minimized.
    public static RECT? GameWindowRect()
    {
        try
        {
            foreach (var p in Process.GetProcessesByName("masterduel"))
            {
                var h = p.MainWindowHandle;
                if (h == IntPtr.Zero || IsIconic(h) || !IsWindowVisible(h)) continue;
                if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out var r, Marshal.SizeOf<RECT>()) == 0 && r.Right > r.Left) return r;
                if (GetWindowRect(h, out r) && r.Right > r.Left) return r;
            }
        }
        catch { }
        return null;
    }
}
