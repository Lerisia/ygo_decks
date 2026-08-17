import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ColorWheelPicker from "@/components/ColorWheelPicker";
import { soloApi, type SoloCardOption } from "@/api/soloApi";
import { useIsCompactPortrait, useOrientation } from "@/lib/useViewport";
import { setDrawingMode } from "@/lib/drawingMode";
import { clearBoardCache } from "@/lib/soloBoardCache";
import {
  BRUSH_REFERENCE_WIDTH,
  floodFill,
  replayStrokes,
  renderStroke,
  stabilizePoint,
  type BrushKind,
  type StabilizerLevel,
  type PressureCurve,
  type StrokePoint,
  type DmStrokePayload,
} from "@/lib/duchmindCanvas";

const COLORS = [
  "#000000", "#666666", "#999999", "#cccccc", "#ffffff",
  "#7c1818", "#cc1f1f", "#ff7f00", "#ffd92e", "#16a34a",
  "#1f7eff", "#1e3a8a", "#7e22ce", "#ec4899", "#ffb6c1", "#7a4a1c",
  "#fcd0a1",
];
const BRUSH_SIZES = [2, 4, 8, 16];

const STABILIZER_LABELS = ["꺼짐", "약", "중", "강"];
const PRESSURE_CURVE_LABELS: Record<PressureCurve, string> = {
  low: "둔감",
  mid: "보통",
  high: "민감",
};

type Tool = "pen" | "eraser" | "fill";

