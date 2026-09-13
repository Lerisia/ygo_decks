using System.Net.Http.Headers;
using System.Text.Json;

namespace MdPeek;

internal static class State
{
    public static Uploader? Uploader;
}

/// Posts saved snapshots to the ygodecks collector endpoint (research builds only).
/// Strips match-server tokens before sending. Uses JsonDocument/Utf8JsonWriter only (trim-safe, no reflection).
internal sealed class Uploader
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly string _url, _sender;
    private static readonly HashSet<string> Strip = new() { "match", "duel", "RandSeed" };

    public Uploader(string url, string key, string sender)
    {
        _url = url; _sender = sender;
        _http.DefaultRequestHeaders.Add("X-Tracker-Key", key);
    }

    public void Send(string tag, string file)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(file));
            var ms = new MemoryStream();
            using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            {
                w.WriteStartObject();
                w.WriteString("tag", tag);
                w.WriteString("sender", _sender);
                w.WriteString("client", "mdpeek");
                w.WritePropertyName("log");
                w.WriteStartArray();
                foreach (var l in Log.Drain()) w.WriteStringValue(l);
                w.WriteEndArray();
                w.WritePropertyName("data");
                WriteStripped(w, doc.RootElement);
                w.WriteEndObject();
            }
            var content = new ByteArrayContent(ms.ToArray());
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            var res = _http.PostAsync(_url, content).GetAwaiter().GetResult();
            Log.Info(res.IsSuccessStatusCode ? $"uploaded {tag}" : $"upload failed: {(int)res.StatusCode} {res.ReasonPhrase}");
        }
        catch (Exception ex) { Log.Info("upload error: " + ex.Message); }
    }

    private static void WriteStripped(Utf8JsonWriter w, JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) { root.WriteTo(w); return; }
        w.WriteStartObject();
        foreach (var p in root.EnumerateObject())
        {
            w.WritePropertyName(p.Name);
            if (p.Name == "$.Duel" && p.Value.ValueKind == JsonValueKind.Object)
            {
                w.WriteStartObject();
                foreach (var q in p.Value.EnumerateObject())
                    if (!Strip.Contains(q.Name)) { w.WritePropertyName(q.Name); q.Value.WriteTo(w); }
                w.WriteEndObject();
            }
            else p.Value.WriteTo(w);
        }
        w.WriteEndObject();
    }
}
