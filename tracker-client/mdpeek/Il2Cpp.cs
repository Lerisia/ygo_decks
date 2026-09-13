using System.Text.Json;

namespace MdPeek;

/// Il2CppClass layout (Unity 2021+, x64) — from il2cpp.h of the MD 2.8.0 dump.
internal static class ClassOff
{
    public const int Name = 0x10;          // const char*
    public const int Namespace = 0x18;     // const char*
    public const int ElementClass = 0x40;  // Il2CppClass* (arrays)
    public const int DeclaringType = 0x50;
    public const int Parent = 0x58;
    public const int Self = 0x78;          // Il2CppClass_1.klass — points back to itself
    public const int StaticFields = 0xB8;  // void*
}

/// Managed runtime layouts (stable across MD versions; BCL, not game code).
internal static class Rt
{
    public const int ObjHeader = 0x10;          // klass, monitor
    public const int StrLen = 0x10, StrChars = 0x14;
    public const int ArrLen = 0x18, ArrItems = 0x20;
    public const int DictEntries = 0x18, DictCount = 0x20;
    public const int DictEntrySize = 0x18, DictEntryKey = 0x8, DictEntryValue = 0x10;
    public const int ListItems = 0x10, ListSize = 0x18;
}

internal sealed class Il2CppClassInfo
{
    public ulong Ptr;
    public string Name = "";
    public string Namespace = "";
    public ulong StaticFields;
    public override string ToString() => Namespace.Length > 0 ? $"{Namespace}.{Name}" : Name;
}

internal sealed class Il2Cpp
{
    private readonly Mem _m;
    private readonly Dictionary<ulong, Il2CppClassInfo?> _classCache = new();
    private readonly Dictionary<string, Il2CppClassInfo> _byName = new();
    private bool _scanned;

    public Il2Cpp(Mem m) { _m = m; }

    /// Read class header at ptr; null if it doesn't look like an Il2CppClass.
    public Il2CppClassInfo? ClassAt(ulong klass)
    {
        if (klass == 0) return null;
        if (_classCache.TryGetValue(klass, out var c)) return c;
        Il2CppClassInfo? info = null;
        if (_m.TryReadU64Cached(klass + ClassOff.Self, out var self) && self == klass)
        {
            if (_m.TryReadU64Cached(klass + ClassOff.Name, out var np) && _m.TryReadU64Cached(klass + ClassOff.Namespace, out var nsp))
            {
                var name = _m.CString(np, 200);
                var ns = _m.CString(nsp, 200);
                if (name != null && name.Length > 0 && ns != null)
                {
                    _m.TryReadU64Cached(klass + ClassOff.StaticFields, out var sf);
                    info = new Il2CppClassInfo { Ptr = klass, Name = name, Namespace = ns, StaticFields = sf };
                }
            }
        }
        _classCache[klass] = info;
        return info;
    }

    public Il2CppClassInfo? ClassOf(ulong obj)
    {
        if (!_m.TryReadU64(obj, out var k)) return null;
        return ClassAt(k);
    }

    /// Find a top-level class by "Namespace.Name" (namespace may be empty: "DuelStartViewController").
    /// Fast path: known TypeInfo slots for this build; otherwise scan GameAssembly's writable sections
    /// for pointers to self-referencing Il2CppClass structs.
    public Il2CppClassInfo Find(string fullName, IEnumerable<ulong>? knownSlotRvas = null)
    {
        if (_byName.TryGetValue(fullName, out var hit)) return hit;
        if (knownSlotRvas != null)
            foreach (var rva in knownSlotRvas)
            {
                if (!_m.TryReadU64(_m.GameAssemblyBase + rva, out var kp)) continue;
                var c = ClassAt(kp);
                if (c != null && c.ToString() == fullName) { _byName[fullName] = c; return c; }
            }
        ScanAll();
        if (_byName.TryGetValue(fullName, out hit)) return hit;
        throw new Exception($"class {fullName} not found (game version changed? re-run Il2CppDumper)");
    }

