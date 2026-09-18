using System.Text.Json;

namespace MdPeek;

/// Field offsets from the MD 2.8.0 (Steam, 2026-09-13) Il2CppDumper dump.
/// Class *addresses* are resolved by name at runtime; only these field offsets need re-checking after a game update.
internal static class Off
{
    // TypeInfo slot RVAs for 2.8.0 (fast path only; name scan is the fallback)
    public static readonly ulong[] ClientWorkSlots = { 0x3A930C0 };
    public static readonly ulong[] DuelClientSlots = { 0x3AB0B40 };
    public static readonly ulong[] EngineSlots = { 0x3ABCF30 };

    // static fields
    public const int ClientWork_s_data = 0x8;
    public const int DuelClient_instance = 0x0, DuelClient_cursor = 0x8;
    // DuelCursor.selectLocation → LocationInfo: where the in-game cursor is pointing
    public const int DCU_selectLocation = 0x10, LI_player = 0x10, LI_position = 0x14, LI_index = 0x18;
    public const int Engine_s_instance = 0x8;

    // DuelClient
    public const int DC_m_Step = 0x1C4;
    public const int DC_dicResult = 0x1D0;
    public const int DC_resultSending = 0x1D8, DC_resultSended = 0x1D9;
    public const int DC_duelEndOperation = 0x1F0;
    public const int DC_did = 0x208;
    public const int DC_pvpProgress = 0xEA;
    // DuelClient.duelHUD → DuelHUD.duellog → DuelLogController.m_UidCardidTable (Dictionary<int,int>: card uid → card id,
    // filled by every reveal the log shows — hand opens, searches, flips)
    public const int DC_duelHUD = 0xC8, HUD_duellog = 0x170, DLC_uidCardidTable = 0xB8;

    // DuelEndOperation
    public const int DEO_resultType = 0x28, DEO_finishType = 0x2C;
    public const int DEO_userNameMyself = 0x40, DEO_userNameRival = 0x48;
    public const int DEO_myselfid = 0x60, DEO_rivalid = 0x64;
    public const int DEO_isOnlineMode = 0x90, DEO_winMyself = 0x94, DEO_winRival = 0x95;
    public const int DEO_pcodeMyself = 0xA0, DEO_pcodeRival = 0xA8;

    // Engine
    public const int EN_cachedParam = 0x10;      // CachedParam: myself @+0x10
    public const int EN_isOnlineMode = 0xC9, EN_gameMode = 0xCC;
    public const int EN_pvpWork = 0x118, EN_pvpFinished = 0x120;
    public const int PW_currentEngineData = 0x18, PW_RunningEffect = 0x60, PW_CurrentRunEffect = 0x64, PW_TimeLeft = 0x70, PW_TimeTotal = 0x74, PW_inputGuard = 0x78;
    public const int PED_duelInfo = 0x10, PED_posTbl = 0x18, PED_uidTbl = 0x20, PED_uidBases = 0x28;
    public const int PDI_nTurnNum = 0x14, PDI_bWhichTurnNow = 0x24, PDI_nLP = 0x30;
    public const int UID_nCom = 0x10, UID_nPos = 0x14, UID_wUid = 0x18, UID_cardId = 0x1A, UID_isFace = 0x20;

    // On-screen timer: TutorialUtil.goManager (static) → DuelGameObjectManager.duelTimer → DuelTimer3D
    public const int TU_goManager = 0x40, GOM_duelTimer = 0x90;
    public const int DT_maxDuelTime = 0x60, DT_maxTurnTime = 0x68, DT_isPlayerInput = 0x70, DT_remainInDuel = 0x74, DT_remainInTurn = 0x78;
}

internal static class Enums
{
    public static string Step(int v) => v switch
    {
        0 => "InitLoadRes", 1 => "WaitLoadRes", 2 => "InitializeProcess", 3 => "FinishInitialize", 4 => "WaitConnecting",
        5 => "InitEngine", 6 => "InitSound", 7 => "WaitSound", 8 => "InitLoadSound", 9 => "WaitLoadSound", 10 => "WaitGameObjectInit",
        11 => "PrepareProcess", 12 => "FinishPrepare", 13 => "WaitCameraWork", 14 => "ShowUpDuel", 15 => "WaitShowUp",
        16 => "ExecDuel", 17 => "EndDuel", 18 => "WaitEndNetwork", 19 => "DuelEnd", 20 => "InitTerm", 21 => "WaitEndViewClose",
        22 => "WaitTerm", 23 => "End", 24 => "WaitDestroy", 25 => "ConnectingError", 26 => "Beginning", _ => $"?{v}",
    };
    public static string Result(int v) => v switch { 0 => "None", 1 => "Win", 2 => "Lose", 3 => "Draw", 4 => "Time", _ => $"?{v}" };
    public static string Finish(int v) => v switch
    {
        0 => "None", 1 => "Normal", 2 => "NoDeck", 3 => "TimeOut", 4 => "Surrender", 5 => "Failed", 6 => "Exodia",
        100 => "FinishError", 101 => "FinishDisconnect", 102 => "FinishNoContest", 105 => "FinishEngineCrash", _ => $"special{v}",
    };
    public static string GameMode(int v) => v switch
    {
        0 => "Normal", 1 => "Free", 2 => "Single", 3 => "Rank", 4 => "Tournament", 5 => "TournamentSingle", 6 => "Audience",
        7 => "Replay", 8 => "RankSingle", 9 => "SoloSingle", 10 => "Room", 11 => "Exhibition", 12 => "DuelistCup", 13 => "RankEvent",
        14 => "TeamMatch", 15 => "DuelTrial", 16 => "WCS", 17 => "Versus", 18 => "WcsFinal", 19 => "Rate", 20 => "RDC",
        21 => "Dicerally", 25 => "Null", _ => $"?{v}",
    };
}

