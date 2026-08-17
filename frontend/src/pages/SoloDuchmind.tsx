import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Avatar from "@/components/Avatar";
import {
  soloApi,
  type SoloBoardResponse, type SoloBoardOrder, type SoloBoardTab,
  type SoloDrawingSummary, type SoloMyStatus,
} from "@/api/soloApi";
import { replayStrokesPreview, type DmStrokePayload } from "@/lib/duchmindCanvas";
import { boardCacheKey, getBoardCache, writeBoardCache, clearBoardCache } from "@/lib/soloBoardCache";

const TABS: { key: SoloBoardTab; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "unsolved", label: "미해결" },
  { key: "nobody", label: "아무도 못 푼" },
  { key: "mine", label: "내 그림" },
];

const ORDERS: { key: SoloBoardOrder; label: string }[] = [
  { key: "recent", label: "최신순" },
  { key: "solvers", label: "정답자 많은 순" },
  { key: "recommends", label: "추천순" },
];

function formatExpiresIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "만료";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}일 ${hours}시간 남음`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}시간 ${mins}분 남음`;
  return `${mins}분 남음`;
}

/** Renders a drawing's stroke buffer onto a fixed 1.6:1 preview canvas.
 *  Every drawing is made at 1.6:1, so strokes replay 1:1 with no
 *  letterboxing needed. Uses the fast polyline renderer — perfect-
 *  freehand's variable-width detail is invisible at thumbnail scale and
 *  was the board's main render cost (a dozen previews at once). */
function StrokePreview({ strokes }: { strokes: DmStrokePayload[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    replayStrokesPreview(ctx, cv.width, cv.height, strokes || []);
  }, [strokes]);
  return (
    <canvas
      ref={ref}
      width={320}
      height={200}
      className="block w-full aspect-[1.6/1]"
    />
  );
}

/** Loading placeholder — mirrors CardThumb's exact structure (1.6:1
 *  canvas box + 4-row text area) so a skeleton card is pixel-for-pixel
 *  the same height as a loaded card and the grid never jumps. */