    /// Scan every writable PE section of GameAssembly.dll for qwords that point to Il2CppClass structs.
    public void ScanAll()
    {
        if (_scanned) return;
        _scanned = true;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        int found = 0;
        foreach (var (start, size) in WritableSections())
        {
            const int chunk = 1 << 20;
            for (ulong off = 0; off < (ulong)size; off += chunk)
            {
                int n = (int)Math.Min(chunk, (ulong)size - off);
                var buf = new byte[n];
                if (!_m.TryRead(start + off, buf)) continue;
                for (int i = 0; i + 8 <= n; i += 8)
                {
                    ulong q = BitConverter.ToUInt64(buf, i);
                    if (q < 0x10000 || q > 0x7FFFFFFFFFFF || (q & 7) != 0) continue;
                    var c = ClassAt(q);
                    if (c == null) continue;
                    var key = c.ToString();
                    if (!_byName.ContainsKey(key)) { _byName[key] = c; found++; }
                }
            }
        }
        Log.Info($"class scan: {found} classes in {sw.ElapsedMilliseconds} ms");
    }

    public IEnumerable<string> AllClassNames() => _byName.Keys;

    private IEnumerable<(ulong start, int size)> WritableSections()
    {
        ulong b = _m.GameAssemblyBase;
        int e_lfanew = _m.I32(b + 0x3C);
        ulong nt = b + (ulong)e_lfanew;
        ushort numSections = _m.U16(nt + 6);
        ushort optSize = _m.U16(nt + 20);
        ulong sec = nt + 24 + optSize;
        for (int i = 0; i < numSections; i++)
        {
            ulong s = sec + (ulong)(i * 40);
            uint vsize = _m.U32(s + 8), vaddr = _m.U32(s + 12), chars = _m.U32(s + 36);
            const uint IMAGE_SCN_MEM_WRITE = 0x80000000;
            if ((chars & IMAGE_SCN_MEM_WRITE) != 0 && vsize > 0)
                yield return (b + vaddr, (int)vsize);
        }
    }

    // ---------- object graph → JSON ----------

    public void WriteObject(Utf8JsonWriter w, ulong obj, int depth = 0, HashSet<ulong>? seen = null)
    {
        seen ??= new HashSet<ulong>();
        if (obj == 0) { w.WriteNullValue(); return; }
        if (depth > 40) { w.WriteStringValue("<depth>"); return; }
        Il2CppClassInfo? c;
        try { c = ClassOf(obj); } catch { c = null; }
        if (c == null) { w.WriteStringValue($"<bad 0x{obj:X}>"); return; }
        try
        {
            switch (c.Name)
            {
                case "String": w.WriteStringValue(_m.ManagedString(obj)); return;
                case "Int32": w.WriteNumberValue(_m.I32(obj + Rt.ObjHeader)); return;
                case "UInt32": w.WriteNumberValue(_m.U32(obj + Rt.ObjHeader)); return;
                case "Int64": w.WriteNumberValue(_m.I64(obj + Rt.ObjHeader)); return;
                case "UInt64": w.WriteNumberValue(_m.U64(obj + Rt.ObjHeader)); return;
                case "Int16": w.WriteNumberValue((short)_m.U16(obj + Rt.ObjHeader)); return;
                case "UInt16": w.WriteNumberValue(_m.U16(obj + Rt.ObjHeader)); return;
                case "Byte": w.WriteNumberValue(_m.U8(obj + Rt.ObjHeader)); return;
                case "SByte": w.WriteNumberValue((sbyte)_m.U8(obj + Rt.ObjHeader)); return;
                case "Boolean": w.WriteBooleanValue(_m.U8(obj + Rt.ObjHeader) != 0); return;
                case "Double": w.WriteNumberValue(_m.F64(obj + Rt.ObjHeader)); return;
                case "Single": w.WriteNumberValue(_m.F32(obj + Rt.ObjHeader)); return;
            }
            if (!seen.Add(obj)) { w.WriteStringValue($"<cycle 0x{obj:X}>"); return; }
            if (c.Name == "Dictionary`2") { WriteDictionary(w, obj, depth, seen); return; }
            if (c.Name == "List`1") { WriteList(w, obj, depth, seen); return; }
            if (c.Name.EndsWith("[]")) { WriteArray(w, obj, c, depth, seen); return; }
            w.WriteStartObject();
            w.WriteString("$type", c.ToString());
            w.WriteString("$ptr", $"0x{obj:X}");
            w.WriteEndObject();
        }
        catch (Exception ex) { w.WriteStringValue($"<err {ex.Message}>"); }
    }

