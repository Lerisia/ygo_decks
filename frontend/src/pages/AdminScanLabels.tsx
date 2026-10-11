import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getScanSample, listScanSamples, saveScanSample,
  type ScanBox, type ScanSampleDoc, type ScanSampleList, type ScanStatus,
} from "@/api/scanSampleApi";

// One colour per box class, also used for its button.
const COLORS: Record<string, string> = {
  card: "#22c55e",
  deck_panel: "#3b82f6",
  head_main: "#f97316",
  head_extra: "#a855f7",
  head_side: "#ec4899",
};
const STATUS_LABEL: Record<ScanStatus, string> = { todo: "확인 전", done: "확인함", skip: "건너뜀" };
const STATUS_RING: Record<ScanStatus, string> = { todo: "ring-gray-300 dark:ring-gray-600", done: "ring-green-500", skip: "ring-gray-400 opacity-50" };
const ZOOMS = [1, 1.5, 2, 3, 4];
const MIN_PX = 3;   // a drag shorter than this on the screen is a click, not a new box

type Drag = {
  mode: "draw" | "move" | "resize";
  index: number;
  corner?: "nw" | "ne" | "sw" | "se";
  start: { x: number; y: number };
  orig: ScanBox;
  before: ScanBox[];
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** 스캐너 시험지: staff check the boxes on real uploads — every card at least half in view, the deck panel and the
 *  메인 / 엑스트라 / 사이드 headings — the yardstick for retraining the detector (엘리스 2026-10-11). */
export default function AdminScanLabels() {
  const navigate = useNavigate();
  const [list, setList] = useState<ScanSampleList | null>(null);
  const [status, setStatus] = useState<string>("todo");
  const [kind, setKind] = useState("");
  const [doc, setDoc] = useState<ScanSampleDoc | null>(null);
  const [boxes, setBoxes] = useState<ScanBox[]>([]);
  const [history, setHistory] = useState<ScanBox[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cls, setCls] = useState("card");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shownWidth, setShownWidth] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const dirty = !!doc && JSON.stringify(boxes) !== JSON.stringify(doc.boxes);

  const loadList = useCallback(async () => {
    try {
      setList(await listScanSamples({ status: status || undefined, kind: kind || undefined }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [status, kind]);
  useEffect(() => { loadList(); }, [loadList]);

  const open = async (id: number) => {
    if (dirty && !window.confirm("저장하지 않은 상자가 있습니다. 버릴까요?")) return;
    setErr("");
    try {
      const d = await getScanSample(id);
      setDoc(d);
      setBoxes(d.boxes);
      setHistory([]);
      setSelected(null);
      setZoom(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Handles stay the same size on the screen whatever the zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setShownWidth(el.getBoundingClientRect().width || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const change = (next: ScanBox[], before = boxes) => {
    setHistory((h) => [...h.slice(-49), before]);
    setBoxes(next);
  };
  const undo = () => {
    if (!history.length) return;
    setBoxes(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setSelected(null);
  };

  const save = async (next: ScanStatus) => {
    if (!doc) return;
    setBusy(true);
    setErr("");
    try {
      const d = await saveScanSample(doc.id, { boxes, status: next });
      setDoc(d);
      setBoxes(d.boxes);
      setHistory([]);
      const rows = list?.results ?? [];
      const at = rows.findIndex((r) => r.id === d.id);
      const following = rows.slice(at + 1).find((r) => r.status === "todo") ?? rows.find((r) => r.status === "todo" && r.id !== d.id);
      await loadList();
      if (following) {
        const n = await getScanSample(following.id);
        setDoc(n);
        setBoxes(n.boxes);
        setSelected(null);
        setZoom(1);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Keys: 1~5 class (and the chosen box's), Delete removes, Esc lets go, Ctrl+Z undoes, Enter saves as checked.
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      const classes = list?.classes ?? [];
      const n = Number(e.key);
      if (n >= 1 && n <= classes.length) {
        const key = classes[n - 1].key;
        setCls(key);
        if (selected !== null) change(boxes.map((b, i) => (i === selected ? { ...b, c: key } : b)));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
        e.preventDefault();
        change(boxes.filter((_, i) => i !== selected));
        setSelected(null);
      } else if (e.key === "Escape") {
        setSelected(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Enter" && !busy) {
        e.preventDefault();
        save("done");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const point = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const begin = (e: React.PointerEvent, mode: Drag["mode"], index: number, corner?: Drag["corner"]) => {
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    const start = point(e);
    if (mode === "draw") {
      const fresh = { c: cls, x: start.x, y: start.y, w: 0, h: 0 };
      drag.current = { mode, index: boxes.length, start, orig: fresh, before: boxes };
      setBoxes([...boxes, fresh]);
      setSelected(boxes.length);
    } else {
      drag.current = { mode, index, corner, start, orig: boxes[index], before: boxes };
      setSelected(index);
    }
  };
  const moveTo = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    const o = d.orig;
    let b: ScanBox;
    if (d.mode === "draw") {
      b = { c: o.c, x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
    } else if (d.mode === "move") {
      const x = Math.min(1 - o.w, Math.max(0, o.x + p.x - d.start.x));
      const y = Math.min(1 - o.h, Math.max(0, o.y + p.y - d.start.y));
      b = { ...o, x, y };
    } else {
      let [x0, y0, x1, y1] = [o.x, o.y, o.x + o.w, o.y + o.h];
      if (d.corner!.includes("w")) x0 = p.x; else x1 = p.x;
      if (d.corner!.includes("n")) y0 = p.y; else y1 = p.y;
      b = { ...o, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }
    setBoxes((all) => all.map((x, i) => (i === d.index ? b : x)));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const all = boxesRef.current;
    const b = all[d.index];
    const tiny = !b || b.w * shownWidth < MIN_PX || b.h * shownWidth * ((doc?.height ?? 1) / (doc?.width ?? 1)) < MIN_PX;
    if (d.mode === "draw" && tiny) {
      setBoxes(d.before);   // a click on empty space: nothing drawn
      setSelected(null);
    } else if (JSON.stringify(all) !== JSON.stringify(d.before)) {
      setHistory((h) => [...h.slice(-49), d.before]);
    }
  };

  const classes = list?.classes ?? [];
  const kindLabel = (key: string) => list?.kinds.find((k) => k.key === key)?.label ?? key;
  const W = doc?.width ?? 1;
  const H = doc?.height ?? 1;
  const k = W / shownWidth;   // picture pixels per screen pixel
  const handle = 8 * k;
  const total = list ? list.counts.todo + list.counts.done + list.counts.skip : 0;

  return (
    <div className="min-h-screen px-4 py-4 max-w-7xl mx-auto">
      <button type="button" onClick={() => navigate("/manage")} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2">
        ← 관리
      </button>
      <h1 className="text-2xl font-bold">스캐너 시험지</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-keep">
        실제로 올라온 그림에 상자를 바로잡습니다. 카드 상자는 지금 스캐너가 찾은 것이라 빠진 카드를 더하고 틀린 상자는 지웁니다.
        <b> 카드</b>는 절반 이상 보이는 것마다, <b>덱 칸</b>은 덱 목록이 든 영역, <b>머리글</b>은 '메인 덱 40' 같은 줄입니다.
      </p>
      {list && (
        <p className="mt-1 text-sm tabular-nums">
          확인함 <b>{list.counts.done}</b> / {total}장 · 건너뜀 {list.counts.skip}
        </p>
      )}
      {err && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="min-w-0">
          {!doc ? (
            <p className="py-24 text-center text-gray-500 dark:text-gray-400">오른쪽 목록에서 그림을 고르세요.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {classes.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setCls(c.key);
                      if (selected !== null) change(boxes.map((b, j) => (j === selected ? { ...b, c: c.key } : b)));
                    }}
                    className={`px-2.5 py-1 rounded-lg text-sm font-semibold border-2 transition ${
                      cls === c.key ? "text-white" : "text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800"
                    }`}
                    style={{ borderColor: COLORS[c.key], background: cls === c.key ? COLORS[c.key] : undefined }}
                  >
                    {i + 1} {c.label} <span className="tabular-nums opacity-80">{boxes.filter((b) => b.c === c.key).length}</span>
                  </button>
                ))}
                <span className="ml-auto flex items-center gap-1">
                  {ZOOMS.map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setZoom(z)}
                      className={`px-2 py-1 rounded text-xs font-semibold ${zoom === z ? "bg-gray-700 text-white" : "bg-gray-200 dark:bg-gray-700"}`}
                    >
                      {z}×
                    </button>
                  ))}
                </span>
              </div>
              <div className="overflow-auto h-[66vh] rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-800">
                {/* 1× shows the whole picture (as wide as the box allows, as tall as 66vh); the rest zoom in from there */}
                <div className="relative" style={{ width: `calc(${zoom} * min(100%, ${((66 * W) / H).toFixed(2)}vh))` }}>
                  <img src={doc.image_url} alt="" draggable={false} className="block w-full select-none" />
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                    onPointerDown={(e) => begin(e, "draw", -1)}
                    onPointerMove={moveTo}
                    onPointerUp={end}
                    onPointerCancel={end}
                  >
                    {boxes.map((b, i) => {
                      const [x, y, w, h] = [b.x * W, b.y * H, b.w * W, b.h * H];
                      const on = i === selected;
                      return (
                        <g key={i}>
                          <rect
                            x={x} y={y} width={w} height={h}
                            fill={COLORS[b.c] ?? "#fff"} fillOpacity={on ? 0.25 : 0.06}
                            stroke={COLORS[b.c] ?? "#fff"} strokeWidth={on ? 3 : 2} vectorEffect="non-scaling-stroke"
                            className="cursor-move"
                            onPointerDown={(e) => begin(e, "move", i)}
                          />
                          {on && (["nw", "ne", "sw", "se"] as const).map((c) => (
                            <rect
                              key={c}
                              x={(c.includes("w") ? x : x + w) - handle / 2}
                              y={(c.includes("n") ? y : y + h) - handle / 2}
                              width={handle} height={handle}
                              fill="#fff" stroke={COLORS[b.c]} strokeWidth={2} vectorEffect="non-scaling-stroke"
                              className={c === "nw" || c === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"}
                              onPointerDown={(e) => begin(e, "resize", i, c)}
                            />
                          ))}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => save("done")} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:bg-gray-400">
                  확인 완료 (Enter)
                </button>
                <button type="button" disabled={busy} onClick={() => save("skip")} className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold disabled:bg-gray-400">
                  건너뛰기
                </button>
                <button type="button" disabled={!history.length} onClick={undo} className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 font-semibold disabled:opacity-40">
                  되돌리기 (Ctrl+Z)
                </button>
                <button
                  type="button"
                  disabled={selected === null}
                  onClick={() => { change(boxes.filter((_, i) => i !== selected)); setSelected(null); }}
                  className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 font-semibold disabled:opacity-40"
                >
                  상자 지우기 (Del)
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  #{doc.id} · {kindLabel(doc.kind)} · {doc.width}×{doc.height} · {STATUS_LABEL[doc.status]}
                  {doc.reviewed_by && ` (${doc.reviewed_by})`}
                  {dirty && " · 저장 안 됨"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
                빈 곳을 끌면 고른 종류로 새 상자, 상자를 끌면 이동, 모서리를 끌면 크기 조절. 숫자 키로 종류를 바꿉니다.
              </p>
            </>
          )}
        </section>

        <aside className="min-w-0">
          <div className="flex flex-wrap gap-1 mb-2">
            {(["todo", "done", "skip", ""] as const).map((s) => (
              <button
                key={s || "all"}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${status === s ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}
              >
                {s ? STATUS_LABEL[s] : "전체"} {list && <span className="tabular-nums">{s ? list.counts[s] : total}</span>}
              </button>
            ))}
          </div>
          <select
            aria-label="종류"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full mb-2 px-2 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">모든 종류</option>
            {list?.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-1.5 max-h-[70vh] overflow-y-auto pr-1">
            {list?.results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r.id)}
                title={`#${r.id} ${kindLabel(r.kind)} · 상자 ${r.boxes}`}
                className={`relative aspect-square rounded overflow-hidden ring-2 ${doc?.id === r.id ? "ring-blue-600" : STATUS_RING[r.status]}`}
              >
                <img src={r.image_url} alt="" loading="lazy" className="w-full h-full object-cover bg-gray-800" />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] tabular-nums">{r.boxes}</span>
              </button>
            ))}
          </div>
          {list && !list.results.length && <p className="text-sm text-gray-500 dark:text-gray-400">해당하는 그림이 없습니다.</p>}
        </aside>
      </div>
    </div>
  );
}
