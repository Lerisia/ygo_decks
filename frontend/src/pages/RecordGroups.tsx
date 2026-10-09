import { useEffect, useRef, useState } from "react";
import PcTrackerBanner from "@/components/PcTrackerBanner";
import { getTrackerPending } from "@/api/trackerPendingApi";
import { useNavigate } from "react-router-dom";
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
import { ResultChips, KebabMenu, RankIcon, confirmSheetDelete, rate, pctText, COIN_FRONT, COIN_BACK } from "@/components/records/SheetBits";
import { getRankLabel } from "@/utils/rankUtils";
import { PieChart, Pie, Cell, Tooltip } from "recharts";

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

type Props = {
  data: MetaDeckStat[];
  deckCovers: Record<number, string>;
};

// Slices are plain colours (metallic gold/silver/bronze, then rainbow for 4–10, near-black for the rest) and each deck's
// picture sits in a small circle on the pie's edge, so ranks read at a glance (특이점 2026-10-10).
// Metal: a darker base with one soft highlight band — enough to read as metal without a cheap shine.
const PODIUM = [
  { stops: ["#b8860b", "#e3b84a", "#f8e2a0", "#d9a93a", "#a87a12"], solid: "#d4a72c" },
  { stops: ["#8e949c", "#c9cdd3", "#f4f5f7", "#bfc3c9", "#858b94"], solid: "#b4b9c0" },
  { stops: ["#8f5228", "#c9874f", "#efc09a", "#bd7a45", "#7f4620"], solid: "#c07a46" },
];
const PODIUM_OFFSETS = ["0%", "38%", "52%", "68%", "100%"];
const RAINBOW = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#4f46e5", "#9333ea"];
const OTHERS_COLOR = "#3a3a3d";
const MAX_PIE_RADIUS = 150;
const MIN_PIE_RADIUS = 90;
const AVATAR_R = 16;
// Ring offsets beyond the pie's edge: on the edge, then one and two circles further out.
const RING_OFFSETS = [4, 4 + AVATAR_R * 2 + 4, 4 + (AVATAR_R * 2 + 4) * 2];
const RAD = Math.PI / 180;
// Ranks run counter-clockwise from 12 o'clock (특이점 2026-10-10).
const START_ANGLE = 90;
const END_ANGLE = 450;

const sliceColor = (rank: number) => (rank < 3 ? PODIUM[rank].solid : RAINBOW[rank - 3] ?? OTHERS_COLOR);

// Thin neighbouring slices would stack their circles, so a circle that would touch an earlier one moves out a ring.
const avatarRings = (percents: number[], radius: number) => {
  const total = percents.reduce((a, b) => a + b, 0) || 1;
  const placed: { x: number; y: number }[] = [];
  let cum = 0;
  return percents.map((p) => {
    const mid = (START_ANGLE + ((cum + p / 2) / total) * (END_ANGLE - START_ANGLE)) * RAD;
    cum += p;
    for (let ring = 0; ring < RING_OFFSETS.length; ring++) {
      const x = (radius + RING_OFFSETS[ring]) * Math.cos(mid);
      const y = (radius + RING_OFFSETS[ring]) * Math.sin(mid);
      if (ring === RING_OFFSETS.length - 1 || placed.every((q) => Math.hypot(q.x - x, q.y - y) >= AVATAR_R * 2 + 4)) {
        placed.push({ x, y });
        return ring;
      }
    }
    return 0;
  });
};