    private void WriteDictionary(Utf8JsonWriter w, ulong dict, int depth, HashSet<ulong> seen)
    {
        ulong entries = _m.Ptr(dict + Rt.DictEntries);
        int count = _m.I32(dict + Rt.DictCount);
        w.WriteStartObject();
        if (entries != 0 && count > 0)
        {
            int len = _m.I32(entries + Rt.ArrLen);
            count = Math.Min(count, len);
            var raw = _m.Read(entries + Rt.ArrItems, count * Rt.DictEntrySize);
            for (int i = 0; i < count; i++)
            {
                ulong key = BitConverter.ToUInt64(raw, i * Rt.DictEntrySize + Rt.DictEntryKey);
                ulong val = BitConverter.ToUInt64(raw, i * Rt.DictEntrySize + Rt.DictEntryValue);
                if (key == 0) continue; // free slot
                string k;
                var kc = ClassOf(key);
                if (kc?.Name == "String") k = _m.ManagedString(key) ?? "";
                else k = ScalarToString(key, kc);
                w.WritePropertyName(k);
                WriteObject(w, val, depth + 1, seen);
            }
        }
        w.WriteEndObject();
    }

    private string ScalarToString(ulong obj, Il2CppClassInfo? c)
    {
        if (c == null) return $"0x{obj:X}";
        return c.Name switch
        {
            "Int32" => _m.I32(obj + Rt.ObjHeader).ToString(),
            "Int64" => _m.I64(obj + Rt.ObjHeader).ToString(),
            "UInt32" => _m.U32(obj + Rt.ObjHeader).ToString(),
            _ => $"<{c.Name} 0x{obj:X}>",
        };
    }

    private void WriteList(Utf8JsonWriter w, ulong list, int depth, HashSet<ulong> seen)
    {
        ulong items = _m.Ptr(list + Rt.ListItems);
        int size = _m.I32(list + Rt.ListSize);
        w.WriteStartArray();
        if (items != 0 && size > 0)
        {
            var ic = ClassOf(items);
            WriteArrayItems(w, items, ic, size, depth, seen);
        }
        w.WriteEndArray();
    }

    private void WriteArray(Utf8JsonWriter w, ulong arr, Il2CppClassInfo c, int depth, HashSet<ulong> seen)
    {
        int len = _m.I32(arr + Rt.ArrLen);
        w.WriteStartArray();
        WriteArrayItems(w, arr, c, len, depth, seen);
        w.WriteEndArray();
    }

    private void WriteArrayItems(Utf8JsonWriter w, ulong arr, Il2CppClassInfo? arrClass, int n, int depth, HashSet<ulong> seen)
    {
        n = Math.Min(n, 1 << 16);
        string elem = "";
        if (arrClass != null && _m.TryReadU64Cached(arrClass.Ptr + ClassOff.ElementClass, out var ep))
            elem = ClassAt(ep)?.Name ?? "";
        ulong basePtr = arr + Rt.ArrItems;
        switch (elem)
        {
            case "Int32": foreach (var v in Values(basePtr, n, 4)) w.WriteNumberValue(BitConverter.ToInt32(v)); return;
            case "UInt32": foreach (var v in Values(basePtr, n, 4)) w.WriteNumberValue(BitConverter.ToUInt32(v)); return;
            case "Int64": foreach (var v in Values(basePtr, n, 8)) w.WriteNumberValue(BitConverter.ToInt64(v)); return;
            case "UInt16": foreach (var v in Values(basePtr, n, 2)) w.WriteNumberValue(BitConverter.ToUInt16(v)); return;
            case "Int16": foreach (var v in Values(basePtr, n, 2)) w.WriteNumberValue(BitConverter.ToInt16(v)); return;
            case "Byte": foreach (var v in Values(basePtr, n, 1)) w.WriteNumberValue(v[0]); return;
            case "Boolean": foreach (var v in Values(basePtr, n, 1)) w.WriteBooleanValue(v[0] != 0); return;
            case "Single": foreach (var v in Values(basePtr, n, 4)) w.WriteNumberValue(BitConverter.ToSingle(v)); return;
            case "Double": foreach (var v in Values(basePtr, n, 8)) w.WriteNumberValue(BitConverter.ToDouble(v)); return;
        }
        var raw = _m.Read(basePtr, n * 8);
        for (int i = 0; i < n; i++) WriteObject(w, BitConverter.ToUInt64(raw, i * 8), depth + 1, seen);
    }

