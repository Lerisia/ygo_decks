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
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int idx);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int idx, int val);
    private const int GWL_EXSTYLE = -20, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;

    public static POINT? CursorPos() => GetCursorPos(out var p) ? p : null;

    /// Strictly the game itself in front (our own windows do not count) — the alert condition.
    public static bool GameIsForeground()
    {
        try
        {
            var fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            GetWindowThreadProcessId(fg, out var pid);
            foreach (var p in Process.GetProcessesByName("masterduel"))
                if (p.Id == pid) return !IsIconic(p.MainWindowHandle);
        }
        catch { }
        return false;
    }

    /// Mouse events pass straight through the window (so a pop-up next to the cursor never steals the game's hover).
    public static void ClickThrough(IntPtr hwnd)
    {
        try { SetWindowLong(hwnd, GWL_EXSTYLE, GetWindowLong(hwnd, GWL_EXSTYLE) | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE); } catch { }
    }
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    /// True while the game (or one of our own overlay windows) is the foreground window — overlays hide otherwise,
    /// so minimizing or alt-tabbing away from the game takes them along.
    public static bool GameInFront()
    {
        try
        {
            var fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            GetWindowThreadProcessId(fg, out var pid);
            if (pid == Environment.ProcessId) return true;
            foreach (var p in Process.GetProcessesByName("masterduel"))
                if (p.Id == pid) return !IsIconic(p.MainWindowHandle);
        }
        catch { }
        return false;
    }

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