export const MetaDeckPieChart = ({ data, deckCovers }: Props) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const top10 = data.slice(0, 10);
  const totalPercent = top10.reduce((sum, d) => sum + d.appearance_percent, 0);
  const othersPercent = Math.max(0, 100 - totalPercent);

  const chartData = [
    ...top10.map((deck) => ({
      ...deck,
      id: deck.meta_deck_id,
      label: deck.meta_deck_name,
      cover: deckCovers[deck.meta_deck_id] || "",
    })),
    {
      id: -1,
      label: "기타",
      appearance_percent: othersPercent,
      win_rate: 0,
      cover: "",
    },
  ];
  // As large as the column allows while the first ring of circles still fits beside it.
  const radius = Math.max(MIN_PIE_RADIUS, Math.min(MAX_PIE_RADIUS, Math.floor(boxWidth / 2 - RING_OFFSETS[1] - AVATAR_R - 6)));
  const rings = avatarRings(chartData.map((d) => d.appearance_percent), radius);
  const reach = radius + RING_OFFSETS[Math.max(0, ...rings.slice(0, top10.length))] + AVATAR_R + 8;
  const height = boxWidth ? 2 * reach : 2 * (MAX_PIE_RADIUS + RING_OFFSETS[1] + AVATAR_R + 8);

  const renderAvatar = ({ cx, cy, midAngle, index }: { cx: number; cy: number; midAngle: number; index: number }) => {
    const entry = chartData[index];
    if (!entry || entry.id === -1) return null;
    const color = sliceColor(index);
    const r = radius + RING_OFFSETS[rings[index]];
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    const edgeX = cx + radius * Math.cos(-midAngle * RAD);
    const edgeY = cy + radius * Math.sin(-midAngle * RAD);
    return (
      <g key={`avatar-${entry.id}`}>
        <title>{`${index + 1}위 ${entry.label} · ${entry.appearance_percent}%`}</title>
        {rings[index] > 0 && <line x1={edgeX} y1={edgeY} x2={x} y2={y} stroke={color} strokeWidth={1.5} />}
        <circle cx={x} cy={y} r={AVATAR_R + 4} className="fill-white dark:fill-gray-800" />
        <circle cx={x} cy={y} r={AVATAR_R + 2} fill={index < 3 ? `url(#meta-podium-${index})` : color} />
        <clipPath id={`deck-avatar-${entry.id}`}>
          <circle cx={x} cy={y} r={AVATAR_R} />
        </clipPath>
        {entry.cover ? (
          <image
            href={entry.cover}
            x={x - AVATAR_R}
            y={y - AVATAR_R}
            width={AVATAR_R * 2}
            height={AVATAR_R * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#deck-avatar-${entry.id})`}
          />
        ) : (
          <circle cx={x} cy={y} r={AVATAR_R} className="fill-gray-200 dark:fill-gray-700" />
        )}
      </g>
    );
  };

  return (
    <div className="hidden md:block w-full">
      <h3 className="text-lg font-semibold mb-2">사용률 차트</h3>
      <div ref={boxRef} style={{ height }}>
        {boxWidth > 0 && (
          <PieChart width={boxWidth} height={height} style={{ overflow: "visible" }}>
            <defs>
              {PODIUM.map((c, i) => (
                <linearGradient key={i} id={`meta-podium-${i}`} x1="0" y1="0" x2="1" y2="1">
                  {c.stops.map((color, j) => (
                    <stop key={j} offset={PODIUM_OFFSETS[j]} stopColor={color} />
                  ))}
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={chartData}
              dataKey="appearance_percent"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={radius}
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              label={renderAvatar}
              labelLine={false}
              isAnimationActive={false}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={entry.id}
                  fill={entry.id === -1 ? OTHERS_COLOR : i < 3 ? `url(#meta-podium-${i})` : sliceColor(i)}
                  strokeWidth={2}
                  className="stroke-white dark:stroke-gray-800"
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => `${value.toFixed(1)}%`}
              contentStyle={{ fontSize: "0.875rem" }}
            />
          </PieChart>
        )}
      </div>
    </div>
  );
};


const RecordGroups = () => {
  const [recordGroups, setRecordGroups] = useState<RecordGroupWithStats[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [metaStats, setMetaStats] = useState<MetaDeckStat[]>([]);
  const [showMetaStats, setShowMetaStats] = useState(false);
  const [showMoreMeta, setShowMoreMeta] = useState(false);
  const [deckCovers, setDeckCovers] = useState<Record<number, string>>({});
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

  const topMeta = metaStats.slice(0, 10);
  const moreMeta = metaStats.slice(10, 30);

  const renderMetaRow = (deck: MetaDeckStat, idx: number) => (
    <div
      key={deck.meta_deck_id}
      className="flex items-center justify-between border-b pb-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg font-mono w-6 text-right">
          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`}
        </span>
        {deckCovers[deck.meta_deck_id] && (
          <img
            src={deckCovers[deck.meta_deck_id]}
            alt={deck.meta_deck_name}
            className="w-10 h-10 rounded object-cover hidden sm:block"
          />
        )}
        <span className="font-medium text-gray-800 dark:text-gray-200">{deck.meta_deck_name}</span>
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
          <span
            className={`font-semibold ${
              deck.win_rate >= 55
                ? "text-blue-600"
                : deck.win_rate <= 45
                ? "text-red-500"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {deck.win_rate}%
          </span>
        </div>
      </div>
    </div>
  );

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

      <div>
        <button
          type="button"
          onClick={() => setShowMetaStats((prev) => !prev)}
          aria-expanded={showMetaStats}
          className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-3 rounded-xl text-left border border-blue-100 dark:border-blue-900/60 bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/40 dark:to-violet-950/30 hover:border-blue-300 dark:hover:border-blue-700 transition"
        >
          <span className="flex flex-col min-w-0">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">메타 통계 · {metaSince}</span>
            <b className="text-[15px] truncate">
              {top3.length ? `많이 쓰이는 덱 ${top3.map((d) => d.meta_deck_name).join(" · ")}` : "메타 덱 통계를 불러오는 중입니다"}
            </b>
            <span className="text-xs text-gray-500 dark:text-gray-400">다이아 이상 · 레이팅 · 듀컵 {totalMatches ? `${totalMatches.toLocaleString()}판` : ""}</span>
          </span>
          <span className="flex">
            {top3.map((d, i) =>
              deckCovers[d.meta_deck_id] ? (
                <img key={d.meta_deck_id} src={deckCovers[d.meta_deck_id]} alt="" className={`w-9 h-9 rounded-lg object-cover border-2 border-white dark:border-gray-900 ${i ? "-ml-3" : ""}`} />
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
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                총 집계 게임 수: {totalMatches.toLocaleString()}
              </p>
              {moreMeta.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMoreMeta((v) => !v)}
                  aria-label={showMoreMeta ? "11위 이하 숨기기" : "11위 ~ 30위 보기"}
                  aria-expanded={showMoreMeta}
                  title={showMoreMeta ? "11위 이하 숨기기" : "11위 ~ 30위 보기"}
                  className="group flex items-center gap-1 rounded-full hover:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="hidden md:block">
                <MetaDeckPieChart data={topMeta} deckCovers={deckCovers} />
              </div>
              <div className="space-y-2">
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