/// Typed accessors over the three roots we care about.
internal sealed class Game
{
    public readonly Mem M;
    public readonly Il2Cpp IL;
    public readonly Il2CppClassInfo ClientWork, DuelClient, Engine;

    public Game(Mem m)
    {
        M = m; IL = new Il2Cpp(m);
        ClientWork = IL.Find("YgomSystem.Utility.ClientWork", Off.ClientWorkSlots);
        DuelClient = IL.Find("YgomGame.Duel.DuelClient", Off.DuelClientSlots);
        Engine = IL.Find("YgomGame.Duel.Engine", Off.EngineSlots);
        Log.Info($"ClientWork class @0x{ClientWork.Ptr:X} statics @0x{ClientWork.StaticFields:X}");
        Log.Info($"DuelClient class @0x{DuelClient.Ptr:X} statics @0x{DuelClient.StaticFields:X}");
        Log.Info($"Engine class @0x{Engine.Ptr:X} statics @0x{Engine.StaticFields:X}");
    }

    public ulong ClientWorkData => ClientWork.StaticFields == 0 ? 0 : M.Ptr(ClientWork.StaticFields + Off.ClientWork_s_data);
    public ulong DuelClientInstance => DuelClient.StaticFields == 0 ? 0 : M.Ptr(DuelClient.StaticFields + Off.DuelClient_instance);
    public ulong EngineInstance => Engine.StaticFields == 0 ? 0 : M.Ptr(Engine.StaticFields + Off.Engine_s_instance);

    public ulong Path(string jsonPath) { var r = ClientWorkData; return r == 0 ? 0 : IL.Resolve(r, jsonPath); }

    /// The game log's own uid → card id table: everything either player has revealed so far in this duel.
    public Dictionary<int, int> LogUidTable()
    {
        var map = new Dictionary<int, int>();
        ulong dc = DuelClientInstance; if (dc == 0) return map;
        ulong hud = M.Ptr(dc + Off.DC_duelHUD); if (hud == 0) return map;
        ulong dlc = M.Ptr(hud + Off.HUD_duellog); if (dlc == 0) return map;
        ulong dict = M.Ptr(dlc + Off.DLC_uidCardidTable); if (dict == 0) return map;
        ulong entries = M.Ptr(dict + Rt.DictEntries); int count = M.I32(dict + Rt.DictCount);
        if (entries == 0 || count <= 0 || count > 4096) return map;
        // Entry<int,int> = { int hashCode; int next; int key; int value } — 16 bytes; freed slots have next < -1
        var raw = M.Read(entries + Rt.ArrItems, count * 16);
        for (int i = 0; i < count; i++)
        {
            int next = BitConverter.ToInt32(raw, i * 16 + 4), key = BitConverter.ToInt32(raw, i * 16 + 8), val = BitConverter.ToInt32(raw, i * 16 + 12);
            if (next >= -1 && val != 0) map[key] = val;
        }
        return map;
    }

    /// Zone the player's cursor is on (player index, FieldPostion code, slot index), or null when nothing is pointed at.
    public (int player, int position, int index)? Hover()
    {
        if (DuelClient.StaticFields == 0) return null;
        ulong cur = M.Ptr(DuelClient.StaticFields + Off.DuelClient_cursor); if (cur == 0) return null;
        ulong loc = M.Ptr(cur + Off.DCU_selectLocation); if (loc == 0) return null;
        return (M.I32(loc + Off.LI_player), M.I32(loc + Off.LI_position), M.I32(loc + Off.LI_index));
    }

    private Il2CppClassInfo? _tutorialUtil; private bool _tutorialUtilLooked;

