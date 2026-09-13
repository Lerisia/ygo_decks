using System.Text.Json;

namespace MdTracker;

/// Config + captured games, persisted under %LocalAppData%\mdtracker.
internal sealed class Store
{
    public readonly string Dir;
    public Config Config { get; private set; } = new();
    public readonly List<PendingMatch> Matches = new();
    private readonly object _lock = new();

    public Store()
    {
        Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mdtracker");
        Directory.CreateDirectory(Path.Combine(Dir, "matches"));
        var cfg = Path.Combine(Dir, "config.json");
        if (File.Exists(cfg))
            try { Config = JsonSerializer.Deserialize(File.ReadAllText(cfg), J.Default.Config) ?? new(); } catch { }
        foreach (var f in Directory.GetFiles(Path.Combine(Dir, "matches"), "*.json").OrderBy(f => f))
            try { var m = JsonSerializer.Deserialize(File.ReadAllText(f), J.Default.PendingMatch); if (m != null) Matches.Add(m); } catch { }
    }

    public void SaveConfig()
    {
        lock (_lock) File.WriteAllText(Path.Combine(Dir, "config.json"), JsonSerializer.Serialize(Config, J.Default.Config));
    }

    public void Save(PendingMatch m)
    {
        lock (_lock)
        {
            if (!Matches.Any(x => x.Did == m.Did)) Matches.Add(m);
            File.WriteAllText(Path.Combine(Dir, "matches", $"{m.Did}.json"), JsonSerializer.Serialize(m, J.Default.PendingMatch));
        }
    }

    public bool Has(string did) { lock (_lock) return Matches.Any(x => x.Did == did); }

    public List<PendingMatch> Failed() { lock (_lock) return Matches.Where(m => m.Status == "failed").ToList(); }
}
