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
    public const int DuelClient_instance = 0x0;
    public const int Engine_s_instance = 0x8;

    // DuelClient
    public const int DC_m_Step = 0x1C4;
    public const int DC_dicResult = 0x1D0;
    public const int DC_resultSending = 0x1D8, DC_resultSended = 0x1D9;
    public const int DC_duelEndOperation = 0x1F0;
    public const int DC_did = 0x208;
    public const int DC_pvpProgress = 0xEA;

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
    public const int PW_currentEngineData = 0x18;
    public const int PED_duelInfo = 0x10, PED_uidBases = 0x28;
    public const int PDI_nTurnNum = 0x14, PDI_bWhichTurnNow = 0x24, PDI_nLP = 0x30;
    public const int UID_nCom = 0x10, UID_nPos = 0x14, UID_wUid = 0x18, UID_cardId = 0x1A, UID_isFace = 0x20;
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

    public void WritePath(Utf8JsonWriter w, string jsonPath)
    {
        var p = Path(jsonPath);
        w.WritePropertyName(jsonPath);
        IL.WriteObject(w, p);
    }

    public sealed record DuelState(ulong Instance, int Step, ulong Did, int Result, int Finish, string? Me, string? Rival,
                                   long PcodeMe, long PcodeRival, bool WinMe, bool WinRival, int GameMode, bool Online,
                                   uint Turn, int WhichTurn, uint[] LP, int EngineMyself, int DeoMyselfId, int DeoRivalId);

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
        ulong en = EngineInstance;
        if (en != 0)
        {
            gm = M.I32(en + Off.EN_gameMode); online = M.U8(en + Off.EN_isOnlineMode) != 0;
            ulong cp = M.Ptr(en + Off.EN_cachedParam);
            if (cp != 0) engMe = M.I32(cp + 0x10);
            ulong pw = M.Ptr(en + Off.EN_pvpWork);
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
        return new DuelState(dc, step, did, res, fin, me, rival, pm, pr, wm, wr, gm, online, turn, which, lp, engMe, deoMe, deoRival);
    }

    /// Card IDs currently tracked by the PvP engine (all uid entries, with owner & position).
    public List<(int com, int pos, int uid, int cardId, bool face)> ReadPvpCards()
    {
        var list = new List<(int, int, int, int, bool)>();
        ulong en = EngineInstance; if (en == 0) return list;
        ulong pw = M.Ptr(en + Off.EN_pvpWork); if (pw == 0) return list;
        ulong ped = M.Ptr(pw + Off.PW_currentEngineData); if (ped == 0) return list;
        ulong arr = M.Ptr(ped + Off.PED_uidBases); if (arr == 0) return list;
        int n = Math.Min(M.I32(arr + Rt.ArrLen), 2048);
        var ptrs = M.Read(arr + Rt.ArrItems, n * 8);
        for (int i = 0; i < n; i++)
        {
            ulong u = BitConverter.ToUInt64(ptrs, i * 8);
            if (u == 0) continue;
            int cid = M.U16(u + Off.UID_cardId);
            if (cid == 0) continue;
            list.Add(((int)M.U32(u + Off.UID_nCom), (int)M.U32(u + Off.UID_nPos), M.U16(u + Off.UID_wUid), cid, M.U8(u + Off.UID_isFace) != 0));
        }
        return list;
    }

    public string? SafeStr(ulong s) { try { return M.ManagedString(s, 512); } catch { return null; } }
}