    /// What the duel timer widget is showing (both players' clocks pass through it as input alternates), or null.
    public (float duel, float turn, bool input, int maxDuel, int maxTurn)? DuelTimerUi()
    {
        if (!_tutorialUtilLooked)
        {
            _tutorialUtilLooked = true;
            try { _tutorialUtil = IL.Find("YgomGame.Duel.TutorialUtil"); } catch (Exception ex) { Log.Info("TutorialUtil: " + ex.Message); }
        }
        if (_tutorialUtil == null || _tutorialUtil.StaticFields == 0) return null;
        ulong gom = M.Ptr(_tutorialUtil.StaticFields + Off.TU_goManager); if (gom == 0) return null;
        ulong dt = M.Ptr(gom + Off.GOM_duelTimer); if (dt == 0) return null;
        return (M.F32(dt + Off.DT_remainInDuel), M.F32(dt + Off.DT_remainInTurn), M.U8(dt + Off.DT_isPlayerInput) != 0,
                M.I32(dt + Off.DT_maxDuelTime), M.I32(dt + Off.DT_maxTurnTime));
    }

    public void WritePath(Utf8JsonWriter w, string jsonPath)
    {
        var p = Path(jsonPath);
        w.WritePropertyName(jsonPath);
        IL.WriteObject(w, p);
    }

    public sealed record DuelState(ulong Instance, int Step, ulong Did, int Result, int Finish, string? Me, string? Rival,
                                   long PcodeMe, long PcodeRival, bool WinMe, bool WinRival, int GameMode, bool Online,
                                   uint Turn, int WhichTurn, uint[] LP, int EngineMyself, int DeoMyselfId, int DeoRivalId,
                                   uint TimeLeft = 0, uint TimeTotal = 0, bool InputGuard = false, int RunningEffect = 0, int CurrentRunEffect = 0);

    public DuelState? ReadDuel()
    {
        ulong dc = DuelClientInstance;
        if (dc == 0) return null;
        int step = M.I32(dc + Off.DC_m_Step);
        ulong did = M.U64(dc + Off.DC_did);
        ulong deo = M.Ptr(dc + Off.DC_duelEndOperation);
        int res = 0, fin = 0; string? me = null, rival = null; long pm = 0, pr = 0; bool wm = false, wr = false;
        int deoMe = -1, deoRival = -1, engMe = -1;
        if (deo != 0)
        {
            res = M.I32(deo + Off.DEO_resultType); fin = M.I32(deo + Off.DEO_finishType);
            deoMe = M.I32(deo + Off.DEO_myselfid); deoRival = M.I32(deo + Off.DEO_rivalid);
            me = SafeStr(M.Ptr(deo + Off.DEO_userNameMyself)); rival = SafeStr(M.Ptr(deo + Off.DEO_userNameRival));
            pm = M.I64(deo + Off.DEO_pcodeMyself); pr = M.I64(deo + Off.DEO_pcodeRival);
            wm = M.U8(deo + Off.DEO_winMyself) != 0; wr = M.U8(deo + Off.DEO_winRival) != 0;
        }
        int gm = -1; bool online = false; uint turn = 0; int which = -1; uint[] lp = Array.Empty<uint>();
        uint tLeft = 0, tTotal = 0; bool guard = false; int runEff = 0, curEff = 0;
        ulong en = EngineInstance;
        if (en != 0)
        {
            gm = M.I32(en + Off.EN_gameMode); online = M.U8(en + Off.EN_isOnlineMode) != 0;
            ulong cp = M.Ptr(en + Off.EN_cachedParam);
            if (cp != 0) engMe = M.I32(cp + 0x10);
            ulong pw = M.Ptr(en + Off.EN_pvpWork);
            if (pw != 0)
            {
                tLeft = M.U32(pw + Off.PW_TimeLeft); tTotal = M.U32(pw + Off.PW_TimeTotal); guard = M.U8(pw + Off.PW_inputGuard) != 0;
                runEff = M.I32(pw + Off.PW_RunningEffect); curEff = M.I32(pw + Off.PW_CurrentRunEffect);
            }
            ulong ped = pw == 0 ? 0 : M.Ptr(pw + Off.PW_currentEngineData);
            ulong pdi = ped == 0 ? 0 : M.Ptr(ped + Off.PED_duelInfo);
            if (pdi != 0)
            {
                turn = M.U32(pdi + Off.PDI_nTurnNum); which = M.U8(pdi + Off.PDI_bWhichTurnNow);
                ulong lpArr = M.Ptr(pdi + Off.PDI_nLP);
                if (lpArr != 0)
                {
                    int n = Math.Min(M.I32(lpArr + Rt.ArrLen), 4);
                    lp = new uint[n];
                    for (int i = 0; i < n; i++) lp[i] = M.U32(lpArr + Rt.ArrItems + (ulong)(i * 4));
                }
            }
        }
        return new DuelState(dc, step, did, res, fin, me, rival, pm, pr, wm, wr, gm, online, turn, which, lp, engMe, deoMe, deoRival, tLeft, tTotal, guard, runEff, curEff);
    }

