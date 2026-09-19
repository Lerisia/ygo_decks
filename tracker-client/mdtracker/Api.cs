using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MdTracker;

/// Thin client for the ygodecks API (JWT bearer). Synchronous on purpose — called from worker threads.
public sealed class Api
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly Store _store;

    public Api(Store store) { _store = store; }

    private string Url(string path) => _store.Config.ServerUrl.TrimEnd('/') + path;

    // ---- research feed ----
    private static readonly string? SnapshotKey = ReadSnapshotKey();
    private static string? ReadSnapshotKey()
    {
        try
        {
            using var st = typeof(Api).Assembly.GetManifestResourceStream("snapshot.key");
            if (st == null) return null;
            using var r = new System.IO.StreamReader(st);
            var k = r.ReadToEnd().Trim();
            return k.Length > 0 ? k : null;
        }
        catch { return null; }
    }

    /// Clock/turn samples from one duel → the site's snapshot store (keyed, no login), to pin down how the
    /// engine's TimeLeft maps onto each player before the remaining-time display is built.
    public void UploadProbe(PendingMatch m)
    {
        if (SnapshotKey == null) return;
        var samples = new JsonArray(m.TimeProbe.Select(s => (JsonNode)new JsonObject
        {
            ["t"] = Math.Round(s.T, 1), ["step"] = s.Step, ["turn"] = s.Turn, ["which"] = s.Which, ["guard"] = s.Guard,
            ["left"] = s.Left, ["total"] = s.Total, ["lp"] = s.Lp,
            ["ui_input"] = s.UiInput, ["ui_duel"] = s.UiDuel, ["ui_turn"] = s.UiTurn, ["run_eff"] = s.RunEff, ["cur_eff"] = s.CurEff,
        }).ToArray());
        var o = new JsonObject
        {
            ["tag"] = "timeprobe", ["sender"] = _store.Config.Email ?? "anon", ["version"] = App.Version,
            ["did"] = m.Did, ["myid"] = m.MyId, ["first"] = m.First, ["turn"] = m.Turn, ["result"] = m.Result, ["finish"] = m.Finish,
            ["samples"] = samples,
            ["my_cards"] = new JsonArray(m.MyCards.Select(x => (JsonNode)x).ToArray()),
            ["my_extra"] = new JsonArray(m.MyExtraCards.Select(x => (JsonNode)x).ToArray()),
            ["final_cards"] = new JsonArray(m.FinalCards.Select(c => (JsonNode)new JsonObject { ["me"] = c.Me, ["zone"] = c.Zone, ["id"] = c.Id, ["face"] = c.Face, ["uid"] = c.Uid }).ToArray()),
            ["log_uids"] = new JsonObject(m.FinalLogUids.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key.ToString(), kv.Value))),
            ["reveals"] = new JsonArray(m.RevealLog.Select(x => (JsonNode)x).ToArray()),
            ["table_log"] = new JsonArray(m.TableLog.Select(x => (JsonNode)x).ToArray()),
            ["list_log"] = new JsonArray(m.ListLog.Select(x => (JsonNode)x).ToArray()),
            ["table_stats"] = new JsonArray(m.TableStats.Select(x => (JsonNode)x).ToArray()),
        };
        var r = Req(HttpMethod.Post, "/api/tracker/snapshot/", o.ToJsonString(), auth: false);
        r.Headers.Add("X-Tracker-Key", SnapshotKey);
        var (status, _) = Send(r);
        if (status is not (200 or 201)) throw new Exception($"snapshot {status}");
    }

    private HttpRequestMessage Req(HttpMethod m, string path, string? json = null, bool auth = true)
    {
        var r = new HttpRequestMessage(m, Url(path));
        r.Headers.Add("X-Tracker-Version", App.Version);
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

    private static T? SafeParse<T>(string text, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> ti) where T : class
    {
        try { return JsonSerializer.Deserialize(text, ti); } catch { return null; }
    }

    /// Returns null on success, else an error message.
    public string? Login(string email, string password)
    {
        var body = new JsonObject { ["email"] = email, ["password"] = password }.ToJsonString();
        var (status, text) = Send(Req(HttpMethod.Post, "/api/token/", body, auth: false));
        var tok = SafeParse(text, J.Default.TokenResponse);
        if (status != 200 || tok?.Access == null) return tok?.Detail ?? $"로그인 실패 ({status})";
        _store.Config.Token = tok.Access; _store.Config.Email = email; _store.SaveConfig();
        return null;
    }

    /// What the server says the current build is (used to nudge users running an old exe).
    public VersionResponse? LatestVersion()
    {
        var (status, text) = Send(Req(HttpMethod.Get, "/api/tracker/version/", auth: false));
        return status == 200 ? SafeParse(text, J.Default.VersionResponse) : null;
    }

    /// This user's record with the deck, and against one opponent deck when given.
    public MatchupResponse? Matchup(int deckId, int? oppDeckId)
    {
        var path = $"/api/tracker/matchup/?deck={deckId}" + (oppDeckId.HasValue ? $"&opponent={oppDeckId.Value}" : "");
        var (status, text) = Send(Req(HttpMethod.Get, path));
        if (status == 401) throw new UnauthorizedAccessException();
        return status == 200 ? SafeParse(text, J.Default.MatchupResponse) : null;
    }

    public TodayResponse? Today(int? deck = null)
    {
        var (status, text) = Send(Req(HttpMethod.Get, deck == null ? "/api/tracker/today/" : $"/api/tracker/today/?deck={deck}"));
        if (status == 401) throw new UnauthorizedAccessException();
        return status == 200 ? SafeParse(text, J.Default.TodayResponse) : null;
    }

    public List<RecordGroup> Groups()
    {
        var (status, text) = Send(Req(HttpMethod.Get, "/api/record-groups/"));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status != 200) throw new Exception($"record-groups {status}");
        return JsonSerializer.Deserialize(text, J.Default.ListRecordGroup) ?? new();
    }

    public RecordGroup CreateGroup(string name)
    {
        var body = new JsonObject { ["name"] = name }.ToJsonString();
        var (status, text) = Send(Req(HttpMethod.Post, "/api/record-groups/create/", body));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status is not (200 or 201)) throw new Exception($"시트 만들기 실패 ({status})");
        var doc = JsonDocument.Parse(text).RootElement;
        int id = doc.TryGetProperty("id", out var idp) ? idp.GetInt32() : 0;
        if (id == 0) { var g = Groups().FirstOrDefault(x => x.Name == name); if (g != null) return g; throw new Exception("시트 id 없음"); }
        return new RecordGroup { Id = id, Name = name };
    }

    public List<SiteDeck> Decks()
    {
        var (status, text) = Send(Req(HttpMethod.Get, "/api/deck/", auth: false));
        if (status != 200) throw new Exception($"deck list {status}");
        return JsonSerializer.Deserialize(text, J.Default.DecksResponse)?.Decks ?? new();
    }

    public InferResponse Infer(List<int> my, List<int> opp)
    {
        var body = new JsonObject { ["my_cards"] = new JsonArray(my.Select(x => (JsonNode)x).ToArray()), ["opp_cards"] = new JsonArray(opp.Select(x => (JsonNode)x).ToArray()) }.ToJsonString();
        var (status, text) = Send(Req(HttpMethod.Post, "/api/tracker/infer/", body));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status != 200) throw new Exception($"infer {status}");
        return JsonSerializer.Deserialize(text, J.Default.InferResponse) ?? new();
    }

    /// Creates the record; returns (match id, points awarded) or throws with the server's message.
    /// Edit a saved record in place. The site never re-awards points on edits.
    public void UpdateMatch(int matchId, int deckId, int? oppDeckId, string first, string result, string coin, string? notes)
    {
        var o = new JsonObject
        {
            ["deck"] = deckId, ["opponent_deck"] = oppDeckId.HasValue ? oppDeckId.Value : null,
            ["first_or_second"] = first, ["result"] = result, ["coin_toss_result"] = coin, ["notes"] = notes,
        };
        var (status, _) = Send(Req(HttpMethod.Patch, $"/api/match-records/{matchId}/update/", o.ToJsonString()));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status != 200) throw new Exception($"update {status}");
    }

    public (int id, int points) AddMatch(int groupId, PendingMatch m, int deckId, int? oppDeckId, string? notes)
    {
        bool rate = m.GameMode == 19;
        var o = new JsonObject
        {
            ["deck"] = deckId,
            ["opponent_deck"] = oppDeckId.HasValue ? oppDeckId.Value : null,
            ["first_or_second"] = m.First ? "first" : "second",
            ["result"] = m.Result == "lose" ? "lose" : "win",
            ["coin_toss_result"] = m.CoinWin ? "win" : "lose",
            ["rank"] = rate ? null : m.RankCode,
            ["wins"] = rate ? null : m.Wins,
            ["score"] = rate && m.RatingAfter is double r ? (int)Math.Round(r) : null,
            ["score_type"] = rate ? "rating" : null,
            ["notes"] = string.IsNullOrWhiteSpace(notes) ? null : notes,
            ["tracker_did"] = m.Did,
        };
        var (status, text) = Send(Req(HttpMethod.Post, $"/api/record-groups/{groupId}/add-match/", o.ToJsonString()));
        if (status == 401) throw new UnauthorizedAccessException();
        var res = SafeParse(text, J.Default.AddMatchResponse);
        if (status != 201 || res?.MatchId == null) throw new Exception(res?.Error?.ToString() ?? $"add-match {status}: {text}");
        return (res.MatchId.Value, res.PointsAdded);
    }

    private static JsonNode? RankObj(int? rank, int? tier) => rank is int r && tier is int t ? new JsonObject { ["rank"] = r, ["tier"] = t } : null;

    /// Archive the raw capture (full decklist + revealed opponent cards) — sent for every game, confirmed or not.
    public void UploadGame(PendingMatch m)
    {
        var opp = new JsonArray(m.OppCardDetails.Select(c => (JsonNode)new JsonObject { ["id"] = c.Id, ["pos"] = c.Pos, ["face"] = c.Face }).ToArray());
        if (m.OppCardDetails.Count == 0) opp = new JsonArray(m.OppCards.Select(x => (JsonNode)x).ToArray());
        var o = new JsonObject
        {
            ["did"] = m.Did, ["game_mode"] = m.GameMode, ["result"] = m.Result, ["finish"] = m.Finish,
            ["coin_win"] = m.CoinWin, ["first"] = m.First, ["my_name"] = m.MyName, ["opp_name"] = m.OppName,
            ["rank_before"] = RankObj(m.RankBefore, m.TierBefore), ["rank_after"] = RankObj(m.RankAfter, m.TierAfter),
            ["rank_code"] = m.RankCode, ["wins"] = m.Wins, ["rating_before"] = m.RatingBefore, ["rating_after"] = m.RatingAfter,
            ["turn"] = m.Turn, ["md_deck_id"] = m.MyMdDeckId,
            ["my_cards"] = new JsonArray(m.MyCards.Select(x => (JsonNode)x).ToArray()),
            ["opp_cards"] = opp,
            ["started_at"] = m.StartedAt, ["ended_at"] = m.EndedAt,
            ["turn_times"] = new JsonArray(m.TurnTimes.Select(t => (JsonNode)new JsonObject { ["turn"] = t.Turn, ["me"] = t.Me, ["sec"] = t.Sec }).ToArray()),
            ["paused"] = m.Paused,
            ["list_log"] = new JsonArray(m.ListLog.Select(x => (JsonNode)x).ToArray()),
        };
        var (status, text) = Send(Req(HttpMethod.Post, "/api/tracker/games/", o.ToJsonString()));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status is not (200 or 201)) throw new Exception($"games {status}");
    }

    /// Park the game on the site ("확인 대기") instead of saving now.
    public int UploadPending(PendingMatch m)
    {
        var o = new JsonObject
        {
            ["did"] = m.Did, ["game_mode"] = m.GameMode, ["result"] = m.Result, ["finish"] = m.Finish,
            ["coin_win"] = m.CoinWin, ["first"] = m.First, ["my_id"] = m.MyId, ["my_name"] = m.MyName, ["opp_name"] = m.OppName,
            ["rank_before"] = RankObj(m.RankBefore, m.TierBefore), ["rank_after"] = RankObj(m.RankAfter, m.TierAfter),
            ["rank_code"] = m.RankCode, ["wins"] = m.Wins, ["rating_before"] = m.RatingBefore, ["rating_after"] = m.RatingAfter,
            ["turn"] = m.Turn, ["md_deck_id"] = m.MyMdDeckId,
            ["my_cards"] = new JsonArray(m.MyCards.Select(x => (JsonNode)x).ToArray()),
            ["opp_cards"] = new JsonArray(m.OppCards.Select(x => (JsonNode)x).ToArray()),
            ["started_at"] = m.StartedAt, ["ended_at"] = m.EndedAt,
        };
        var (status, text) = Send(Req(HttpMethod.Post, "/api/tracker/pending/", o.ToJsonString()));
        if (status == 401) throw new UnauthorizedAccessException();
        if (status is not (200 or 201)) throw new Exception($"pending {status}");
        return JsonSerializer.Deserialize(text, J.Default.PendingUploadResponse)?.Id ?? 0;
    }
}