    private IEnumerable<byte[]> Values(ulong basePtr, int n, int size)
    {
        var raw = _m.Read(basePtr, n * size);
        for (int i = 0; i < n; i++) yield return raw.AsSpan(i * size, size).ToArray();
    }

    /// Resolve a "$.A.B.C" path inside a Dictionary<string,object> tree. Returns 0 if missing.
    public ulong Resolve(ulong root, string jsonPath)
    {
        var parts = jsonPath.TrimStart('$').Trim('.').Split('.', StringSplitOptions.RemoveEmptyEntries);
        ulong cur = root;
        foreach (var p in parts)
        {
            if (cur == 0) return 0;
            var c = ClassOf(cur);
            if (c?.Name != "Dictionary`2") return 0;
            cur = DictGet(cur, p);
        }
        return cur;
    }

    public ulong DictGet(ulong dict, string key)
    {
        ulong entries = _m.Ptr(dict + Rt.DictEntries);
        int count = _m.I32(dict + Rt.DictCount);
        if (entries == 0 || count <= 0) return 0;
        count = Math.Min(count, _m.I32(entries + Rt.ArrLen));
        var raw = _m.Read(entries + Rt.ArrItems, count * Rt.DictEntrySize);
        for (int i = 0; i < count; i++)
        {
            ulong k = BitConverter.ToUInt64(raw, i * Rt.DictEntrySize + Rt.DictEntryKey);
            if (k == 0) continue;
            if (ClassOf(k)?.Name == "String" && _m.ManagedString(k) == key)
                return BitConverter.ToUInt64(raw, i * Rt.DictEntrySize + Rt.DictEntryValue);
        }
        return 0;
    }

    public IEnumerable<string> DictKeys(ulong dict)
    {
        ulong entries = _m.Ptr(dict + Rt.DictEntries);
        int count = _m.I32(dict + Rt.DictCount);
        if (entries == 0 || count <= 0) yield break;
        count = Math.Min(count, _m.I32(entries + Rt.ArrLen));
        var raw = _m.Read(entries + Rt.ArrItems, count * Rt.DictEntrySize);
        for (int i = 0; i < count; i++)
        {
            ulong k = BitConverter.ToUInt64(raw, i * Rt.DictEntrySize + Rt.DictEntryKey);
            if (k != 0 && ClassOf(k)?.Name == "String") yield return _m.ManagedString(k) ?? "";
        }
    }
}

internal static class Log
{
    // Recent lines are attached to uploaded snapshots so the server sees the same trace as the console.
    private static readonly List<string> _buf = new();
    public static Action<string>? Sink;
    public static void Info(string s)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {s}";
        Console.Error.WriteLine(line);
        Sink?.Invoke(line);
        lock (_buf) { _buf.Add(line); if (_buf.Count > 500) _buf.RemoveRange(0, _buf.Count - 500); }
    }
    public static List<string> Drain() { lock (_buf) { var l = new List<string>(_buf); _buf.Clear(); return l; } }
    public static List<string> Tail(int n) { lock (_buf) { return _buf.Skip(Math.Max(0, _buf.Count - n)).ToList(); } }
}
