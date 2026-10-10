import { useEffect, useRef, useState } from "react";
import PcTrackerBanner from "@/components/PcTrackerBanner";
import { getTrackerPending } from "@/api/trackerPendingApi";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import {
  deleteRecordGroup,
  getUserRecordGroups,
  createRecordGroup,
  getRecordGroupStatistics,
  getMetaDeckStats,
  joinSheetByCode,
  MetaDeckStat,
  type SheetSummary,
} from "@/api/toolApi";
import { KebabMenu, RankIcon, confirmSheetDelete } from "@/components/records/SheetBits";
import { ResultChips, UsagePie, rate, pctText, COIN_FRONT, COIN_BACK } from "@/components/charts";
import { getRankLabel } from "@/utils/rankUtils";
import UpdateBadge from "@/components/UpdateBadge";

type RecordGroupBasic = {
  id: number;
  name: string;
  kind?: "solo" | "shared";
  role?: "owner" | "editor" | "viewer";
  member_count?: number;
  owner?: { id: number; username: string; icon: string | null; border: string | null } | null;
};

type RecordGroupWithStats = RecordGroupBasic & {
  totalGames: number;
  overallWinRate: number;
  firstRatio: number;
  firstWinRate: number;
  secondWinRate: number;
  summary: SheetSummary | null;
};

// Win rate colour: blue from 55%, red from 45%, plain text only at exactly 50%, and a gradual blend in between
// (특이점 2026-10-10). The blend mixes into the surrounding text colour so it works in both themes.
const winRateTint = (rate: number): { cls: string; mix?: string } => {
  if (rate >= 55) return { cls: "text-blue-600" };
  if (rate <= 45) return { cls: "text-red-500" };
  if (rate > 50) return { cls: "", mix: `color-mix(in srgb, #2563eb ${(((rate - 50) / 5) * 100).toFixed(1)}%, currentColor)` };
  if (rate < 50) return { cls: "", mix: `color-mix(in srgb, #ef4444 ${(((50 - rate) / 5) * 100).toFixed(1)}%, currentColor)` };
  return { cls: "" };
};

