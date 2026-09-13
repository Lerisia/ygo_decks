using System.Text;
using System.Text.Json;
using MdPeek;

const string Usage = """
mdpeek — read-only Master Duel memory inspector (no injection, no writes)

  mdpeek dump [file.json]        dump the whole ClientWork tree ($.*)
  mdpeek get <$.path> [...]      print sub-trees, e.g.  mdpeek get $.Duel $.DuelResult $.User.profile
  mdpeek keys [$.path]           list top-level keys under a path
  mdpeek duel                    show DuelClient / Engine state once
  mdpeek cards                   list card ids known to the PvP engine (opponent deck recon)
  mdpeek watch [outdir]          poll every 500 ms; log duel step changes and auto-save snapshots
                                 (default outdir: .\snapshots)
  mdpeek classes <substr>        search resolved class names (forces a full scan)
""";

Console.OutputEncoding = Encoding.UTF8;
Native.DisableQuickEdit();
if (args.Length == 0) { Console.WriteLine(Usage); return 1; }

try
{
    using var mem = Mem.Open();
    Log.Info($"masterduel pid {mem.Proc.Id}, GameAssembly.dll @0x{mem.GameAssemblyBase:X} ({mem.GameAssemblySize / 1024 / 1024} MB)");

    switch (args[0])
    {
        case "dump":
        {
            var g = new Game(mem);
            var path = args.Length > 1 ? args[1] : $"clientwork_{DateTime.Now:yyyyMMdd_HHmmss}.json";
            using var fs = File.Create(path);
            using var w = new Utf8JsonWriter(fs, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            g.IL.WriteObject(w, g.ClientWorkData);
            w.Flush();
            Log.Info($"wrote {path} ({fs.Length / 1024} KB)");
            return 0;
        }
        case "get":
        {
            var g = new Game(mem);
            var w = StdoutWriter();
            w.WriteStartObject();
            foreach (var p in args.Skip(1)) g.WritePath(w, p);
            w.WriteEndObject(); w.Flush(); Console.WriteLine();
            return 0;
        }
        case "keys":
        {
            var g = new Game(mem);
            var p = args.Length > 1 ? g.Path(args[1]) : g.ClientWorkData;
            if (p == 0) { Console.WriteLine("(missing)"); return 2; }
            foreach (var k in g.IL.DictKeys(p)) Console.WriteLine(k);
            return 0;
        }
        case "duel":
        {
            var g = new Game(mem);
            PrintDuel(g.ReadDuel());
            return 0;
        }
        case "cards":
        {
            var g = new Game(mem);
            foreach (var c in g.ReadPvpCards())
                Console.WriteLine($"player={c.com} pos={c.pos} uid={c.uid} cardId={c.cardId} face={(c.face ? "up" : "down")}");
            return 0;
        }
        case "watch":
        {
            var g = new Game(mem);
            var rest = args.Skip(1).Where(a => !a.StartsWith("--")).ToList();
            var outdir = rest.Count > 0 ? rest[0] : "snapshots";
            Directory.CreateDirectory(outdir);
            // --upload URL --key KEY --sender NAME : also POST every snapshot to the ygodecks collector endpoint
            string? url = Opt(args, "--upload"), key = Opt(args, "--key"), sender = Opt(args, "--sender") ?? Environment.UserName;
            if (url != null && key != null) { State.Uploader = new Uploader(url, key, sender); Log.Info($"uploading snapshots to {url} as '{sender}'"); }
            Watch(g, outdir);
            return 0;
        }
        case "classes":
        {
            var il = new Il2Cpp(mem);
            il.ScanAll();
            // reuse Find's cache through reflection-free path: scan again cheaply via private map is not exposed → simple approach:
            var sub = args.Length > 1 ? args[1] : "";
            foreach (var name in il.AllClassNames().Where(n => n.Contains(sub, StringComparison.OrdinalIgnoreCase)).OrderBy(n => n))
                Console.WriteLine(name);
            return 0;
        }
        default:
            Console.WriteLine(Usage); return 1;
    }
}
catch (Exception ex)
{
    Log.Info("ERROR: " + ex.Message);
    return 3;
}

static string? Opt(string[] a, string name)
{
    int i = Array.IndexOf(a, name);
    return i >= 0 && i + 1 < a.Length ? a[i + 1] : null;
}

static Utf8JsonWriter StdoutWriter() =>
    new(Console.OpenStandardOutput(), new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

static void PrintDuel(Game.DuelState? d)
{
    if (d == null) { Console.WriteLine("DuelClient.instance = null (not in a duel)"); return; }
    Console.WriteLine($"DuelClient @0x{d.Instance:X}  step={d.Step} {Enums.Step(d.Step)}  did={d.Did}");
    Console.WriteLine($"  gameMode={d.GameMode} {Enums.GameMode(d.GameMode)}  online={d.Online}  turn={d.Turn} whichTurn={d.WhichTurn}  LP=[{string.Join(",", d.LP)}]  engineMyself={d.EngineMyself} deoMyself={d.DeoMyselfId} deoRival={d.DeoRivalId}");
    Console.WriteLine($"  result={d.Result} {Enums.Result(d.Result)}  finish={d.Finish} {Enums.Finish(d.Finish)}  winMe={d.WinMe} winRival={d.WinRival}");
    Console.WriteLine($"  me='{d.Me}' ({d.PcodeMe})  rival='{d.Rival}' ({d.PcodeRival})");
}

static void Watch(Game g, string outdir)
{
    Log.Info($"watching (Ctrl+C to stop). snapshots → {Path.GetFullPath(outdir)}");
    int lastStep = -999; bool lastHasDuel = false, lastHasResult = false, wasNull = true;
    ulong lastDid = 0; uint lastTurn = 0;
    var lastDuelKeys = new HashSet<string>();
    var lastScalars = new Dictionary<string, string>();
    while (true)
    {
        try
        {
            var d = g.ReadDuel();
            ulong duelDict = g.Path("$.Duel");
            bool hasDuel = duelDict != 0;
            bool hasResult = g.Path("$.DuelResult") != 0;

            // Log every key that gets added to $.Duel (client writes coin/first-player info here during the start sequence).
            if (hasDuel)
            {
                var keys = new HashSet<string>(g.IL.DictKeys(duelDict));
                var added = keys.Except(lastDuelKeys).ToList();
                if (added.Count > 0 && lastDuelKeys.Count > 0)
                {
                    var sb = new StringBuilder();
                    foreach (var k in added)
                    {
                        var ms = new MemoryStream();
                        using (var jw = new Utf8JsonWriter(ms)) g.IL.WriteObject(jw, g.IL.DictGet(duelDict, k));
                        var s = Encoding.UTF8.GetString(ms.ToArray());
                        sb.Append($" {k}={(s.Length > 120 ? s[..120] + "…" : s)}");
                    }
                    Log.Info($"$.Duel keys added:{sb}");
                }
                lastDuelKeys = keys;
                // Scalar keys that may be rewritten in place after the coin toss / turn selection.
                foreach (var k in new[] { "choice", "Choice", "FirstPlayer", "MyType", "myid", "MyID" })
                {
                    var vp = g.IL.DictGet(duelDict, k);
                    string v = vp == 0 ? "-" : ScalarText(g, vp);
                    if (!lastScalars.TryGetValue(k, out var prev) || prev != v)
                    {
                        if (lastScalars.Count > 0 || vp != 0) Log.Info($"$.Duel.{k}: {prev ?? "(none)"} → {v}");
                        lastScalars[k] = v;
                    }
                }
            }
            else { lastDuelKeys.Clear(); lastScalars.Clear(); }

            if (d != null && d.Turn != lastTurn)
            {
                Log.Info($"turn {lastTurn} → {d.Turn}, whichTurn={d.WhichTurn} engineMyself={d.EngineMyself}, LP [{string.Join(",", d.LP)}]");
                if (d.Turn == 1) Snapshot(g, outdir, "turn1", "$.Duel");
                lastTurn = d.Turn;
            }

            if (hasDuel && !lastHasDuel) { Log.Info("$.Duel appeared → snapshot duel_begin"); Snapshot(g, outdir, "duel_begin", "$.Duel", "$.User.profile", "$.Deck.maindeck_id", "$.Deck.ratedeck_id", "$.DuelMenu.Standard", "$.DuelMenu.RateDuel", "$.DuelMenu.Cup", "$.RateDuel"); }
            if (hasResult && !lastHasResult) { Log.Info("$.DuelResult appeared → snapshot duel_result"); Snapshot(g, outdir, "duel_result", "$.DuelResult", "$.Duel", "$.User.profile", "$.DuelMenu.RateDuel", "$.DuelMenu.Cup", "$.RateDuel"); }

            if (d == null)
            {
                if (!wasNull) Log.Info("DuelClient.instance → null");
                wasNull = true; lastStep = -999;
            }
            else
            {
                if (wasNull) Log.Info($"DuelClient.instance → 0x{d.Instance:X}");
                wasNull = false;
                if (d.Step != lastStep)
                {
                    Log.Info($"step {lastStep} → {d.Step} {Enums.Step(d.Step)}  (mode {Enums.GameMode(d.GameMode)}, turn {d.Turn}, LP [{string.Join(",", d.LP)}])");
                    if (d.Step == 16) Snapshot(g, outdir, "step16", "$.Duel");
                    if (d.Step == 17 || d.Step == 19)
                    {
                        PrintDuel(d);
                        Snapshot(g, outdir, $"step{d.Step}", "$.Duel", "$.DuelResult", "$.User.profile");
                        SaveCards(g, outdir, $"step{d.Step}");
                    }
                    lastStep = d.Step;
                }
                if (d.Did != 0 && d.Did != lastDid) { Log.Info($"duel id {d.Did}"); lastDid = d.Did; }
            }
            lastHasDuel = hasDuel; lastHasResult = hasResult;
        }
        catch (Exception ex)
        {
            if (g.M.Proc.HasExited) { Log.Info("game process exited, stopping watch"); return; }
            Log.Info("read error: " + ex.Message);
        }
        Thread.Sleep(500);
    }
}

static void Snapshot(Game g, string outdir, string tag, params string[] paths)
{
    var file = Path.Combine(outdir, $"{DateTime.Now:yyyyMMdd_HHmmss}_{tag}.json");
    using (var fs = File.Create(file))
    using (var w = new Utf8JsonWriter(fs, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
    w.WriteStartObject();
    var d = g.ReadDuel();
    w.WritePropertyName("duelState");
    if (d == null) w.WriteNullValue();
    else
    {
        w.WriteStartObject();
        w.WriteNumber("step", d.Step); w.WriteString("stepName", Enums.Step(d.Step)); w.WriteNumber("did", d.Did);
        w.WriteNumber("result", d.Result); w.WriteString("resultName", Enums.Result(d.Result));
        w.WriteNumber("finish", d.Finish); w.WriteString("finishName", Enums.Finish(d.Finish));
        w.WriteString("me", d.Me); w.WriteString("rival", d.Rival); w.WriteNumber("pcodeMe", d.PcodeMe); w.WriteNumber("pcodeRival", d.PcodeRival);
        w.WriteBoolean("winMe", d.WinMe); w.WriteBoolean("winRival", d.WinRival);
        w.WriteNumber("gameMode", d.GameMode); w.WriteString("gameModeName", Enums.GameMode(d.GameMode)); w.WriteBoolean("online", d.Online);
        w.WriteNumber("turn", d.Turn); w.WriteNumber("whichTurn", d.WhichTurn);
        w.WritePropertyName("lp"); w.WriteStartArray(); foreach (var v in d.LP) w.WriteNumberValue(v); w.WriteEndArray();
        w.WriteEndObject();
        // Every card the PvP engine has registered so far (opponent cards only once revealed).
        w.WritePropertyName("pvpCards");
        w.WriteStartArray();
        foreach (var c in g.ReadPvpCards())
        {
            w.WriteStartObject();
            w.WriteNumber("player", c.pos & 0xFF); w.WriteNumber("position", (c.pos >> 8) & 0xFF); w.WriteNumber("index", c.pos >> 16);
            w.WriteNumber("uid", c.uid); w.WriteNumber("cardId", c.cardId); w.WriteBoolean("faceUp", c.face); w.WriteNumber("com", c.com);
            w.WriteEndObject();
        }
        w.WriteEndArray();
    }
    foreach (var p in paths) g.WritePath(w, p);
    w.WriteEndObject(); w.Flush();
    }
    Log.Info($"saved {file}");
    State.Uploader?.Send(tag, file);
}

static string ScalarText(Game g, ulong obj)
{
    var ms = new MemoryStream();
    using (var jw = new Utf8JsonWriter(ms)) g.IL.WriteObject(jw, obj);
    var s = Encoding.UTF8.GetString(ms.ToArray());
    return s.Length > 80 ? s[..80] + "…" : s;
}

static void SaveCards(Game g, string outdir, string tag)
{
    var cards = g.ReadPvpCards();
    var file = Path.Combine(outdir, $"{DateTime.Now:yyyyMMdd_HHmmss}_{tag}_cards.txt");
    var sb = new StringBuilder();
    foreach (var c in cards) sb.AppendLine($"player={c.com} pos={c.pos} uid={c.uid} cardId={c.cardId} face={(c.face ? "up" : "down")}");
    File.WriteAllText(file, sb.ToString());
    Log.Info($"saved {file} ({cards.Count} cards)");
}