    /// Entries of a Dictionary<valuetype,valuetype>: (key, value) pairs of live slots (freed slots have next < -1).
    private List<(int key, int val)> ReadValueDict(ulong dict, int entrySize, int keyOff, int keySize, int valOff, int valSize)
    {
        var list = new List<(int, int)>();
        if (dict == 0) return list;
        ulong entries = M.Ptr(dict + Rt.DictEntries); int count = M.I32(dict + Rt.DictCount);
        if (entries == 0 || count <= 0 || count > 4096) return list;
        var raw = M.Read(entries + Rt.ArrItems, count * entrySize);
        int Rd(int off, int size) => size == 2 ? BitConverter.ToUInt16(raw, off) : BitConverter.ToInt32(raw, off);
        for (int i = 0; i < count; i++)
        {
            int next = BitConverter.ToInt32(raw, i * entrySize + 4);
            if (next < -1) continue;
            list.Add((Rd(i * entrySize + keyOff, keySize), Rd(i * entrySize + valOff, valSize)));
        }
        return list;
    }

    /// How the last ReadPvpCards resolved its rows: "pos:<posTbl entries> uid:<uidTbl entries> arr:<array len> via:<postbl|array>".
    public string LastTableStats { get; private set; } = "";

    /// Card instances currently on the table (owner & position). Goes through the engine's posTbl (position → uid)
    /// and uidTbl (uid → index) so instances that were replaced (revived, returned and re-dealt) are not counted twice;
    /// falls back to scanning uidBases if those tables are unreadable.
    public List<(int com, int pos, int uid, int cardId, bool face)> ReadPvpCards(bool includeUnknown = false)
    {
        var list = new List<(int, int, int, int, bool)>();
        ulong en = EngineInstance; if (en == 0) return list;
        ulong pw = M.Ptr(en + Off.EN_pvpWork); if (pw == 0) return list;
        ulong ped = M.Ptr(pw + Off.PW_currentEngineData); if (ped == 0) return list;
        ulong arr = M.Ptr(ped + Off.PED_uidBases); if (arr == 0) return list;
        int n = Math.Min(M.I32(arr + Rt.ArrLen), 2048);
        var ptrs = M.Read(arr + Rt.ArrItems, n * 8);
        (int, int, int, int, bool)? Entry(int i)
        {
            if (i < 0 || i >= n) return null;
            ulong u = BitConverter.ToUInt64(ptrs, i * 8);
            if (u == 0) return null;
            int cid = M.U16(u + Off.UID_cardId);
            if (cid == 0 && !includeUnknown) return null;
            return ((int)M.U32(u + Off.UID_nCom), (int)M.U32(u + Off.UID_nPos), M.U16(u + Off.UID_wUid), cid, M.U8(u + Off.UID_isFace) != 0);
        }
        int posCount = 0, uidCount = 0;
        try
        {
            // Dictionary<uint,ushort>: {hash, next, uint key, ushort value} = 16 bytes; Dictionary<ushort,ushort>: 12 bytes
            var posUid = ReadValueDict(M.Ptr(ped + Off.PED_posTbl), 16, 8, 4, 12, 2);
            var uidIdx = new Dictionary<int, int>();
            foreach (var (k, v) in ReadValueDict(M.Ptr(ped + Off.PED_uidTbl), 12, 8, 2, 10, 2)) uidIdx[k] = v;
            posCount = posUid.Count; uidCount = uidIdx.Count;
            if (posUid.Count > 0 && uidIdx.Count > 0)
            {
                var seenUid = new HashSet<int>();
                foreach (var (pos, uid) in posUid)
                    if (seenUid.Add(uid) && uidIdx.TryGetValue(uid, out var idx) && Entry(idx) is { } e) list.Add((e.Item1, pos, e.Item3, e.Item4, e.Item5));
                if (list.Count > 0) { LastTableStats = $"pos:{posCount} uid:{uidCount} arr:{n} via:postbl"; return list; }
            }
        }
        catch { list.Clear(); }
        // Fallback: scan the array, keeping only the last entry per uid (the array retains stale duplicates of an instance).
        var byUid = new Dictionary<int, (int, int, int, int, bool)>(); var order = new List<int>();
        for (int i = 0; i < n; i++)
            if (Entry(i) is { } e) { if (!byUid.ContainsKey(e.Item3)) order.Add(e.Item3); byUid[e.Item3] = e; }
        foreach (var uid in order) list.Add(byUid[uid]);
        LastTableStats = $"pos:{posCount} uid:{uidCount} arr:{n} via:array";
        return list;
    }

    public string? SafeStr(ulong s) { try { return M.ManagedString(s, 512); } catch { return null; } }
}
