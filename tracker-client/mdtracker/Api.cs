using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MdTracker;

/// Thin client for the ygodecks API (JWT bearer). Synchronous on purpose — called from worker threads.
internal sealed class Api
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly Store _store;

    public Api(Store store) { _store = store; }

    private string Url(string path) => _store.Config.ServerUrl.TrimEnd('/') + path;

    private HttpRequestMessage Req(HttpMethod m, string path, string? json = null, bool auth = true)
    {
        var r = new HttpRequestMessage(m, Url(path));
        if (auth && _store.Config.Token != null) r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _store.Config.Token);
        if (json != null) r.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return r;
    }

    private (int status, string body) Send(HttpRequestMessage r)
    {
        var res = _http.SendAsync(r).GetAwaiter().GetResult();
        var body = res.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        return ((int)res.StatusCode, body);
    }

    /// Returns null on success, else an error message.
    public string? Login(string email, string password)
    {
        var body = new JsonObject { ["email"] = email, ["password"] = password }.ToJsonString();
        var (status, text) = Send(Req(HttpMethod.Post, "/api/token/", body, auth: false));
        TokenResponse? tok = null;
        try { tok = JsonSerializer.Deserialize(text, J.Default.TokenResponse); } catch { }
        if (status != 200 || tok?.Access == null) return tok?.Detail ?? $"로그인 실패 ({status})";
        _store.Config.Token = tok.Access; _store.Config.Email = email; _store.SaveConfig();
        return null;
    }

    /// POST the captured game; the server infers decks and parks it for confirmation on the record page.
    public PendingUploadResponse UploadPending(PendingMatch m)
    {
        static JsonNode? RankObj(int? rank, int? tier) => rank is int r && tier is int t ? new JsonObject { ["rank"] = r, ["tier"] = t } : null;
        var o = new JsonObject
        {
            ["did"] = m.Did,
            ["game_mode"] = m.GameMode,
            ["result"] = m.Result,
            ["finish"] = m.Finish,
            ["coin_win"] = m.CoinWin,
            ["first"] = m.First,
            ["my_id"] = m.MyId,
            ["my_name"] = m.MyName,
            ["opp_name"] = m.OppName,
            ["rank_before"] = RankObj(m.RankBefore, m.TierBefore),
            ["rank_after"] = RankObj(m.RankAfter, m.TierAfter),
            ["rank_code"] = m.RankCode,
            ["wins"] = m.Wins,
            ["rating_before"] = m.RatingBefore,
            ["rating_after"] = m.RatingAfter,
            ["turn"] = m.Turn,
            ["md_deck_id"] = m.MyMdDeckId,
            ["my_cards"] = new JsonArray(m.MyCards.Select(x => (JsonNode)x).ToArray()),
            ["opp_cards"] = new JsonArray(m.OppCards.Select(x => (JsonNode)x).ToArray()),
            ["started_at"] = m.StartedAt,
            ["ended_at"] = m.EndedAt,
        };
        var (status, text) = Send(Req(HttpMethod.Post, "/api/tracker/pending/", o.ToJsonString()));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status is not (200 or 201)) throw new Exception($"upload {status}: {(text.Length > 200 ? text[..200] : text)}");
        return JsonSerializer.Deserialize(text, J.Default.PendingUploadResponse) ?? new();
    }
}
