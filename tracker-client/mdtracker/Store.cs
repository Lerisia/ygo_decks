using System.IO;
using System.Text.Json;

namespace MdTracker;

/// Config + captured games, persisted under %LocalAppData%\mdtracker.
public sealed class Store
{
    public readonly string Dir;
    public Config Config { get; private set; } = new();
    public readonly List<PendingMatch> Matches = new();
    public List<SiteDeck> Decks = new();
    public DateTime DecksLoadedAt = DateTime.MinValue;
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
        var decks = Path.Combine(Dir, "decks.json");
        if (File.Exists(decks))
            try { Decks = JsonSerializer.Deserialize(File.ReadAllText(decks), J.Default.DecksResponse)?.Decks ?? new(); DecksLoadedAt = File.GetLastWriteTime(decks); } catch { }
    }

    public void SaveConfig()
    {
        lock (_lock) File.WriteAllText(Path.Combine(Dir, "config.json"), JsonSerializer.Serialize(Config, J.Default.Config));
    }

    public void SaveDecks(List<SiteDeck> decks)
    {
        Decks = decks; DecksLoadedAt = DateTime.Now;
        lock (_lock) File.WriteAllText(Path.Combine(Dir, "decks.json"), JsonSerializer.Serialize(new DecksResponse { Decks = decks }, J.Default.DecksResponse));
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

    public List<PendingMatch> Recent(int n = 20)
    {
        lock (_lock) return Matches.OrderByDescending(m => m.EndedAt).Take(n).ToList();
    }

    public string LogPath => Path.Combine(Dir, "tracker.log");
}
