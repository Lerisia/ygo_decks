import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/Avatar";
import CardSearchModal from "@/components/CardSearchModal";
import { soloApi, type SoloDrawingDetail as Detail, type SoloGuessResponse } from "@/api/soloApi";
import { replayStrokes, type DmStrokePayload } from "@/lib/duchmindCanvas";

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

export default function SoloDrawingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const drawingId = Number(id);
  // Guests can guess for fun, but can't recommend / report / give up
  // (those would persist server-side and need a user identity).
  const isLoggedIn = typeof window !== "undefined" && !!localStorage.getItem("access_token");
  // Board pages set this via Link state when navigating in. Used to restore
  // tab/order/page when the user clicks "← 보드로". Direct URL visits leave
  // this empty → back button just goes to a fresh board.
  const boardSearch: string = ((location.state as any)?.boardSearch || "");
  const backToBoardPath = useMemo(
    () => `/solo-duchmind${boardSearch ? `?${boardSearch}` : ""}`,
    [boardSearch]
  );

  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string>("");
  const [guess, setGuess] = useState("");
  const [guessing, setGuessing] = useState(false);
  const [lastResult, setLastResult] = useState<SoloGuessResponse | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  // Card-search popup — uses the shared <CardSearchModal>; this just
  // toggles its visibility.
  const [showCardSearch, setShowCardSearch] = useState(false);
  const guessInputRef = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = () => {
    soloApi.drawingDetail(drawingId)
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  };
  useEffect(() => { if (drawingId) load(); }, [drawingId]);

  // Render strokes once data arrives, and re-render on resize. All drawings
  // are 1.6:1; the container reserves that ratio via CSS (aspect-[1.6/1])
  // so there's no height jump on open — the canvas just fills it. The
  // bitmap is DPR-scaled (cap 2) so the drawing stays crisp on retina.
  useEffect(() => {
    if (!data) return;
    const el = containerRef.current;
    if (!el) return;
    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const cssW = el.clientWidth;
      const cssH = Math.round(cssW / 1.6);
      if (cssW <= 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      replayStrokes(ctx, cv.width, cv.height, (data.strokes || []) as DmStrokePayload[]);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);


  async function submitGuess(e?: React.FormEvent) {
    e?.preventDefault();
    if (!data || guessing) return;
    const g = guess.trim();
    if (!g) return;
    setGuessing(true);
    try {
      const res = await soloApi.submitGuess(drawingId, g);
      setLastResult(res);
      setGuess("");
      load();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setGuessing(false);
    }
  }

  async function toggleRecommend() {
    if (!data) return;
    try {
      const r = await soloApi.toggleRecommend(drawingId);
      setData({ ...data, iam_recommended: r.recommended, recommend_count: r.recommend_count });
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  async function hide() {
    if (!data) return;
    const prompt = data.iam_drawer
      ? "이 그림을 삭제하시겠습니까? 다른 사용자에게 더 이상 보이지 않습니다. (되돌릴 수 없습니다)"
      : `[운영자] ${data.drawer_name}의 그림을 삭제하시겠습니까? (되돌릴 수 없습니다)`;
    if (!confirm(prompt)) return;
    try {
      await soloApi.hideDrawing(drawingId);
      navigate(backToBoardPath);
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  async function submitReport() {
    if (!reportReason.trim()) return;
    try {
      await soloApi.reportDrawing(drawingId, reportReason.trim());
      setReportOpen(false);
      setReportReason("");
      alert("신고가 접수되었습니다.");
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  // Give-up flow — modal confirms, then permanently marks the drawing as
  // "gave up" for this user (answer revealed, no points, no more guesses).
  const [giveUpOpen, setGiveUpOpen] = useState(false);
  const [givingUp, setGivingUp] = useState(false);
  async function confirmGiveUp() {
    if (!data || givingUp) return;
    setGivingUp(true);
    try {
      await soloApi.giveUp(drawingId);
      setGiveUpOpen(false);
      load();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setGivingUp(false);
    }
  }

  if (err && !data) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md text-center">
          <div className="text-red-600 mb-3">{err}</div>
          <button onClick={() => navigate(backToBoardPath)} className="px-4 py-2 rounded-lg bg-blue-600 text-white">돌아가기</button>
        </div>
      </div>
    );
  }
  if (!data) {
    // Skeleton mirroring the loaded layout — the drawer card with its
    // 1.6:1 canvas area, an action row, and the guess box — so the
    // board → detail transition doesn't flash a blank centered screen.
    return (
      <div className="min-h-svh bg-gray-50 dark:bg-gray-900 pb-20">
        <div className="max-w-3xl mx-auto px-3 py-3">
          <button
            onClick={() => navigate(backToBoardPath)}
            className="inline-flex items-center gap-1 px-3 py-2 mb-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:border-blue-500"
            style={{ touchAction: "manipulation" }}
          >← 보드로</button>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse shrink-0" />
              <div className="flex-1">
                <div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mt-1" />
              </div>
            </div>
            <div className="w-full aspect-[1.6/1] rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
          <div className="h-10 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse mb-2" />
          <div className="h-24 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
      </div>
    );
  }

  // Guessing is unlimited — the input is only disabled once solved /
  // gave up / expired / hidden, never "exhausted".
  const guessDisabled = data.iam_drawer || data.iam_solved || !!data.iam_gave_up || data.expired || data.is_hidden;
  // The answer/guess box swaps content by state. `revealed` → show the
  // answer; otherwise the guess input (or an expired notice). The box
  // keeps a fixed min-height so guessing → solved doesn't shift the page.
  const revealed = data.iam_drawer || data.iam_solved || !!data.iam_gave_up || !!lastResult?.correct;
  const gaveUpOnly = !!data.iam_gave_up && !data.iam_solved;
  const answerImg = data.card_image_url || lastResult?.card_image_url || null;

  return (
    <div className="min-h-svh bg-gray-50 dark:bg-gray-900 pb-20">
      <div className="max-w-3xl mx-auto px-3 py-3">
        <button
          onClick={() => navigate(backToBoardPath)}
          className="inline-flex items-center gap-1 px-3 py-2 mb-2 rounded-lg text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:border-blue-500"
          style={{ touchAction: "manipulation" }}
        >← 보드로</button>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-2 mb-2">
          <div className="flex items-center justify-between mb-1 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar icon={data.drawer_avatar_icon} border={data.drawer_border} size={40} />
              <div className="min-w-0">
                <div className="text-xs text-gray-500">그린이</div>
                <div className="font-semibold truncate">{data.drawer_name}</div>
              </div>
            </div>
            <div className="text-right text-xs text-gray-500 shrink-0">
              <div>👍 {data.recommend_count} · ✓ {data.solver_count}</div>
              <div>{formatExpiresIn(data.expires_at)}</div>
            </div>
          </div>

          <div ref={containerRef} className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden w-full aspect-[1.6/1]">
            <canvas ref={canvasRef} className="block w-full h-full" />
          </div>
        </div>

        {/* Action row: recommend + (drawer-only) hide + report. Recommend
            and report require a user identity — guests just see the
            guess input below. */}
        {isLoggedIn && (
          <div className="flex gap-2 mb-2">
            {!data.iam_drawer && (
              <button
                onClick={toggleRecommend}
                disabled={data.expired || data.is_hidden}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border-2 ${
                  data.iam_recommended
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                } disabled:opacity-40`}
              >
                👍 {data.iam_recommended ? "추천함" : "추천"}
              </button>
            )}
            {data.iam_drawer && (
              <button
                onClick={hide}
                disabled={data.is_hidden}
                className="flex-1 px-3 py-2 rounded-lg text-sm border-2 border-red-300 text-red-600 disabled:opacity-40"
              >
                {data.is_hidden ? "삭제됨" : "🗑 내 그림 삭제"}
              </button>
            )}
            {!data.iam_drawer && data.viewer_is_staff && (
              <button
                onClick={hide}
                disabled={data.is_hidden}
                className="flex-1 px-3 py-2 rounded-lg text-sm border-2 border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 disabled:opacity-40 font-semibold"
                title="운영자 권한으로 삭제"
              >
                {data.is_hidden ? "삭제됨" : "🗑 [운영자] 삭제"}
              </button>
            )}
            {!data.iam_drawer && (
              <button
                onClick={() => setReportOpen(true)}
                className="px-3 py-2 rounded-lg text-sm border-2 border-gray-300 dark:border-gray-600"
              >
                🚩 신고
              </button>
            )}
          </div>
        )}
        {!isLoggedIn && (
          <div className="mb-2 text-xs text-center text-gray-500 dark:text-gray-400">
            💡 로그인하면 정답 시 포인트가 쌓이고 정답자 목록에도 올라가요.
          </div>
        )}

        {/* Answer / guess slot — one box that swaps content by state.
            Fixed min-height so guessing → solved doesn't shift the page;
            the answer (정답 + 카드 이미지) lands in the same footprint the
            guess input occupied. The 돌아가기 button shows only once the
            drawing is solved / given up — it's not useful mid-guess. */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-2 min-h-[255px] flex flex-col">
          {revealed ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-1">
              <div className={`font-bold text-lg text-center ${gaveUpOnly ? "text-gray-500" : "text-blue-700 dark:text-blue-400"}`}>
                {gaveUpOnly ? "(포기) " : ""}정답: {data.word}
              </div>
              {answerImg && (
                <img
                  src={answerImg}
                  alt={data.word || ""}
                  className="w-28 aspect-square object-contain rounded bg-gray-100 dark:bg-gray-900"
                  loading="lazy"
                />
              )}
              {data.iam_drawer ? (
                <div className="text-gray-500 text-sm">내가 그린 그림이에요.</div>
              ) : (data.iam_solved || lastResult?.correct) ? (
                // lastResult.correct covers the brief window after a correct
                // guess but before load() refetches `data` — without it the
                // box fell through to the gave-up branch and flashed
                // "포기한 그림이에요" mid-load.
                <div className="text-green-600 dark:text-green-400 font-semibold text-sm text-center">
                  맞혔어요! 🎉
                  {lastResult?.correct && (
                    lastResult.solved_without_points
                      ? ` (${lastResult.point_attempt_limit}회 초과 — 0P)`
                      : lastResult.points_awarded > 0
                        ? ` +${lastResult.points_awarded}P${lastResult.first_solver ? " · 첫 정답!" : ""}`
                        : " (오늘 포인트 상한 — 0P)"
                  )}
                </div>
              ) : data.iam_gave_up ? (
                <div className="text-gray-500 text-sm">포기한 그림이에요.</div>
              ) : null}
              <button
                onClick={() => navigate(backToBoardPath)}
                className="mt-1 px-8 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
                style={{ touchAction: "manipulation" }}
              >← 돌아가기</button>
            </div>
          ) : data.expired ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">만료된 그림이에요.</div>
          ) : (
            <div className="flex-1 flex flex-col justify-center">
              <form onSubmit={submitGuess} className="flex gap-2">
                <input
                  ref={guessInputRef}
                  type="text"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  placeholder="정답을 입력해주세요"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                  disabled={guessDisabled}
                />
                {/* 포기 persists server-side ("never again") so guests
                    don't get it — they can keep guessing forever for fun. */}
                {isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => setGiveUpOpen(true)}
                    disabled={guessDisabled}
                    className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:bg-gray-400 shrink-0"
                    title="이 그림 포기"
                  >
                    포기
                  </button>
                )}
                <button
                  type="submit"
                  disabled={guessDisabled || !guess.trim() || guessing}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:bg-gray-500 shrink-0"
                >
                  제출
                </button>
              </form>
              <button
                type="button"
                onClick={() => setShowCardSearch(true)}
                className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm bg-white dark:bg-gray-800"
              >
                🔍 카드 검색
              </button>
              <div className="mt-2 text-xs text-gray-500 text-center">
                {data.my_attempts_used + 1}번째 시도 · {data.point_attempt_limit}회 안에 맞히면 포인트 획득
              </div>
              {lastResult && !lastResult.correct && (
                <div className="mt-2 text-center text-sm text-red-600">오답입니다.</div>
              )}
            </div>
          )}
        </div>

        {/* Solver list — visible to everyone (was previously drawer-only;
            now public so solvers can show off their icons too). */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-2">
          <div className="font-semibold mb-1 text-sm">정답자 ({data.solvers.length}명)</div>
          {data.solvers.length === 0 ? (
            <div className="text-gray-500 text-sm">아직 아무도 못 맞혔어요.</div>
          ) : (
            <ul className="text-sm space-y-1">
              {data.solvers.map((s) => (
                <li key={s.user_id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar icon={s.avatar_icon} border={s.border} size={24} />
                    <span className="truncate">{s.name}</span>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">{s.solved_at ? new Date(s.solved_at).toLocaleString() : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-2 text-xs text-yellow-800 dark:text-yellow-200">
          ⚠️ 그림에 정답을 적는 등 부정행위 적발 시 <b>강제 탈퇴</b>될 수 있습니다.
        </div>
      </div>

      <CardSearchModal
        open={showCardSearch}
        onClose={() => setShowCardSearch(false)}
        onPick={(name) => {
          setGuess(name);
          setTimeout(() => guessInputRef.current?.focus(), 0);
        }}
        copyTargetLabel="정답창"
      />

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-2">신고 사유</div>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="부정행위, 부적절한 그림 등"
              className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => setReportOpen(false)} className="px-3 py-1.5 rounded-lg text-sm bg-gray-200 dark:bg-gray-700">취소</button>
              <button onClick={submitReport} disabled={!reportReason.trim()} className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white disabled:bg-gray-500">신고</button>
            </div>
          </div>
        </div>
      )}

      {giveUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setGiveUpOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-lg mb-2 text-red-600">정말 포기하시겠어요?</div>
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              포기하면 이 그림에 <b>영구히</b> 다시 도전할 수 없습니다.
              포기 즉시 정답이 공개되며 포인트는 지급되지 않습니다.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setGiveUpOpen(false)}
                disabled={givingUp}
                className="px-3 py-1.5 rounded-lg text-sm bg-gray-200 dark:bg-gray-700"
              >취소</button>
              <button
                onClick={confirmGiveUp}
                disabled={givingUp}
                className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white disabled:bg-gray-500"
              >{givingUp ? "처리 중..." : "포기"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