function formatSec(n: number) {
  const s = Math.max(0, Math.floor(n));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function SoloDraw() {
  const navigate = useNavigate();
  const [offerToken, setOfferToken] = useState<string>("");
  const [drawSeconds, setDrawSeconds] = useState<number>(100);
  const [options, setOptions] = useState<SoloCardOption[] | null>(null);
  const [chosen, setChosen] = useState<SoloCardOption | null>(null);
  const [err, setErr] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const [color, setColor] = useState("#000000");
  const [tool, setTool] = useState<Tool>("pen");
  const [brushSize, setBrushSize] = useState(2);  // match multiplayer DuchMind default
  // Drawing-feel settings persist across sessions (and carry between solo +
  // multi — same localStorage keys) so the user only tunes them once.
  const [stabilizer, setStabilizer] = useState<StabilizerLevel>(() => {
    if (typeof window === "undefined") return 1;
    const raw = localStorage.getItem("duchmind_stabilizer");
    const v = raw === null ? 1 : Number(raw);
    return (v === 0 || v === 1 || v === 2 || v === 3 ? v : 1) as StabilizerLevel;
  });
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(() => {
    if (typeof window === "undefined") return "mid";
    const v = localStorage.getItem("duchmind_pressure_curve");
    return (v === "low" || v === "mid" || v === "high" ? v : "mid") as PressureCurve;
  });
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("duchmind_pen_only_mode") === "1";
  });
  useEffect(() => {
    localStorage.setItem("duchmind_stabilizer", String(stabilizer));
  }, [stabilizer]);
  useEffect(() => {
    localStorage.setItem("duchmind_pressure_curve", pressureCurve);
  }, [pressureCurve]);
  useEffect(() => {
    localStorage.setItem("duchmind_pen_only_mode", penOnlyMode ? "1" : "0");
  }, [penOnlyMode]);
  const penOnlyModeRef = useRef(penOnlyMode); penOnlyModeRef.current = penOnlyMode;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tool refs so the pointer event handlers always read the latest values
  // (closures captured at the first render would otherwise miss state changes).
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const brushSizeRef = useRef(brushSize); brushSizeRef.current = brushSize;
  const stabilizerRef = useRef(stabilizer); stabilizerRef.current = stabilizer;
  const pressureCurveRef = useRef(pressureCurve); pressureCurveRef.current = pressureCurve;
  const [wheelOpen, setWheelOpen] = useState(false);
  // Custom color picked from the wheel during this drawing. Resets when
  // a new card is picked so each drawing starts with the rainbow button.
  const [customColor, setCustomColor] = useState<string | null>(null);
  useEffect(() => {
    setCustomColor(null);
  }, [chosen?.card_id]);
  const handleWheelButton = useCallback(() => {
    if (tool === "eraser") setTool("pen");
    if (!customColor) { setWheelOpen(true); return; }
    if (color === customColor) setWheelOpen(true);
    else setColor(customColor);
  }, [tool, customColor, color]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Overlay canvas for the in-progress stroke. We render the live stroke to
  // this transparent layer on every pointer move (so perfect-freehand can
  // recompute the outline + variable widths from scratch each frame), then
  // blit it onto the main canvas when the stroke completes. Keeps the main
  // canvas "committed strokes only", which makes undo / replay deterministic.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The whole draw screen — the reference image is positioned relative to
  // this so it can be dragged anywhere on screen, not just over the canvas.
  const screenRef = useRef<HTMLDivElement>(null);
  const strokeBufRef = useRef<DmStrokePayload[]>([]);
  const undoStackRef = useRef<DmStrokePayload[][]>([]);
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 500 });
  // CSS pixel size of the 1.6:1 canvas box — computed in JS (CSS aspect-ratio
  // breaks when width + max-height fight each other).
  const [canvasBox, setCanvasBox] = useState({ w: 800, h: 500 });
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Reference image (the picked card's illustration).
  const [refVisible, setRefVisible] = useState(true);
  // Start to the right of the MLD palette (~104px wide) and below the
  // ~44px status bar so the overlay doesn't appear sitting on top of
  // either on first paint. Users can still drag it anywhere (palette
  // included) once they grab the drag handle.
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number }>({ top: 60, left: 130 });
  const [overlayWidthRatio, setOverlayWidthRatio] = useState(0.3);

  const orientation = useOrientation();
  // Treats iPad portrait the same as phone portrait per user spec — the
  // compact/MLD UX is engaged on any narrow portrait viewport.
  const isPhone = useIsCompactPortrait();
  // Mobile fullscreen drawing mode (MLD = rotated portrait → landscape).
  // Default OFF — some users find rotating the phone uncomfortable. The
  // drawer opts into MLD via the 📱 button in the status bar; the regular
  // page layout stays the default. Session-only state (resets on reload).
  const [fullscreenDrawing, setFullscreenDrawing] = useState(false);
  const isMLD = !!chosen && isPhone && fullscreenDrawing;
  const mldRotated = isMLD && orientation === "portrait";

  // Hide site chrome (navbar / footer / bottom bar) for the whole draw page.
  useEffect(() => {
    setDrawingMode(true);
    return () => setDrawingMode(false);
  }, []);

  // Initial fetch: 3 random cards (the offer is persisted server-side — a
  // refresh returns the same trio).
  useEffect(() => {
    soloApi.startDraw()
      .then((res) => {
        setOfferToken(res.offer_token);
        setDrawSeconds(res.draw_seconds);
        setOptions(res.cards);
      })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  // Tick clock once the user picks a card.
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);

  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    replayStrokes(ctx, cv.width, cv.height, strokeBufRef.current, {
      curve: pressureCurveRef.current,
    });
    // Replay also wipes the in-flight stroke (since the buffer doesn't include
    // it yet), so clear the overlay to stay consistent.
    const ov = overlayRef.current;
    if (ov) {
      const oc = ov.getContext("2d");
      oc?.clearRect(0, 0, ov.width, ov.height);
    }
  }, []);

  // Canvas sizing — measure the available area, then fit the LARGEST exact
  // 1.6:1 box inside it (computed here, not via CSS aspect-ratio, which
  // silently breaks the ratio when width + max-height conflict). The bitmap
  // is DPR-scaled so strokes stay crisp. Re-runs on isMLD so the observer
  // re-attaches to whichever layout's area element mounted.
  useEffect(() => {
    if (!chosen) return;
    const area = areaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(() => {
      // Use clientWidth/Height (CSS layout dims) — inside the MLD
      // rotated container, getBoundingClientRect returns the post-
      // transform AABB in screen coords, which made the canvas
      // calculation think the area was the short side of the phone
      // (the rotated visual width) instead of the long landscape-
      // logical width. That's why the phone canvas was tiny.
      const rW = area.clientWidth;
      const rH = area.clientHeight;
      // Cap canvas width on big monitors so strokes don't feel cramped at
      // 2000+px. Cap is desktop-only — phones and tablets get the full
      // viewport so MLD / iPad layouts stay as roomy as the device allows.
      const MAX_W = 1400;
      const isDesktop = window.innerWidth >= 1024;
      const availW = isDesktop ? Math.min(Math.max(1, rW), MAX_W) : Math.max(1, rW);
      const availH = Math.max(1, rH);
      let bw = availW;
      let bh = availW / 1.6;
      if (bh > availH) { bh = availH; bw = availH * 1.6; }
      bw = Math.max(200, Math.floor(bw));
      bh = Math.max(125, Math.floor(bh));
      setCanvasBox({ w: bw, h: bh });
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cv = canvasRef.current;
      const ov = overlayRef.current;
      if (cv) {
        cv.width = Math.floor(bw * dpr);
        cv.height = Math.floor(bh * dpr);
        setCanvasDims({ w: cv.width, h: cv.height });
        if (ov) {
          ov.width = cv.width;
          ov.height = cv.height;
        }
        redraw();
      }
    });
    ro.observe(area);
    return () => ro.disconnect();
  }, [chosen, isMLD, redraw]);

  // Reset any pinch-zoom whenever the layout changes (entering/leaving MLD,
  // or the canvas box resizing) — the transform's anchor would otherwise be
  // stale against the new layout.
  useEffect(() => {
    zoomRef.current = { scale: 1, tx: 0, ty: 0 };
    gestureActiveRef.current = false;
    gestureRef.current = null;
    touchPointersRef.current.clear();
    setZoomBadgeOn(false);
    const c = containerRef.current;
    if (c) c.style.transform = "";
  }, [isMLD, canvasBox.w, canvasBox.h]);

  // Lock viewport scroll for the whole drawing phase (phone, tablet, PC) —
  // the canvas layout is a fixed full-height grid, nothing should scroll.
  useEffect(() => {
    if (!chosen) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.overflow, b: body.style.overflow, p: body.style.position, i: body.style.inset };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.inset = "0";
    return () => {
      html.style.overflow = prev.h;
      body.style.overflow = prev.b;
      body.style.position = prev.p;
      body.style.inset = prev.i;
    };
  }, [chosen]);

  // Auto-submit when the timer runs out.
  useEffect(() => {
    if (!deadline) return;
    if (now < deadline) return;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, deadline]);

  function pickCard(c: SoloCardOption) {
    setChosen(c);
    setDeadline(Date.now() + drawSeconds * 1000);
  }

  // ----- Drawing -----
  const drawing = useRef(false);
  // The pointerId that owns the current stroke. move / up / cancel events are
  // matched against it, so a stale or out-of-order event from a *previous*
  // stroke (common on fast consecutive strokes — drawing an X) can't end the
  // stroke that's actually in progress.
  const activePointerIdRef = useRef<number | null>(null);
  // Number of stale pointerups still to swallow. When a new pointerdown
  // finalizes a still-open previous stroke (out-of-order events — the pen
  // reuses its pointerId across a quick lift-and-retouch, so id matching
  // alone can't flag the straggler), that dead stroke's delayed pointerup
  // still arrives; this counter lets us drop it instead of ending the live
  // stroke. Fixes "2nd stroke fails when it starts where the 1st ended"
  // (drawing a face outline that reverses direction at the chin).
  const staleUpsToIgnoreRef = useRef(0);

  // Window-level pointerup/cancel fallback for an active stroke. Without
  // setPointerCapture (removed for iOS), an off-canvas release fires the
  // pointerup on a *different* element — the canvas handler never sees it,
  // and `drawing.current` stays true → "ghost drawing" when the pointer
  // comes back. Attached on pointerdown, removed on stroke end.
  const winCleanupRef = useRef<(() => void) | null>(null);

  // Palm rejection. Two layers:
  //   1) "펜 전용 모드" toggle (persists across sessions) — touch always
  //      ignored regardless of recent activity. For users who only want
  //      pen input.
  //   2) Short auto lockout (PEN_LOCKOUT_MS) — once a pen event lands,
  //      finger input is suppressed for a brief window so a wrist
  //      resting on the screen can't accidentally start a stroke.
  //      Auto-falls-back to touch after the window so non-pen users
  //      aren't blocked.
  const lastPenEventAtRef = useRef(0);
  const PEN_LOCKOUT_MS = 1500;
  // Live stroke state — stabilized points (for rendering) + the brush config
  // captured at stroke start. We keep all of this in a ref so handlers don't
  // need to rebind on every state change.
  const activeStrokeRef = useRef<{
    stabilized: StrokePoint[];      // canvas-px, post-stabilizer (what we render)
    color: string;
    brush: BrushKind;
    tool: "pen" | "eraser";
    size: number;
  } | null>(null);

  const appendStroke = (p: DmStrokePayload) => { strokeBufRef.current.push(p); };
  const snapshotForUndo = () => {
    if (undoStackRef.current.length >= 20) undoStackRef.current.shift();
    undoStackRef.current.push([...strokeBufRef.current]);
  };

  // Two-finger pinch-zoom state. touchPointersRef tracks live touch points;
  // zoomRef is the committed transform; gestureRef holds the in-flight pinch
  // baseline. All refs — the gesture never triggers a React re-render (the
  // transform is written straight to the container's style).
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const zoomRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const gestureRef = useRef<{ O: { x: number; y: number }; prevM: { x: number; y: number }; prevD: number } | null>(null);
  const gestureActiveRef = useRef(false);
  // Whether the zoom badge is mounted (true for the whole gesture + while
  // zoomed in). The badge's % text is updated imperatively via zoomNumRef
  // during the pinch, so the live readout costs zero re-renders.
  const [zoomBadgeOn, setZoomBadgeOn] = useState(false);
  const zoomNumRef = useRef<HTMLSpanElement>(null);

  // rAF coalescing — pointermove fires up to 240Hz on iPad Pro etc. but we
  // only need to re-render once per frame. Points are still collected from
  // every event (so wire/buffer captures full precision); only the canvas
  // paint is throttled. Massive perf win on mobile during long strokes.
  const renderScheduledRef = useRef<number | null>(null);
  const scheduleActiveStrokeRender = () => {
    if (renderScheduledRef.current !== null) return;
    renderScheduledRef.current = requestAnimationFrame(() => {
      renderScheduledRef.current = null;
      renderActiveStroke();
    });
  };
  const flushActiveStrokeRender = () => {
    if (renderScheduledRef.current !== null) {
      cancelAnimationFrame(renderScheduledRef.current);
      renderScheduledRef.current = null;
    }
    renderActiveStroke();
  };

  /** Re-renders the in-progress stroke onto the overlay canvas. Called via
   *  rAF (scheduleActiveStrokeRender) so we never paint more than once per
   *  frame, no matter how fast pointer events arrive. */
  const renderActiveStroke = () => {
    const ov = overlayRef.current;
    const s = activeStrokeRef.current;
    if (!ov) return;
    const oc = ov.getContext("2d");
    if (!oc) return;
    oc.clearRect(0, 0, ov.width, ov.height);
    if (!s || s.stabilized.length === 0) return;
    const pixelSize = s.size * (ov.width / BRUSH_REFERENCE_WIDTH);
    renderStroke(oc, s.stabilized, {
      brush: s.brush,
      tool: s.tool,
      color: s.color,
      pixelSize,
      curve: pressureCurveRef.current,
      isPenDown: true,
    });
  };

  // Un-rotate pointer coords when the MLD container is CSS-rotated 90° CW.
  const normalizeCoords = (clientX: number, clientY: number, rect: DOMRect) => {
    if (mldRotated) {
      return {
        x: (clientY - rect.top) / rect.height,
        y: 1 - (clientX - rect.left) / rect.width,
      };
    }
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  /** PointerEvent.pressure is 0 for mouse and 0.5 for touch without pressure
   *  hardware (per spec). Treat 0 (mouse) as "no pressure" → mid 0.5 so pen
   *  strokes don't vanish on desktop. Real pen/touch with pressure passes
   *  through. */
  const extractPressure = (e: React.PointerEvent): number => {
    if (e.pointerType === "mouse") return 0.5;
    if (e.pressure === 0) return 0.5;  // touch without pressure hw
    return e.pressure;
  };

  // ----- Two-finger pinch-zoom / pan (non-MLD layout only) -----

  /** Abort the in-progress stroke without committing it — used when a second
   *  finger lands mid-draw and we switch into a pinch gesture. The overlay
   *  holds the live stroke (main canvas is untouched until commit), so wiping
   *  the overlay + restoring the pre-stroke buffer fully reverts it. */
  const cancelActiveStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    activePointerIdRef.current = null;
    const snap = undoStackRef.current.pop();   // pushed by snapshotForUndo on stroke start
    if (snap) strokeBufRef.current = snap;
    activeStrokeRef.current = null;
    if (renderScheduledRef.current !== null) {
      cancelAnimationFrame(renderScheduledRef.current);
      renderScheduledRef.current = null;
    }
    const ov = overlayRef.current;
    const oc = ov?.getContext("2d");
    if (ov && oc) oc.clearRect(0, 0, ov.width, ov.height);
    winCleanupRef.current?.();
  };

  /** Snapshot the gesture baseline: the untransformed layout origin O of the
   *  container (back-computed from its live, possibly-transformed rect) plus
   *  the current finger midpoint + spread. */
  const beginPinch = () => {
    const cont = containerRef.current;
    if (!cont) return;
    const pts = [...touchPointersRef.current.values()];
    if (pts.length < 2) return;
    const M = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const D = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const z = zoomRef.current;
    const rect = cont.getBoundingClientRect();
    // transformOrigin is "0 0", so the transformed top-left sits at O + (tx,ty);
    // back out O so it stays fixed for the whole gesture.
    gestureRef.current = {
      O: { x: rect.left - z.tx, y: rect.top - z.ty },
      prevM: M,
      prevD: D,
    };
    gestureActiveRef.current = true;
    setZoomBadgeOn(true);
  };

  /** Apply one pinch step: scale by the finger-spread ratio, anchored so the
   *  content under the finger midpoint stays put, then pan-clamp so the canvas
   *  can't be flung off-screen. Snaps back to identity near 1x. */
  const updatePinch = () => {
    const g = gestureRef.current;
    const cont = containerRef.current;
    if (!g || !cont) return;
    const pts = [...touchPointersRef.current.values()];
    if (pts.length < 2) return;
    const M = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const D = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const z = zoomRef.current;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let s = clamp(z.scale * (D / g.prevD), 1, 4);
    // Local (untransformed) content point that sat under the previous midpoint.
    const lx = (g.prevM.x - g.O.x - z.tx) / z.scale;
    const ly = (g.prevM.y - g.O.y - z.ty) / z.scale;
    // Place that same point under the new midpoint at the new scale.
    let tx = M.x - g.O.x - s * lx;
    let ty = M.y - g.O.y - s * ly;
    if (s <= 1.02) {
      s = 1; tx = 0; ty = 0;   // fully zoomed out → recenter
    } else {
      const area = areaRef.current?.getBoundingClientRect();
      if (area) {
        // Keep the canvas covering the viewport centre so it can't be lost.
        const cx = area.left + area.width / 2;
        const cy = area.top + area.height / 2;
        tx = clamp(tx, cx - g.O.x - s * canvasBox.w, cx - g.O.x);
        ty = clamp(ty, cy - g.O.y - s * canvasBox.h, cy - g.O.y);
      }
    }
    zoomRef.current = { scale: s, tx, ty };
    g.prevM = M;
    g.prevD = D;
    // Live badge readout — written straight to the DOM so the per-frame
    // pinch loop never triggers a React re-render.
    if (zoomNumRef.current) zoomNumRef.current.textContent = `${Math.round(s * 100)}%`;
    cont.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  /** Snap back to 100% — used by the corner zoom badge's tap handler. */
  const resetZoom = () => {
    zoomRef.current = { scale: 1, tx: 0, ty: 0 };
    const c = containerRef.current;
    if (c) c.style.transform = "";
    setZoomBadgeOn(false);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!chosen || (deadline && now >= deadline)) return;

    // Pen takes priority. Stamp the lockout and, crucially, drop any tracked
    // touch points + abort any gesture: on a tablet the palm resting on the
    // screen fires touch events, and without this they get mistaken for a
    // pinch and lock the pen out ("펜이 씹히는" regression).
    if (e.pointerType === "pen") {
      lastPenEventAtRef.current = Date.now();
      if (touchPointersRef.current.size > 0 || gestureActiveRef.current) {
        touchPointersRef.current.clear();
        gestureActiveRef.current = false;
        gestureRef.current = null;
      }
    }

    // Two-finger pinch-zoom / pan — non-rotated layout only. Gated behind the
    // pen-lockout window so a palm resting on the screen mid-drawing can't
    // register as a pinch. To pinch, lift the pen briefly then use two fingers
    // (this also keeps it working in 펜 전용 모드, just not while the pen is hot).
    if (
      e.pointerType === "touch" && !isMLD &&
      Date.now() - lastPenEventAtRef.current >= PEN_LOCKOUT_MS
    ) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size >= 2) {
        cancelActiveStroke();   // drop any half-drawn one-finger stroke
        beginPinch();
        return;
      }
    }

    if (e.pointerType === "touch") {
      // Pen-only mode: touch always ignored. Otherwise apply the short
      // auto-lockout after recent pen use. Mouse is always allowed.
      if (penOnlyModeRef.current) return;
      if (Date.now() - lastPenEventAtRef.current < PEN_LOCKOUT_MS) return;
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const { x, y } = normalizeCoords(e.clientX, e.clientY, rect);
    // No setPointerCapture — on iOS Safari capturing a pen pointer can swallow
    // the NEXT pen pointerdown entirely, which is what killed fast consecutive
    // strokes. The overlay fills the canvas, so moves still arrive without it.

    const t = toolRef.current;
    const col = colorRef.current;

    if (t === "fill") {
      snapshotForUndo();
      appendStroke({ op: "fill", x, y, color: col });
      const ctx = cv.getContext("2d");
      if (ctx) floodFill(ctx, cv.width, cv.height, Math.floor(x * cv.width), Math.floor(y * cv.height), col);
      return;
    }

    // Out-of-order events on fast consecutive strokes (e.g. drawing an X) can
    // deliver the previous stroke's pointerup AFTER this pointerdown. Finalize
    // any still-open stroke now so it's preserved, then bind this one to its
    // pointerId — its move/up are matched by id, so a stale event from the
    // previous stroke can't cut this one short.
    if (drawing.current) {
      appendStroke({ op: "end", x: 0, y: 0 });
      flushActiveStrokeRender();
      commitActiveStroke();
      drawing.current = false;
      // That stroke's pointerup is still in flight — mark it to be swallowed.
      staleUpsToIgnoreRef.current = Math.min(staleUpsToIgnoreRef.current + 1, 3);
    }
    drawing.current = true;
    activePointerIdRef.current = e.pointerId;
    // Window-level fallback: an off-canvas release still ends the stroke.
    {
      const captureId = e.pointerId;
      const onWinEnd = (we: PointerEvent) => {
        if (we.pointerId !== captureId) return;
        if (drawing.current) {
          drawing.current = false;
          activePointerIdRef.current = null;
          appendStroke({ op: "end", x: 0, y: 0 });
          flushActiveStrokeRender();
          commitActiveStroke();
        }
        winCleanupRef.current?.();
      };
      winCleanupRef.current?.();   // safety: clear any prior
      window.addEventListener("pointerup", onWinEnd);
      window.addEventListener("pointercancel", onWinEnd);
      winCleanupRef.current = () => {
        window.removeEventListener("pointerup", onWinEnd);
        window.removeEventListener("pointercancel", onWinEnd);
        winCleanupRef.current = null;
      };
    }
    snapshotForUndo();

    const pressure = extractPressure(e);
    const size = brushSizeRef.current;
    const px = { x: x * cv.width, y: y * cv.height, pressure };
    activeStrokeRef.current = {
      stabilized: [stabilizePoint(null, px, stabilizerRef.current)],
      color: col,
      brush: "pen",
      tool: t,
      size,
    };
    appendStroke({
      op: "start", x, y, color: col, size, tool: t,
      brush: "pen", pressure, stab: stabilizerRef.current,
    });
    scheduleActiveStrokeRender();
  };

  /** Same as extractPressure but takes a raw DOM PointerEvent — used when
   *  processing coalesced events (which are native, not synthetic). */
  const extractPressureRaw = (e: PointerEvent): number => {
    if (e.pointerType === "mouse") return 0.5;
    if (e.pressure === 0) return 0.5;
    return e.pressure;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gestureActiveRef.current) { updatePinch(); return; }
    }
    if (gestureActiveRef.current) return;
    if (!drawing.current) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    const cv = canvasRef.current;
    const s = activeStrokeRef.current;
    if (!cv || !s) return;
    const rect = cv.getBoundingClientRect();
    // Process all coalesced points (the browser may have merged several
    // sub-frame events into one) so the stored stroke keeps its full
    // precision even though the canvas paint is rAF-throttled.
    const native = e.nativeEvent as PointerEvent;
    const events: PointerEvent[] = native.getCoalescedEvents
      ? native.getCoalescedEvents()
      : [native];
    if (events.length === 0) events.push(native);
    for (const ev of events) {
      const { x, y } = normalizeCoords(ev.clientX, ev.clientY, rect);
      const pressure = extractPressureRaw(ev);
      const px = { x: x * cv.width, y: y * cv.height, pressure };
      const prev = s.stabilized[s.stabilized.length - 1];
      s.stabilized.push(stabilizePoint(prev, px, stabilizerRef.current));
      appendStroke({ op: "move", x, y, pressure });
    }
    scheduleActiveStrokeRender();
  };

  const commitActiveStroke = () => {
    const cv = canvasRef.current;
    const ov = overlayRef.current;
    if (!cv || !ov) return;
    const mc = cv.getContext("2d");
    if (!mc) return;
    mc.drawImage(ov, 0, 0);
    const oc = ov.getContext("2d");
    oc?.clearRect(0, 0, ov.width, ov.height);
    activeStrokeRef.current = null;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.delete(e.pointerId);
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      if (gestureActiveRef.current) {
        // A finger lifted: re-baseline if 2+ remain, otherwise end the gesture.
        if (touchPointersRef.current.size >= 2) beginPinch();
        else {
          gestureActiveRef.current = false;
          gestureRef.current = null;
          if (zoomRef.current.scale <= 1.02) setZoomBadgeOn(false);
        }
        return;
      }
    }
    if (!drawing.current) return;
    // Swallow the straggler pointerup of a stroke already finalized by the
    // next pointerdown — otherwise it ends the stroke that's now live.
    if (staleUpsToIgnoreRef.current > 0) {
      staleUpsToIgnoreRef.current -= 1;
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    drawing.current = false;
    activePointerIdRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    appendStroke({ op: "end", x: 0, y: 0 });
    // Force a final sync render so the last few coalesced points appear
    // before we commit overlay → main (otherwise a pending rAF could
    // commit a stale overlay snapshot).
    flushActiveStrokeRender();
    commitActiveStroke();
    winCleanupRef.current?.();
  };

  function undo() {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    strokeBufRef.current = prev;
    redraw();
  }
  function clearAll() {
    snapshotForUndo();
    strokeBufRef.current = [];
    redraw();
  }

  // ----- Reference image overlay drag/resize (rotation-aware) -----
  const overlayDragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number; pointerId: number } | null>(null);
  const overlayResizeRef = useRef<{ startX: number; startY: number; startRatio: number; canvasW: number; pointerId: number } | null>(null);

  const onOverlayDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origTop: overlayPos.top, origLeft: overlayPos.left,
      pointerId: e.pointerId,
    };
  };
  const onOverlayDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = overlayDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    const dxLogical = mldRotated ? dyScreen : dxScreen;
    const dyLogical = mldRotated ? -dxScreen : dyScreen;
    // Overlay can drift anywhere on screen including over the palette —
    // users complained that clamping it out of the palette band stranded
    // it in too small an area on phones. Only clamp to the screen edge.
    const scr = screenRef.current;
    const overlayEl = e.currentTarget.parentElement as HTMLElement | null;
    let nextTop = Math.max(0, d.origTop + dyLogical);
    let nextLeft = Math.max(0, d.origLeft + dxLogical);
    if (scr && overlayEl) {
      const cvR = scr.getBoundingClientRect();
      const ovR = overlayEl.getBoundingClientRect();
      const cvW = mldRotated ? cvR.height : cvR.width;
      const cvH = mldRotated ? cvR.width : cvR.height;
      const ovW = mldRotated ? ovR.height : ovR.width;
      const ovH = mldRotated ? ovR.width : ovR.height;
      nextLeft = Math.min(nextLeft, Math.max(0, cvW - ovW));
      nextTop = Math.min(nextTop, Math.max(0, cvH - ovH));
    }
    setOverlayPos({ top: nextTop, left: nextLeft });
  };
  const onOverlayDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (overlayDragRef.current?.pointerId === e.pointerId) overlayDragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  const onOverlayResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cvR = screenRef.current?.getBoundingClientRect();
    overlayResizeRef.current = {
      startX: e.clientX, startY: e.clientY,
      startRatio: overlayWidthRatio,
      canvasW: mldRotated ? (cvR?.height || 1) : (cvR?.width || 1),
      pointerId: e.pointerId,
    };
  };
  const onOverlayResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = overlayResizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const dx = mldRotated ? (e.clientY - r.startY) : (e.clientX - r.startX);
    setOverlayWidthRatio(Math.max(0.1, Math.min(0.8, r.startRatio + dx / r.canvasW)));
  };
  const onOverlayResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (overlayResizeRef.current?.pointerId === e.pointerId) overlayResizeRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  // ----- Submit -----
  async function submit() {
    if (!chosen || submitting) return;
    setSubmitting(true);
    try {
      const res = await soloApi.submitDraw({
        offer_token: offerToken,
        card_id: chosen.card_id,
        strokes: strokeBufRef.current,
        // Canvas is always 1.6:1 now — kept for API compatibility.
        aspect_ratio: 1.6,
      });
      // Invalidate the board cache — a new drawing shifts page 1 (and
      // every page after), so returning to the board should re-fetch
      // fresh data with this drawing included, no stale flash.
      clearBoardCache();
      navigate(`/solo-duchmind/${res.id}`);
    } catch (e: any) {
      setErr(String(e.message || e));
      setSubmitting(false);
    }
  }

  // ============ Render: error ============
  if (err && !options) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md text-center">
          <div className="text-red-600 mb-3">{err}</div>
          <button onClick={() => navigate("/solo-duchmind")} className="px-4 py-2 rounded-lg bg-blue-600 text-white">돌아가기</button>
        </div>
      </div>
    );
  }

  // ============ Render: card-pick phase ============
  if (!chosen) {
    return (
      <div className="min-h-svh bg-gray-50 dark:bg-gray-900 px-3 py-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl sm:text-2xl font-bold mb-2">그릴 카드 선택</h1>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            카드 한 장을 골라 그려주세요. 선택하면 {drawSeconds}초 타이머가 시작됩니다.
            <br />
            <span className="text-xs text-gray-400">※ 새로고침해도 같은 3장이 유지돼요 — 마음에 드는 카드가 나올 때까지 다시 받을 수 없습니다.</span>
          </div>
          {options ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {options.map((c) => (
                <button
                  key={c.card_id}
                  onClick={() => pickCard(c)}
                  className="text-left bg-white dark:bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 transition-colors"
                >
                  {c.image_url && (
                    <img src={c.image_url} alt={c.name} className="w-full aspect-square object-cover bg-gray-100" />
                  )}
                  <div className="p-2 font-semibold">{c.name}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-gray-500">카드 가져오는 중...</div>
          )}
          <div className="mt-4">
            <button onClick={() => navigate("/solo-duchmind")} className="text-sm text-gray-500 underline">취소하고 돌아가기</button>
          </div>
        </div>
      </div>
    );
  }

  // ============ Drawing phase ============
  const remainingMs = deadline ? Math.max(0, deadline - now) : 0;
  const timeUp = remainingMs <= 0;

  // Shared palette markup (used by both MLD + desktop layouts).
  const colorButtons = (
    <>
      {COLORS.map((c) => {
        const pick = () => { setColor(c); if (tool === "eraser") setTool("pen"); };
        return (
          <button
            key={c}
            onPointerDown={pick}
            onClick={pick}
            className={`w-full h-full rounded border-2 ${color === c && tool !== "eraser" ? "!border-[3px] border-blue-500 ring-2 ring-white dark:ring-gray-800 relative z-10" : "border-gray-300 dark:border-gray-600"}`}
            style={{ background: c, touchAction: "manipulation", transition: "none", minHeight: 0 }}
          />
        );
      })}
      <button
        onClick={handleWheelButton}
        className={`w-full h-full rounded border-2 ${tool !== "eraser" && !COLORS.includes(color) ? "border-blue-500" : "border-gray-300 dark:border-gray-600"}`}
        style={{
          background: customColor
            ? customColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
          touchAction: "manipulation", transition: "none", minHeight: 0,
        }}
        title="색상환"
      />
    </>
  );
  const brushButtons = BRUSH_SIZES.map((s) => (
    <button
      key={s}
      onPointerDown={() => setBrushSize(s)}
      onClick={() => setBrushSize(s)}
      className={`w-full h-full rounded border flex items-center justify-center ${brushSize === s ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
      style={{ touchAction: "manipulation", transition: "none" }}
      title={`굵기 ${s}px`}
    >
      <span className="rounded-full bg-black dark:bg-white" style={{ width: Math.min(s, 10), height: Math.min(s, 10) }} />
    </button>
  ));

  const settingsModal = settingsOpen && (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold mb-3">그림 설정</h3>
        <div className="mb-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            손떨림 보정 <span className="text-gray-400">— 강할수록 선이 부드럽지만 펜 끝이 늦게 따라옵니다</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {STABILIZER_LABELS.map((lbl, i) => (
              <button
                key={lbl}
                onClick={() => setStabilizer(i as StabilizerLevel)}
                className={`px-2 py-1.5 text-xs rounded border ${stabilizer === i ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >{lbl}</button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            압력 민감도 <span className="text-gray-400">— 펜 압력 → 굵기 변화 곡선</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["low", "mid", "high"] as PressureCurve[]).map((c) => (
              <button key={c} onClick={() => setPressureCurve(c)}
                className={`px-2 py-1.5 text-xs rounded border ${pressureCurve === c ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >{PRESSURE_CURVE_LABELS[c]}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 mb-3 p-2 rounded border border-gray-300 dark:border-gray-600 cursor-pointer">
          <span className="text-xs">
            <span className="font-semibold">펜 전용 모드</span>
            <span className="block text-gray-500 dark:text-gray-400">손가락 입력 항상 무시 (Apple Pencil 등)</span>
          </span>
          <input
            type="checkbox"
            checked={penOnlyMode}
            onChange={(e) => setPenOnlyMode(e.target.checked)}
            className="w-5 h-5"
          />
        </label>
        <button onClick={() => setSettingsOpen(false)} className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold">닫기</button>
      </div>
    </div>
  );

  // Reference-image overlay (shared). Positioned absolute inside the canvas
  // wrapper; draggable + resizable.
  const refOverlay = chosen.image_url && refVisible && (
    <div
      className="absolute z-30 bg-white rounded-lg shadow-lg border-2 border-blue-300 dark:border-blue-700"
      style={{
        top: overlayPos.top, left: overlayPos.left, overflow: "hidden",
        // Width is computed against the canvas box (not the parent screen)
        // so the overlay's footprint scales with the actual drawing surface,
        // matching the multiplayer DM behavior. Otherwise on big monitors a
        // 30% ratio of the full viewport produced a giant overlay.
        width: `${Math.max(80, canvasBox.w * overlayWidthRatio)}px`,
        aspectRatio: "1 / 1",
        minWidth: "70px", minHeight: "70px", maxWidth: "80%", maxHeight: "85%",
      }}
    >
      <div
        onPointerDown={onOverlayDragStart}
        onPointerMove={onOverlayDragMove}
        onPointerUp={onOverlayDragEnd}
        onPointerCancel={onOverlayDragEnd}
        className="absolute top-0 left-0 right-0 h-8 bg-blue-100 dark:bg-blue-900/40 cursor-move flex items-center justify-center select-none touch-none"
        title="드래그해서 이동"
      >
        <span className="text-[10px] text-blue-600 dark:text-blue-300 leading-none">⋮⋮ 드래그</span>
      </div>
      <button
        type="button"
        onClick={() => setRefVisible(false)}
        className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-white text-gray-900 font-bold text-xs shadow border border-gray-300 z-10 flex items-center justify-center"
        aria-label="참고 이미지 닫기"
        style={{ touchAction: "manipulation" }}
      >✕</button>
      <img
        src={chosen.image_url}
        alt="참고 이미지"
        className="block w-full object-contain pointer-events-none"
        style={{ height: "calc(100% - 32px)", marginTop: 32 }}
        draggable={false}
      />
      <div
        onPointerDown={onOverlayResizeStart}
        onPointerMove={onOverlayResizeMove}
        onPointerUp={onOverlayResizeEnd}
        onPointerCancel={onOverlayResizeEnd}
        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize bg-blue-100 dark:bg-blue-900/40 rounded-tl-md flex items-end justify-end p-0.5 select-none touch-none z-10"
        title="드래그해서 크기 조절"
        style={{ touchAction: "none" }}
      >
        <span className="text-[10px] text-blue-700 dark:text-blue-300 leading-none">↘</span>
      </div>
    </div>
  );

  const canvasEl = (
    <>
      <canvas
        ref={canvasRef}
        width={canvasDims.w}
        height={canvasDims.h}
        className="block w-full h-full absolute inset-0"
      />
      <canvas
        ref={overlayRef}
        width={canvasDims.w}
        height={canvasDims.h}
        className="block w-full h-full absolute inset-0"
        style={{
          touchAction: "none",
          cursor: tool === "fill" ? "cell" : "crosshair",
          WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </>
  );

  // ---------- MLD (mobile) drawing layout ----------
  if (isMLD) {
    // Suppress text-selection / iOS long-press callout everywhere in the
    // draw UI so a stray drag on a button or label can't start a selection.
    const noDragStyle: React.CSSProperties = {
      touchAction: "none", overscrollBehavior: "none",
      WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
    };
    const mldStyle: React.CSSProperties = mldRotated
      ? {
          top: "50%", left: "50%", width: "100svh", height: "100vw",
          transform: "translate(-50%, -50%) rotate(90deg)", transformOrigin: "center",
          ...noDragStyle,
        }
      : { inset: 0, height: "100svh", ...noDragStyle };
    return (
      <div
        ref={screenRef}
        className="fixed z-30 flex flex-row bg-gray-100 dark:bg-gray-900 overflow-hidden select-none"
        style={mldStyle}
      >
        {/* Palette stripe */}
        <aside className="shrink-0 w-[96px] sm:w-[104px] bg-white dark:bg-gray-800 p-1 flex flex-col gap-1 overflow-hidden">
          <div className="grid grid-cols-3 gap-1 flex-[6] min-h-0" style={{ gridAutoRows: "1fr" }}>
            {colorButtons}
          </div>
          <div className="grid grid-cols-4 gap-1 shrink-0" style={{ gridAutoRows: "minmax(0, 24px)" }}>
            {brushButtons}
          </div>
          <div className="grid grid-cols-1 gap-1 flex-[5] min-h-0" style={{ gridAutoRows: "1fr" }}>
            <button onPointerDown={() => setTool("pen")} onClick={() => setTool("pen")}
              className={`w-full h-full rounded border text-[10px] ${tool === "pen" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}>🖊 펜</button>
            <button onPointerDown={() => setTool("fill")} onClick={() => setTool("fill")}
              className={`w-full h-full rounded border text-[10px] ${tool === "fill" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}>🪣 채우기</button>
            <button onPointerDown={() => setTool("eraser")} onClick={() => setTool("eraser")}
              className={`w-full h-full rounded border text-[10px] ${tool === "eraser" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}>지우개</button>
            <button onClick={undo}
              className="w-full h-full rounded border border-gray-300 dark:border-gray-600 text-[10px]"
              style={{ touchAction: "manipulation", minHeight: 0 }}>↶ 되돌리기</button>
            <button onClick={clearAll}
              className="w-full h-full rounded border border-red-300 text-red-600 text-[10px]"
              style={{ touchAction: "manipulation", minHeight: 0 }}>🗑 전체</button>
            <button onClick={() => setSettingsOpen(true)}
              className="w-full h-full rounded border border-gray-300 dark:border-gray-600 text-[10px]"
              style={{ touchAction: "manipulation", minHeight: 0 }}>⚙️ 설정</button>
          </div>
        </aside>

        {/* Right: status bar + canvas */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 h-9 px-2 flex items-center justify-between bg-white dark:bg-gray-800 text-xs gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">주제</span>
              <span className="font-bold truncate">{chosen.name}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`font-mono font-bold ${remainingMs < 10000 ? "text-red-600" : ""}`}>
                {formatSec(remainingMs / 1000)}
              </span>
              {chosen.image_url && !refVisible && (
                <button onClick={() => setRefVisible(true)} className="px-2 py-1 rounded bg-blue-600 text-white text-[10px]"
                  style={{ touchAction: "manipulation" }} title="참고 이미지 다시 띄우기">🖼️</button>
              )}
              <button
                onClick={() => setFullscreenDrawing(false)}
                className="px-2 py-1 rounded bg-gray-600 text-white text-[10px]"
                style={{ touchAction: "manipulation" }}
                title="원본 비율로 돌아가기"
              >↙ 원본</button>
              <button
                onClick={submit}
                disabled={submitting || timeUp}
                className={`px-3 py-1 rounded text-xs font-semibold ${submitting || timeUp ? "bg-gray-500 text-gray-200" : "bg-blue-600 text-white"}`}
                style={{ touchAction: "manipulation" }}
              >제출</button>
            </div>
          </div>
          <div ref={areaRef} className="flex-1 min-h-0 bg-gray-300 dark:bg-gray-700 relative overflow-hidden flex items-center justify-center">
            <div
              ref={containerRef}
              className="bg-white relative overflow-hidden"
              style={{ width: canvasBox.w, height: canvasBox.h }}
            >
              {canvasEl}
            </div>
          </div>
        </main>

        {refOverlay}

        {wheelOpen && (
          <div className="absolute inset-0 z-40">
            <ColorWheelPicker
              value={customColor || "#ffffff"}
              onChange={(c) => { setColor(c); setCustomColor(c); if (tool === "eraser") setTool("pen"); }}
              onClose={() => setWheelOpen(false)}
              rotated={mldRotated}
            />
          </div>
        )}
        {settingsModal}
      </div>
    );
  }

  // ---------- Desktop / tablet drawing layout ----------
  // Full-viewport flex column, nothing scrolls: header + palette take their
  // natural height, the canvas absorbs everything left over and is the
  // letterbox-centered 1.6:1 surface (so it ends up far larger than the old
  // max-w-3xl box).
  return (
    <div
      ref={screenRef}
      className="fixed inset-0 flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden select-none"
      style={{ height: "100svh", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800">
        <div className="min-w-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">주제</div>
          <div className="text-lg font-bold truncate">{chosen.name}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {chosen.image_url && !refVisible && (
            <button onClick={() => setRefVisible(true)} className="px-2 py-1 rounded bg-blue-600 text-white text-xs"
              title="참고 이미지 다시 띄우기">🖼️ 참고</button>
          )}
          {isPhone && (
            <button
              onClick={() => setFullscreenDrawing(true)}
              className="px-2 py-1 rounded bg-gray-700 text-white text-xs"
              style={{ touchAction: "manipulation" }}
              title="전체화면 (가로 회전)"
            >📱 전체화면</button>
          )}
          <div className={`text-2xl font-mono font-bold ${remainingMs < 10000 ? "text-red-600" : ""}`}>
            {formatSec(remainingMs / 1000)}
          </div>
          <button
            onClick={submit}
            disabled={submitting || timeUp}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${submitting || timeUp ? "bg-gray-500 text-gray-200" : "bg-blue-600 text-white hover:bg-blue-700"}`}
          >제출</button>
        </div>
      </div>

      {/* Canvas keeps a fixed 1.6:1 ratio and grows as large as fits inside
          the middle band (box size computed in JS). On a portrait screen
          it's width-constrained, so it ends up a wide strip pinned to the
          top (items-start) with the leftover space below. */}
      <div ref={areaRef} className="flex-1 min-h-0 bg-gray-300 dark:bg-gray-700 relative overflow-hidden flex items-start justify-center">
        <div
          ref={containerRef}
          className="bg-white overflow-hidden border-2 border-gray-300 dark:border-gray-600 relative"
          style={{ width: canvasBox.w, height: canvasBox.h, transformOrigin: "0 0", willChange: "transform" }}
        >
          {canvasEl}
        </div>
        {zoomBadgeOn && (
          <button
            type="button"
            onClick={resetZoom}
            className="absolute top-2 right-2 z-40 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-semibold shadow flex items-center gap-1"
            style={{ touchAction: "manipulation" }}
            title="원래 크기로"
          >
            🔍 <span ref={zoomNumRef}>{Math.round(zoomRef.current.scale * 100)}%</span> <span className="opacity-70">↺</span>
          </button>
        )}
      </div>

      {refOverlay}

      {/* Palette */}
      <div className="shrink-0 bg-white dark:bg-gray-800 p-2 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex flex-wrap gap-1">
          {COLORS.map((c) => {
            const pick = () => { setColor(c); if (tool === "eraser") setTool("pen"); };
            return (
              <button
                key={c}
                onPointerDown={pick}
                onClick={pick}
                className={`w-8 h-8 rounded border-2 ${color === c && tool !== "eraser" ? "!border-[3px] border-blue-500 ring-2 ring-white dark:ring-gray-800 relative z-10" : "border-gray-300 dark:border-gray-600"}`}
                style={{ background: c, touchAction: "manipulation", transition: "none" }}
              />
            );
          })}
          <button
            onClick={handleWheelButton}
            className={`w-8 h-8 rounded border-2 ${tool !== "eraser" && !COLORS.includes(color) ? "border-blue-500" : "border-gray-300 dark:border-gray-600"}`}
            style={{
              background: customColor
                ? customColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              touchAction: "manipulation", transition: "none",
            }}
            title="색상환"
          />
        </div>
        <div className="flex gap-1 shrink-0">
          {BRUSH_SIZES.map((s) => (
            <button
              key={s}
              onPointerDown={() => setBrushSize(s)}
              onClick={() => setBrushSize(s)}
              className={`w-8 h-8 rounded border flex items-center justify-center ${brushSize === s ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", transition: "none" }}
              title={`굵기 ${s}px`}
            >
              <span className="rounded-full bg-black dark:bg-white" style={{ width: s, height: s }} />
            </button>
          ))}
        </div>
        <button onClick={() => setTool("pen")}
          className={`px-3 py-1.5 rounded border text-sm ${tool === "pen" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
          style={{ touchAction: "manipulation" }}>🖊 펜</button>
        <button onClick={() => setTool("fill")}
          className={`px-3 py-1.5 rounded border text-sm ${tool === "fill" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
          style={{ touchAction: "manipulation" }}>🪣 채우기</button>
        <button onClick={() => setTool("eraser")}
          className={`px-3 py-1.5 rounded border text-sm ${tool === "eraser" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
          style={{ touchAction: "manipulation" }}>지우개</button>
        <button onClick={undo} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm" style={{ touchAction: "manipulation" }}>↶ 되돌리기</button>
        <button onClick={clearAll} className="px-3 py-1.5 rounded border border-red-300 text-red-600 text-sm" style={{ touchAction: "manipulation" }}>🗑 전체</button>
        <button onClick={() => setSettingsOpen(true)} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm" style={{ touchAction: "manipulation" }}>⚙️ 설정</button>
        {err && <span className="text-red-600 text-xs">{err}</span>}
      </div>

      {wheelOpen && (
        <ColorWheelPicker
          value={customColor || "#ffffff"}
          onChange={(c) => { setColor(c); setCustomColor(c); if (tool === "eraser") setTool("pen"); }}
          onClose={() => setWheelOpen(false)}
        />
      )}
      {settingsModal}
    </div>
  );
}
