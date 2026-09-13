using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace MdPeek;

/// Read-only view of another process. Never writes, never injects.
internal sealed class Mem : IDisposable
{
    public readonly Process Proc;
    private readonly IntPtr _h;
    public ulong GameAssemblyBase { get; }
    public int GameAssemblySize { get; }

    // Small page cache so class-info scanning doesn't hammer ReadProcessMemory.
    private readonly Dictionary<ulong, byte[]?> _pages = new();
    private const int PageSize = 0x1000;

    private Mem(Process p, IntPtr h, ulong gaBase, int gaSize)
    {
        Proc = p; _h = h; GameAssemblyBase = gaBase; GameAssemblySize = gaSize;
    }

    public static Mem Open(string processName = "masterduel", string module = "GameAssembly.dll")
    {
        var procs = Process.GetProcessesByName(processName);
        if (procs.Length == 0) throw new Exception($"process '{processName}' not found (is Master Duel running?)");
        var p = procs[0];
        var h = Native.OpenProcess(Native.PROCESS_VM_READ | Native.PROCESS_QUERY_INFORMATION, false, p.Id);
        if (h == IntPtr.Zero) throw new Exception($"OpenProcess failed (err {Marshal.GetLastWin32Error()})");
        ProcessModule? ga = null;
        foreach (ProcessModule m in p.Modules)
            if (string.Equals(m.ModuleName, module, StringComparison.OrdinalIgnoreCase)) { ga = m; break; }
        if (ga == null) throw new Exception($"{module} not loaded yet");
        return new Mem(p, h, (ulong)ga.BaseAddress.ToInt64(), ga.ModuleMemorySize);
    }

    public unsafe bool TryRead(ulong addr, Span<byte> buf)
    {
        if (addr == 0 || addr > 0x7FFFFFFFFFFF) return false;
        fixed (byte* b = buf)
        {
            if (!Native.ReadProcessMemory(_h, addr, b, (nuint)buf.Length, out var n)) return false;
            return (int)n == buf.Length;
        }
    }

    public byte[] Read(ulong addr, int len)
    {
        var buf = new byte[len];
        if (!TryRead(addr, buf)) throw new MemException(addr, len);
        return buf;
    }

    public bool TryReadU64(ulong addr, out ulong v)
    {
        Span<byte> b = stackalloc byte[8];
        if (!TryRead(addr, b)) { v = 0; return false; }
        v = BitConverter.ToUInt64(b); return true;
    }
    public ulong U64(ulong addr) => TryReadU64(addr, out var v) ? v : throw new MemException(addr, 8);
    public long I64(ulong addr) => (long)U64(addr);
    public uint U32(ulong addr) { Span<byte> b = stackalloc byte[4]; if (!TryRead(addr, b)) throw new MemException(addr, 4); return BitConverter.ToUInt32(b); }
    public int I32(ulong addr) => (int)U32(addr);
    public ushort U16(ulong addr) { Span<byte> b = stackalloc byte[2]; if (!TryRead(addr, b)) throw new MemException(addr, 2); return BitConverter.ToUInt16(b); }
    public byte U8(ulong addr) { Span<byte> b = stackalloc byte[1]; if (!TryRead(addr, b)) throw new MemException(addr, 1); return b[0]; }
    public double F64(ulong addr) => BitConverter.Int64BitsToDouble(I64(addr));
    public float F32(ulong addr) => BitConverter.Int32BitsToSingle(I32(addr));
    public ulong Ptr(ulong addr) => U64(addr);

    /// Null-terminated ASCII/UTF-8 string (Il2CppClass.name etc.), bounded.
    public string? CString(ulong addr, int max = 256)
    {
        if (addr == 0) return null;
        var sb = new List<byte>(32);
        Span<byte> chunk = stackalloc byte[32];
        for (int off = 0; off < max; off += chunk.Length)
        {
            if (!TryRead(addr + (ulong)off, chunk)) return sb.Count > 0 ? Encoding.UTF8.GetString(sb.ToArray()) : null;
            foreach (var c in chunk)
            {
                if (c == 0) return Encoding.UTF8.GetString(sb.ToArray());
                sb.Add(c);
            }
        }
        return Encoding.UTF8.GetString(sb.ToArray());
    }

    /// Managed System.String: int32 length @+0x10, UTF-16 chars @+0x14.
    public string? ManagedString(ulong obj, int maxChars = 1 << 16)
    {
        if (obj == 0) return null;
        int len = I32(obj + 0x10);
        if (len < 0 || len > maxChars) throw new MemException(obj, len);
        if (len == 0) return "";
        var bytes = Read(obj + 0x14, len * 2);
        return Encoding.Unicode.GetString(bytes);
    }

    /// Cached 4K page read for scanning; null if unreadable.
    public byte[]? Page(ulong addr)
    {
        ulong page = addr & ~(ulong)(PageSize - 1);
        if (_pages.TryGetValue(page, out var cached)) return cached;
        if (_pages.Count > 4096) _pages.Clear();
        var buf = new byte[PageSize];
        var ok = TryRead(page, buf);
        _pages[page] = ok ? buf : null;
        return ok ? buf : null;
    }

    public bool TryReadU64Cached(ulong addr, out ulong v)
    {
        v = 0;
        if (addr == 0 || addr > 0x7FFFFFFFFFFF) return false;
        var pg = Page(addr);
        if (pg == null) return false;
        int off = (int)(addr & (ulong)(PageSize - 1));
        if (off + 8 > PageSize) return TryReadU64(addr, out v);
        v = BitConverter.ToUInt64(pg, off); return true;
    }

    public void Dispose() { Native.CloseHandle(_h); Proc.Dispose(); }
}

internal sealed class MemException : Exception
{
    public MemException(ulong addr, int len) : base($"unreadable memory at 0x{addr:X} ({len} bytes)") { }
}
