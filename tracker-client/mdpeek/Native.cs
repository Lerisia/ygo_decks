using System.Runtime.InteropServices;

namespace MdPeek;

internal static class Native
{
    public const uint PROCESS_VM_READ = 0x0010;
    public const uint PROCESS_QUERY_INFORMATION = 0x0400;

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern unsafe bool ReadProcessMemory(IntPtr hProcess, ulong lpBaseAddress, byte* lpBuffer, nuint nSize, out nuint lpNumberOfBytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
    [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

    /// Clicking inside a console window turns on text selection ("QuickEdit") and blocks every write
    /// until the user presses a key — which froze a collector for a whole duel. Turn it off.
    public static void DisableQuickEdit()
    {
        const int STD_INPUT_HANDLE = -10;
        const uint ENABLE_QUICK_EDIT_MODE = 0x0040, ENABLE_EXTENDED_FLAGS = 0x0080;
        try
        {
            var h = GetStdHandle(STD_INPUT_HANDLE);
            if (h == IntPtr.Zero || !GetConsoleMode(h, out var mode)) return;
            SetConsoleMode(h, (mode & ~ENABLE_QUICK_EDIT_MODE) | ENABLE_EXTENDED_FLAGS);
        }
        catch { }
    }
}