const RecordGroups = () => {
  const [recordGroups, setRecordGroups] = useState<RecordGroupWithStats[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [metaStats, setMetaStats] = useState<MetaDeckStat[]>([]);
  // /records?meta=1 (linked from notices) opens the meta stats and scrolls to them (특이점 2026-10-10).
  const [searchParams] = useSearchParams();
  const metaLinked = searchParams.get("meta") === "1";
  const [showMetaStats, setShowMetaStats] = useState(metaLinked);
  const metaRef = useRef<HTMLDivElement>(null);
  const metaScrolled = useRef(false);
  const [showMoreMeta, setShowMoreMeta] = useState(false);
  const [deckCovers, setDeckCovers] = useState<Record<number, string>>({});
  const [pieMeta, setPieMeta] = useState<number | null>(null);
  const [rowMeta, setRowMeta] = useState<number | null>(null);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  // "최근 7일", or "10/6 18:00 이후" while a reset (balance update) is less than a week old
  const [metaSince, setMetaSince] = useState("최근 7일");
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [newGroupKind, setNewGroupKind] = useState<"solo" | "shared">("solo");
  const navigate = useNavigate();

  const joinByCode = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoinMsg("");
    try {
      const joined = await joinSheetByCode(code);
      navigate(`/record-groups/${joined.record_group_id}`);
    } catch (e) {
      setJoinMsg((e as Error).message);
    }
  };

  useEffect(() => {
    const fetchGroupsWithStats = async () => {
      try {
        const baseGroups: RecordGroupBasic[] = await getUserRecordGroups();

        const groupsWithStats: RecordGroupWithStats[] = await Promise.all(
          baseGroups.map(async (group) => {
            try {
              const stats = await getRecordGroupStatistics(group.id);
              return {
                ...group,
                totalGames: stats.total_games,
                overallWinRate: stats.overall_win_rate,
                firstRatio: stats.first_ratio,
                firstWinRate: stats.first_win_rate,
                secondWinRate: stats.second_win_rate,
                summary: stats.summary ?? null,
              };
            } catch (statError) {
              console.warn(`통계 불러오기 실패 (Group ID: ${group.id}):`, statError);
              return {
                ...group,
                totalGames: 0,
                overallWinRate: 0,
                firstRatio: 0,
                firstWinRate: 0,
                secondWinRate: 0,
                summary: null,
              };
            }
          })
        );

        setRecordGroups(groupsWithStats);
      } catch (error) {
        console.error("시트를 불러오기 실패:", error);
      } finally {
        setGroupsLoaded(true);
      }
    };

    fetchGroupsWithStats();
  }, []);

  useEffect(() => {
    getMetaDeckStats()
      .then((data) => {
        setMetaStats(data.meta_decks || []);
        setTotalMatches(data.total_matches || 0);
        if (data.since_reset && data.since) {
          const d = new Date(data.since);
          setMetaSince(`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 이후`);
        }
      })
      .catch((err) => console.error("메타 덱 불러오기 실패:", err));
  }, []);

  // Covers come with the stats (up to 30 decks), so no per-deck request.
  useEffect(() => {
    const coverMap: Record<number, string> = {};
    for (const deck of metaStats) {
      if (deck.cover_image_small) coverMap[deck.meta_deck_id] = deck.cover_image_small;
    }
    setDeckCovers(coverMap);
  }, [metaStats]);

  useEffect(() => {
    if (!metaLinked || metaScrolled.current || metaStats.length === 0) return;
    metaScrolled.current = true;
    requestAnimationFrame(() => metaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [metaLinked, metaStats]);

  const topMeta = metaStats.slice(0, 10);
  const moreMeta = metaStats.slice(10, 30);

  const renderMetaRow = (deck: MetaDeckStat, idx: number) => {
    const tint = winRateTint(deck.win_rate);
    return (
      <div
        key={deck.meta_deck_id}
        onMouseEnter={() => setRowMeta(deck.meta_deck_id)}
        onMouseLeave={() => setRowMeta(null)}
        className={`flex items-center justify-between border-b pb-2 rounded-lg transition-colors ${
          (rowMeta ?? pieMeta) === deck.meta_deck_id ? "bg-blue-50 dark:bg-blue-900/20" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          {/* Medals are big enough to read their numbers (특이점 2026-10-10). */}
          {idx < 3 ? (
            <span className="w-9 h-9 flex items-center justify-center text-[32px] leading-none shrink-0" aria-label={`${idx + 1}위`}>
              {["🥇", "🥈", "🥉"][idx]}
            </span>
          ) : (
            <span
              className={`w-9 h-9 flex items-center justify-center rounded-md font-mono font-semibold shrink-0 ${idx < 10 ? "bg-gray-100 dark:bg-gray-700" : "bg-gray-200 dark:bg-gray-700"}`}
            >
              {idx + 1}
            </span>
          )}
          {deckCovers[deck.meta_deck_id] && (
            <div className="relative hidden sm:block shrink-0">
              <img
                src={deckCovers[deck.meta_deck_id]}
                alt={deck.meta_deck_name}
                className="w-10 h-10 rounded object-cover"
              />
              {deck.is_upcoming && <UpdateBadge className="absolute -top-1.5 -left-1.5 w-5 h-5 text-[10px]" />}
            </div>
          )}
          <span className="font-medium text-gray-800 dark:text-gray-200">{deck.meta_deck_name}</span>
          {/* Phones hide the cover, so the U mark sits after the name there. */}
          {deck.is_upcoming && (
            <UpdateBadge className={`w-5 h-5 text-[10px] shrink-0 ${deckCovers[deck.meta_deck_id] ? "sm:hidden" : ""}`} />
          )}
        </div>
        <div className="text-right text-sm text-gray-600 dark:text-gray-400">
          <div>
            사용률:{" "}
            <span className={`font-semibold ${deck.appearance_percent >= 10 ? "text-blue-600" : ""}`}>
              {deck.appearance_percent}%
            </span>
          </div>
          <div>
            승률:{" "}
            <span className="text-gray-700 dark:text-gray-300">
              <span className={`font-semibold ${tint.cls}`} style={tint.mix ? { color: tint.mix } : undefined}>
                {deck.win_rate}%
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      await createRecordGroup(newGroupName, newGroupKind);
      setNewGroupName("");
      setIsModalOpen(false);

      window.location.reload();
    } catch (error) {
      console.error("시트 추가 실패:", error);
    }
  };

  const isLoggedIn = localStorage.getItem("access_token");
  const [pendingCount, setPendingCount] = useState(0);

  // Games the PC tracker uploaded while no sheet was selected — they are invisible on this page otherwise.
  useEffect(() => {
    if (!isLoggedIn) return;
    getTrackerPending().then((list) => setPendingCount(list.length)).catch(() => {});
  }, [isLoggedIn]);

  const top3 = metaStats.slice(0, 3);
  const deleteSheet = (group: RecordGroupWithStats) => {
    if (!confirmSheetDelete(group.name)) return;
    deleteRecordGroup(group.id)
      .then(() => setRecordGroups((list) => list.filter((g) => g.id !== group.id)))
      .catch((err) => alert("삭제 실패: " + err.message));
  };

  return (
    <div className="px-4 sm:px-6 py-6 min-h-screen max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl md:text-3xl font-bold">전적 시트</h1>
        {isLoggedIn && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => navigate("/record-groups/statistics")}
              className="px-3 py-1.5 border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 text-sm rounded-lg font-semibold hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
            >
              내 통계
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              ＋ 새 시트
            </button>
          </div>
        )}
      </div>

      {isLoggedIn && pendingCount > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-xl px-4 py-3">
          <div className="font-semibold">레코더에서 올라온 게임 {pendingCount}건이 확인을 기다리고 있습니다</div>
          <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">
            {recordGroups.length === 0
              ? "아래에서 시트를 먼저 만들면, 그 시트에서 확인하고 기록할 수 있습니다."
              : "아래 시트를 열면 맨 위에서 확인하고 기록할 수 있습니다."}
          </div>
        </div>
      )}
      {isLoggedIn && <PcTrackerBanner />}
      {Capacitor.isNativePlatform() && isLoggedIn && (
        <button
          onClick={() => navigate("/recorder")}
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition shadow"
        >
          듀얼 레코더 시작
        </button>
      )}

      <div ref={metaRef} className="scroll-mt-20">
        <button
          type="button"
          onClick={() => setShowMetaStats((prev) => !prev)}
          aria-expanded={showMetaStats}
          className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-3 rounded-xl text-left border border-blue-100 dark:border-blue-900/60 bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/40 dark:to-violet-950/30 hover:border-blue-300 dark:hover:border-blue-700 transition"
        >
          <span className="flex flex-col min-w-0">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">메타 통계 · {metaSince}</span>
            <b className="text-[14px] min-[375px]:text-[15px] truncate">
              {/* Phones drop the lead-in so the three deck names fit (특이점 2026-10-10). */}
              {top3.length ? (
                <>
                  <span className="hidden sm:inline">많이 쓰이는 덱 </span>
                  {top3.map((d) => d.meta_deck_name).join(" · ")}
                </>
              ) : (
                "메타 덱 통계를 불러오는 중입니다"
              )}
            </b>
            <span className="text-xs text-gray-500 dark:text-gray-400">다이아 이상 · 레이팅 · 듀컵 {totalMatches ? `${totalMatches.toLocaleString()}판` : ""}</span>
          </span>
          <span className="flex">
            {top3.map((d, i) =>
              deckCovers[d.meta_deck_id] ? (
                <img key={d.meta_deck_id} src={deckCovers[d.meta_deck_id]} alt="" className={`w-8 h-8 min-[375px]:w-9 min-[375px]:h-9 rounded-lg object-cover border-2 border-white dark:border-gray-900 ${i ? "-ml-3" : ""}`} />
              ) : null,
            )}
          </span>
          <span className="text-gray-400 text-sm">{showMetaStats ? "▲" : "▼"}</span>
        </button>
        {showMetaStats && metaStats.length > 0 && (
          <div className="mt-2 px-2 py-3 sm:p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            <p className="text-xs text-gray-700 dark:text-gray-300">
              ※ {metaSince === "최근 7일" ? "최근 1주일" : metaSince} · 다이아 이상 / 레이팅 / 듀컵 기반
            </p>
            <p className="text-xs text-gray-700 dark:text-gray-300">
              ※ 월초 셀렉션 팩 출시 시 초기화
            </p>
            <div className="flex items-center justify-end mb-3">
              {/* Phones open on the pie alone and 더보기 brings the numbers; on PC it adds 11위 ~ 30위 (특이점 2026-10-10). */}
              {topMeta.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMoreMeta((v) => !v)}
                  aria-label={showMoreMeta ? "순위 접기" : "순위 더보기"}
                  aria-expanded={showMoreMeta}
                  title={showMoreMeta ? "순위 접기" : "순위 더보기"}
                  className={`${moreMeta.length ? "" : "md:hidden"} group flex items-center gap-1 rounded-full hover:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
                >
                  <span className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200">더보기</span>
                  <span
                    className={`w-6 h-6 rounded-full border text-xs font-bold leading-none flex items-center justify-center transition ${
                      showMoreMeta
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-gray-400 text-gray-500 dark:text-gray-300 group-hover:bg-gray-100 dark:group-hover:bg-gray-700"
                    }`}
                  >
                    i
                  </span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
              <div>
                <UsagePie
                  data={topMeta}
                  deckCovers={deckCovers}
                  showUpdateKey={metaStats.some((d) => d.is_upcoming)}
                  total={totalMatches}
                  since={metaSince === "최근 7일" ? "최근 1주일" : metaSince}
                  active={rowMeta}
                  onActive={setPieMeta}
                />
              </div>
              <div className={`${showMoreMeta ? "" : "hidden md:block"} space-y-2`}>
                {topMeta.map((deck, idx) => renderMetaRow(deck, idx))}
              </div>
            </div>
            {showMoreMeta && moreMeta.length > 0 && (
              <div className="mt-4 pt-3 border-t dark:border-gray-700">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">11위 ~ {10 + moreMeta.length}위</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  {moreMeta.map((deck, i) => renderMetaRow(deck, i + 10))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isLoggedIn ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">로그인 후 사용해주세요.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-bold">내 시트</h2>
            {showJoin ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && joinByCode()}
                  placeholder="초대 코드"
                  aria-label="초대 코드"
                  className="w-32 px-2.5 py-1.5 text-sm border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                />
                <button onClick={joinByCode} className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
                  참여
                </button>
              </div>
            ) : (
              <button onClick={() => setShowJoin(true)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                초대 코드로 참여
              </button>
            )}
          </div>
          {joinMsg && <span className="text-sm text-red-600">{joinMsg}</span>}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {!groupsLoaded &&
              [0, 1, 2].map((i) => <div key={i} className="h-[168px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" aria-hidden />)}
            {recordGroups.map((group) => {
              const t = group.summary?.totals;
              const games = t?.games ?? group.totalGames;
              const wins = t?.wins ?? Math.round(group.totalGames * group.overallWinRate / 100);
              // a solo sheet's current rank: the one recorded on its latest duel
              const last = group.kind !== "shared" ? group.summary?.latest : null;
              const nowRank = last?.rank ? { rank: last.rank } : null;
              return (
                <div
                  key={group.id}
                  onClick={() => navigate(`/record-groups/${group.id}`)}
                  className="px-4 py-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition flex flex-col gap-2.5 tabular-nums"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[17px] font-semibold break-words leading-snug">{group.name}</h3>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        {group.kind === "shared" ? (
                          <>
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">그룹</span>
                            <span>{group.member_count ?? 1}명</span>
                            {group.role !== "owner" && group.owner && <span className="truncate">· {group.owner.username}님의 시트</span>}
                            {group.role === "viewer" && <span>· 보기 전용</span>}
                          </>
                        ) : (
                          <span>개인</span>
                        )}
                        <span>· {games}판</span>
                      </p>
                    </div>
                    <KebabMenu
                      label="시트 메뉴"
                      items={[
                        { label: "통계 보기", onSelect: () => navigate(`/record-groups/${group.id}/statistics`) },
                        { label: "시트 삭제", onSelect: () => deleteSheet(group), danger: true, hidden: group.role !== undefined && group.role !== "owner" },
                      ]}
                    />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <b className="text-2xl leading-none">{pctText(rate(wins, games), 1)}</b>
                      <span className="text-sm text-gray-500 dark:text-gray-400">{wins}승 {games - wins}패</span>
                    </div>
                    {nowRank && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                        <RankIcon rank={nowRank.rank} className="w-6 h-6" />
                        {getRankLabel(nowRank.rank)}
                      </span>
                    )}
                  </div>
                  {group.summary && group.summary.recent.length > 0 && <ResultChips recent={group.summary.recent} small slots={10} />}
                  {t && games > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <img src={COIN_FRONT} alt="" className="w-3.5 h-3.5" />코인 이김 <b className="text-gray-900 dark:text-gray-100">{pctText(rate(t.coin_win_wins, t.coin_win))}</b>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <img src={COIN_BACK} alt="" className="w-3.5 h-3.5" />코인 짐 <b className="text-gray-900 dark:text-gray-100">{pctText(rate(t.coin_lose_wins, t.coin_lose))}</b>
                      </span>
                      <span>
                        선공 <b className="text-gray-900 dark:text-gray-100">{pctText(rate(t.first_wins, t.first))}</b> · 후공{" "}
                        <b className="text-gray-900 dark:text-gray-100">{pctText(rate(t.second_wins, t.second))}</b>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {groupsLoaded && recordGroups.length > 0 && (
            <p className="text-xs text-center text-gray-500 dark:text-gray-400">시트 이름 바꾸기·공개 설정은 시트 안의 ⋯ 메뉴에 있습니다.</p>
          )}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm mx-4">
            <h2 className="text-lg font-semibold mb-2">새로운 시트 추가</h2>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="시트 이름"
              className="p-2 border rounded w-full bg-white dark:bg-gray-800 text-black dark:text-white"
            />
            <div className="mt-3 space-y-2">
              {([
                { key: "solo", title: "개인 시트", desc: "나 혼자 기록합니다." },
                { key: "shared", title: "그룹 시트", desc: "친구를 초대해 함께 기록하고, 사람별로 전적을 나눠 봅니다." },
              ] as const).map((opt) => (
                <label
                  key={opt.key}
                  className={`flex gap-2 items-start p-2 border rounded-lg cursor-pointer ${
                    newGroupKind === opt.key ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="record-group-kind"
                    className="mt-1"
                    checked={newGroupKind === opt.key}
                    onChange={() => setNewGroupKind(opt.key)}
                  />
                  <span>
                    <span className="block font-medium">{opt.title}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 mr-2 bg-gray-300 dark:bg-gray-600 rounded"
              >
                취소
              </button>
              <button
                onClick={handleAddGroup}
                className="px-4 py-2 bg-blue-500 text-white rounded"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecordGroups;
