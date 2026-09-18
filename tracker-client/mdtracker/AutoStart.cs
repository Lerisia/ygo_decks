using MdPeek;
using Microsoft.Win32;

namespace MdTracker;

/// Per-user "start with Windows" entry. Re-registered on every launch while enabled,
/// so moving the exe does not leave a dead shortcut behind.
public static class AutoStart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "YGODecksTracker";
    public const string MinimizedArg = "--minimized";

    public static bool Apply(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (key == null) return false;
            var exe = Environment.ProcessPath;
            if (enabled && exe != null) key.SetValue(Name, $"\"{exe}\" {MinimizedArg}");
            else key.DeleteValue(Name, throwOnMissingValue: false);
            return true;
        }
        catch (Exception ex) { Log.Info("autostart registry: " + ex.Message); return false; }
    }
}