function SkeletonCard() {
  return (
    <div className="rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
      <div className="w-full aspect-[1.6/1] bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="p-2 text-xs text-left bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse shrink-0" />
          <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="mt-0.5">
          <span className="inline-block align-middle h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="mt-1">
          <span className="inline-block align-middle h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="text-[10px] mt-0.5">
          <span className="inline-block align-middle h-2.5 w-1/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/** 처음으로 / 이전 / 다음 pagination with a plain page indicator.
 *  No "last page" jump — on a recency-sorted board the final page is the
 *  oldest, near-expiry drawings, which users rarely want. Rendered both
 *  above and below the grid. */
function Pagination({ page, totalPages, onPage }: {
  page: number; totalPages: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const navBtn = "px-3 py-1.5 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 disabled:opacity-40";
  return (
    <div className="flex justify-center items-center gap-1.5">
      <button disabled={page <= 1} onClick={() => onPage(1)} className={navBtn}>처음으로</button>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className={navBtn}>이전</button>
      <span className="px-2 py-1.5 text-sm tabular-nums">{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={navBtn}>다음</button>
    </div>
  );
}

function CardThumb({ d, boardSearch, onDeleted }: { d: SoloDrawingSummary; boardSearch: string; onDeleted?: (id: number) => void }) {
  const canDelete = d.iam_drawer || d.viewer_is_staff;
  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const prompt = d.iam_drawer
      ? "이 그림을 삭제하시겠습니까?\n다른 사용자에게 더 이상 보이지 않습니다. (되돌릴 수 없습니다)"
      : `[운영자] ${d.drawer_name}의 그림을 삭제하시겠습니까?\n(되돌릴 수 없습니다)`;
    if (!confirm(prompt)) return;
    try {
      await soloApi.hideDrawing(d.id);
      onDeleted?.(d.id);
    } catch (err: any) {
      alert(String(err?.message || err) || "삭제 실패");
    }
  };
  return (
    <Link
      to={`/solo-duchmind/${d.id}`}
      state={{ boardSearch }}
      className="block rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600 bg-white hover:border-blue-500 transition-colors"
    >
      <div className="bg-white relative">
        <StrokePreview strokes={(d.strokes || []) as DmStrokePayload[]} />
        {(d.iam_drawer || d.iam_solved) && (
          <span className={`absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${
            d.iam_drawer ? "bg-gray-700 text-white" : "bg-green-600 text-white"
          }`}>
            {d.iam_drawer ? "내 그림" : "맞힘!"}
          </span>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/90 hover:bg-red-600 text-white text-xs flex items-center justify-center shadow"
            title={d.iam_drawer ? "이 그림 삭제" : "[운영자] 이 그림 삭제"}
            aria-label="이 그림 삭제"
          >🗑</button>
        )}
      </div>
      <div className="p-2 text-xs text-left bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar icon={d.drawer_avatar_icon} border={d.drawer_border} size={24} />
          <span className="font-semibold truncate">{d.drawer_name}</span>
        </div>
        <div className="flex justify-between text-gray-500 dark:text-gray-400 mt-0.5">
          <span>👍 {d.recommend_count}</span>
          <span>✓ {d.solver_count}</span>
        </div>
        {/* Answer line — always rendered (placeholder when the viewer
            hasn't unlocked the answer) so every card stays the exact
            same height. Previously this line only appeared once solved,
            which made solved cards taller and the grid jump. */}
        <div className="mt-1 font-bold truncate">
          {d.word
            ? <span className="text-blue-700 dark:text-blue-400">정답: {d.word}</span>
            : <span className="text-gray-400 dark:text-gray-500 font-normal">❓ 미해결</span>}
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">{formatExpiresIn(d.expires_at)}</div>
      </div>
    </Link>
  );
}

// Last board scroll position — saved when the board unmounts (navigating
// into a drawing) and restored when it remounts (← 보드로 / browser back),
// keyed by the board's search params so it only restores for the same view.
let savedBoardScroll: { key: string; y: number } | null = null;

export default function SoloDuchmind() {
  const navigate = useNavigate();
  // Guests can browse + guess but can't draw (no points, no daily quota).
  // Detect via presence of an access token so the page can hide drawer-
  // only affordances (the ✏️ 그리기 button, my-points status row).
  const isLoggedIn = typeof window !== "undefined" && !!localStorage.getItem("access_token");
  // Board view state lives in URL search params so the user's tab/order/
  // page survives navigating into a drawing and back (see SoloDrawingDetail's
  // ← back button — it carries these params back). Reload-safe + shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ((searchParams.get("tab") as SoloBoardTab) || "all");
  const order = ((searchParams.get("order") as SoloBoardOrder) || "recent");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const setTab = (t: SoloBoardTab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    next.set("page", "1");  // changing tab resets page
    setSearchParams(next, { replace: true });
  };
  const setOrder = (o: SoloBoardOrder) => {
    const next = new URLSearchParams(searchParams);
    next.set("order", o);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };
  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(p));
    setSearchParams(next, { replace: true });
  };
  // Seed from cache so a paged-back / re-entered board paints instantly
  // (no null → skeleton → data flash).
  const [data, setData] = useState<SoloBoardResponse | null>(
    () => getBoardCache(boardCacheKey(tab, order, page)) ?? null,
  );
  // Optimistically remove a deleted drawing from both the hall_of_fame and
  // the paged items list — saves a board reload roundtrip. Also patches the
  // cache so re-navigating to the same page reflects the deletion.
  const removeHiddenFromData = (id: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        items: prev.items.filter((it) => it.id !== id),
        hall_of_fame: prev.hall_of_fame.filter((it) => it.id !== id),
        total: Math.max(0, (prev.total || 0) - 1),
      };
      writeBoardCache(boardCacheKey(tab, order, page), next);
      return next;
    });
  };
  const [status, setStatus] = useState<SoloMyStatus | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);
  // Point-rules help modal — users didn't realize drawing also earns points.
  const [showPointHelp, setShowPointHelp] = useState(false);
  // Bumped by the manual refresh button — re-triggers the fetch effect
  // even when tab/order/page are unchanged (already on page 1).
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshBoard = () => {
    clearBoardCache();           // whole board shifted — every page is stale
    setData(null);               // show skeleton as "refreshing" feedback
    if (page !== 1) setPage(1);  // newest drawings land on page 1
    setRefreshTick((t) => t + 1);
  };

  useEffect(() => {
    const key = boardCacheKey(tab, order, page);
    const cached = getBoardCache(key);
    if (cached) {
      // Show cache instantly — no spinner, no skeleton, no height jump.
      setData(cached);
      setLoading(false);
    } else {
      // Keep the previous response on screen (don't null it). The page-
      // independent chrome — Hall of Fame, pagination, tabs — stays put;
      // only the card grid swaps to a skeleton (via `viewItems` below).
      // Nulling here made the whole page appear to reload on every
      // 이전/다음. The manual refresh button does null `data` itself to
      // get the full-skeleton "refreshing" feedback.
      setLoading(true);
    }
    setErr("");
    // Always revalidate in the background so cached pages stay fresh.
    let cancelled = false;
    soloApi.board(tab, order, page)
      .then((res) => {
        if (cancelled) return;
        writeBoardCache(key, res);
        setData(res);
      })
      .catch((e) => { if (!cancelled && !cached) setErr(String(e.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // refreshTick re-runs this even when tab/order/page are unchanged
    // (manual refresh while already on page 1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, order, page, refreshTick]);

  useEffect(() => {
    if (!isLoggedIn) return;  // /my_status is auth-only; skip for guests
    soloApi.myStatus().then(setStatus).catch(() => {});
  }, [isLoggedIn]);

  // Board scroll restoration. `searchParamsRef` mirrors the live params so
  // the unmount cleanup saves the position for whatever view is current
  // (the user may have paged since mount). On remount we restore only if
  // the saved view matches — the grid is already painted (cache-seeded or
  // same-height skeletons), so a single rAF scroll lands correctly.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  useEffect(() => {
    if (savedBoardScroll && savedBoardScroll.key === searchParamsRef.current.toString()) {
      const y = savedBoardScroll.y;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    return () => {
      savedBoardScroll = { key: searchParamsRef.current.toString(), y: window.scrollY };
    };
  }, []);

  // The grid's card list — only when `data` actually matches the current
  // tab/order/page. While a new page is loading, `data` still holds the
  // previous page's response (so HoF/pagination chrome stays put), but
  // this is null → the grid shows a skeleton until the new page lands.
  const viewItems =
    data && data.tab === tab && data.order === order && data.page === page
      ? data.items
      : null;

  return (
    <div className="min-h-svh bg-gray-50 dark:bg-gray-900 pb-20">
      <div className="max-w-5xl mx-auto px-3 py-4">
        <button
          onClick={() => navigate("/playground")}
          className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          ← 놀이터
        </button>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl sm:text-2xl font-bold">
            솔로 듀치마인드
          </h1>
          {isLoggedIn ? (
            <button
              onClick={() => navigate("/solo-duchmind/draw")}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
            >
              ✏️ 그리기
            </button>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-500 text-white"
              title="로그인 후 그릴 수 있어요"
            >
              로그인 후 그리기
            </button>
          )}
        </div>

        {/* Today's points — logged-in only. While `status` is still
            loading we render a same-height skeleton so the board below
            doesn't shift down when it lands. Guests never see this
            block (no placeholder needed for them). */}
        {isLoggedIn && (
          status ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-3 text-sm">
              <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-xs">
                <span>오늘 번 포인트</span>
                <button
                  type="button"
                  onClick={() => setShowPointHelp(true)}
                  className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 text-white text-[10px] font-bold flex items-center justify-center leading-none"
                  title="포인트 지급 기준"
                  aria-label="포인트 지급 기준 보기"
                >?</button>
              </div>
              <div className="font-semibold">
                {status.points_earned_today} / {status.daily_points_cap}
                {status.points_remaining_today === 0 && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">(상한 도달)</span>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-3">
              <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mt-1" />
            </div>
          )
        )}

        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-2 text-xs text-yellow-800 dark:text-yellow-200 mb-3">
          ⚠️ 그림에 정답을 적는 등 부정행위 적발 시 <b>강제 탈퇴</b>될 수 있습니다.
        </div>

        {/* Hall of Fame — top 3 most-recommended drawings. During the
            first load we render a 3-card skeleton in its place so the
            page height doesn't grow by a whole HoF section when data
            lands. */}
        {!data && loading ? (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-base font-bold">🏆 명예의 전당</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">추천 많이 받은 그림</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`hof-sk-${i}`} />)}
            </div>
          </div>
        ) : data && data.hall_of_fame.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-base font-bold">🏆 명예의 전당</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">추천 많이 받은 그림</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {data.hall_of_fame.map((d, i) => (
                <div key={d.id} className="relative">
                  <span className="absolute -top-1.5 -left-1.5 z-10 text-base">
                    {["🥇", "🥈", "🥉"][i] || "🏅"}
                  </span>
                  <CardThumb d={d} boardSearch={searchParams.toString()} onDeleted={removeHiddenFromData} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                tab === t.key
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Order within tab + refresh */}
        <div className="flex gap-1 mb-3 items-center">
          {ORDERS.map((o) => (
            <button
              key={o.key}
              onClick={() => setOrder(o.key)}
              className={`px-2.5 py-1 rounded-lg text-xs ${
                order === o.key
                  ? "bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900"
                  : "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
              }`}
            >
              {o.label}
            </button>
          ))}
          {/* Refresh — pulls newly posted drawings. Always jumps to page 1
              (newest land there in recent order) and clears the page cache. */}
          <button
            onClick={refreshBoard}
            disabled={loading}
            className="ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
            title="새 그림 불러오기 (1페이지로 이동)"
          >
            <span className={loading ? "inline-block animate-spin" : "inline-block"}>🔄</span>
            새로고침
          </button>
        </div>

        {err && <div className="text-red-600 text-sm mb-2">{err}</div>}

        {viewItems && viewItems.length === 0 && !loading && (
          <div className="text-center text-gray-500 py-12">
            {tab === "unsolved" ? "안 푼 그림이 없어요." : tab === "nobody" ? "전부 누군가 풀었어요." : "아직 그림이 없어요."}
          </div>
        )}

        {/* Top pagination — same control as the bottom one so users
            don't have to scroll to the end to jump pages. During the
            first load a same-height placeholder row stands in so the
            grid below doesn't shift down when the real control appears. */}
        {!data && loading ? (
          <div className="mb-3 flex justify-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`pg-sk-${i}`} className="h-[34px] w-[42px] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ))}
          </div>
        ) : data && data.total > data.page_size ? (
          <div className="mb-3">
            <Pagination
              page={page}
              totalPages={Math.ceil(data.total / data.page_size)}
              onPage={setPage}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {/* Skeleton placeholders while the first board load is in flight.
              Reserves the full grid height up front so the page doesn't
              jump from short→tall when data lands. Only shown on the
              initial load (data === null); tab/order switches keep the
              previous cards visible underneath. */}
          {viewItems
            ? viewItems.map((d) => <CardThumb key={d.id} d={d} boardSearch={searchParams.toString()} onDeleted={removeHiddenFromData} />)
            : Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)}
        </div>

        {/* Bottom pagination — placeholder row during the first load so
            it doesn't pop in below the grid when data lands. */}
        {!data && loading ? (
          <div className="mt-4 flex justify-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={`pg-sk-b-${i}`} className="h-[34px] w-[42px] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ))}
          </div>
        ) : data && data.total > data.page_size ? (
          <div className="mt-4">
            <Pagination
              page={page}
              totalPages={Math.ceil(data.total / data.page_size)}
              onPage={setPage}
            />
          </div>
        ) : null}
      </div>

      {/* Point-rules help — drawing earns points too, which users miss. */}
      {showPointHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowPointHelp(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-4 max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold mb-3">포인트 지급 기준</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-semibold mb-0.5">🎨 그림을 그리면</div>
                <ul className="text-gray-600 dark:text-gray-400 text-xs space-y-0.5 list-disc pl-4">
                  <li>내 그림을 첫 정답자가 맞히면 <b>+5P</b></li>
                  <li>이후 정답자마다 <b>+1P</b></li>
                  <li>그림 한 장당 최대 <b>10P</b></li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-0.5">✏️ 정답을 맞히면</div>
                <ul className="text-gray-600 dark:text-gray-400 text-xs space-y-0.5 list-disc pl-4">
                  <li>그 그림의 첫 정답이면 <b>+5P</b></li>
                  <li>이후 정답이면 <b>+1P</b></li>
                  <li><b>3회</b> 안에 맞혀야 포인트 (이후엔 맞혀도 0P)</li>
                </ul>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2">
                하루 최대 <b>{status?.daily_points_cap ?? 100}P</b>까지 (그리기·맞히기 합산)
              </div>
            </div>
            <button
              onClick={() => setShowPointHelp(false)}
              className="mt-3 w-full py-2 rounded-lg bg-blue-600 text-white font-semibold"
            >닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
