/** Shared canvas helpers for DuchMind drawing (multiplayer + solo).
 *
 * Strokes use normalized coords (0..1) so they replay correctly across
 * different canvas sizes. Brush thickness is stored as if drawn on an
 * 800px-wide canvas and rescaled at render time.
 *
 * v2 (2026-05-17): new brush engine on top of `perfect-freehand`.
 *   - 4 brush kinds (pen / pencil / marker / airbrush) with distinct dynamics
 *   - per-point pressure (PointerEvent.pressure with velocity fallback)
 *   - line stabilizer (lazy-cursor smoothing, SAI-style)
 *   - pressure curve (low/mid/high sensitivity)
 *
 * Stroke payloads stay incremental (start/move/end/fill) for backward
 * compatibility on the wire and in stored Solo Duchmind buffers. Old
 * strokes (no `brush` field) render as the default pen.
 */
import { getStroke } from "perfect-freehand";

export const BRUSH_REFERENCE_WIDTH = 800;

export type BrushKind = "pen" | "pencil" | "marker" | "airbrush";
export type StabilizerLevel = 0 | 1 | 2 | 3;
export type PressureCurve = "low" | "mid" | "high";

export type DmStrokePayload = {
  op: "start" | "move" | "end" | "fill";
  x: number;
  y: number;
  color?: string;
  size?: number;
  tool?: "pen" | "eraser" | "fill";
  /** PointerEvent.pressure (0..1) — falls back to 0.5 for non-pressure inputs. */
  pressure?: number;
  /** Brush kind for the stroke. Sent on "start"; "move"/"end" inherit it. */
  brush?: BrushKind;
  /** Stabilizer level applied at record time. Sent on "start"; remote
   *  viewers + replay re-apply the same level so all renderings match. */
  stab?: StabilizerLevel;
};

export type StrokePoint = { x: number; y: number; pressure: number };

export function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b, 255];
}

/** Scanline flood-fill; iterative so it can fill large regions without
 * blowing the JS call stack. */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  sx: number, sy: number,
  hexColor: string,
) {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const startIdx = idx(sx, sy);
  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
  const [tr, tg, tb, ta] = hexToRgba(hexColor);
  if (sr === tr && sg === tg && sb === tb && sa === ta) return;

  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    let lx = x;
    while (lx >= 0) {
      const i = idx(lx, y);
      if (data[i] !== sr || data[i + 1] !== sg || data[i + 2] !== sb || data[i + 3] !== sa) break;
      lx--;
    }
    lx++;
    let spanAbove = false;
    let spanBelow = false;
    let cx = lx;
    while (cx < w) {
      const i = idx(cx, y);
      if (data[i] !== sr || data[i + 1] !== sg || data[i + 2] !== sb || data[i + 3] !== sa) break;
      data[i] = tr; data[i + 1] = tg; data[i + 2] = tb; data[i + 3] = ta;
      if (y > 0) {
        const i2 = idx(cx, y - 1);
        const match = data[i2] === sr && data[i2 + 1] === sg && data[i2 + 2] === sb && data[i2 + 3] === sa;
        if (!spanAbove && match) { stack.push(cx, y - 1); spanAbove = true; }
        else if (spanAbove && !match) spanAbove = false;
      }
      if (y < h - 1) {
        const i2 = idx(cx, y + 1);
        const match = data[i2] === sr && data[i2 + 1] === sg && data[i2 + 2] === sb && data[i2 + 3] === sa;
        if (!spanBelow && match) { stack.push(cx, y + 1); spanBelow = true; }
        else if (spanBelow && !match) spanBelow = false;
      }
      cx++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ============================================================================
// Stabilizer (lazy-cursor / N-point moving avg)
// ============================================================================

/** Stabilizes a raw point against the previous stabilized point.
 *
 *   level 0: pass through (no smoothing)
 *   level 1: 30% blend toward target  (light)
 *   level 2: 55% blend                 (medium)
 *   level 3: 75% blend                 (strong — SAI's heavy)
 *
 * The effect: the rendered pen-tip lags behind the cursor, allowing the user
 * to draw smooth curves with a shaky hand. Output position is computed once
 * per raw point, deterministically — so it's safe to use on both the local
 * drawer and remote viewers (we re-stabilize on replay).
 *
 * NOTE: stabilizer is applied locally only (we don't transmit stabilized
 * coords). Remote viewers receive the raw stream and apply no smoothing —
 * the visible difference is small once strokes are committed via
 * perfect-freehand. The drawer's own preview is the canonical look.
 */
export function stabilizePoint(
  prev: StrokePoint | null,
  raw: StrokePoint,
  level: StabilizerLevel,
): StrokePoint {
  if (level <= 0 || !prev) return raw;
  const t = level === 1 ? 0.7 : level === 2 ? 0.45 : 0.25;  // smaller t = stronger smoothing
  return {
    x: prev.x + (raw.x - prev.x) * t,
    y: prev.y + (raw.y - prev.y) * t,
    pressure: prev.pressure + (raw.pressure - prev.pressure) * t,
  };
}

// ============================================================================
// Pressure curve (maps 0..1 → 0..1 with adjustable bias)
// ============================================================================

export function applyPressureCurve(p: number, curve: PressureCurve): number {
  const x = Math.max(0, Math.min(1, p));
  if (curve === "high") return x * x;           // light strokes → very thin
  if (curve === "low") return Math.sqrt(x);     // small pressure → already thick
  return x;                                     // mid: linear
}

// ============================================================================
// Stroke rendering — 4 brush kinds
// ============================================================================

const BRUSH_OPTIONS: Record<BrushKind, {
  thinning: number;
  smoothing: number;
  streamline: number;
  // multiplier applied to base stroke size
  sizeMul: number;
  // global alpha when stamping the stroke
  alpha: number;
}> = {
  pen:       { thinning: 0.55, smoothing: 0.55, streamline: 0.55, sizeMul: 1.0, alpha: 1.0 },
  // Pencil — flatter pressure (consistent width), lower opacity for that
  //   "graphite stippling" feel (we layer noise on top below).
  pencil:    { thinning: 0.30, smoothing: 0.40, streamline: 0.50, sizeMul: 0.9, alpha: 0.85 },
  // Marker — very flat width, semi-transparent so crossings darken.
  marker:    { thinning: 0.10, smoothing: 0.55, streamline: 0.60, sizeMul: 1.4, alpha: 0.55 },
  // Airbrush handled with a separate stamping renderer (not perfect-freehand).
  airbrush:  { thinning: 0.0,  smoothing: 0.0,  streamline: 0.0,  sizeMul: 1.0, alpha: 1.0 },
};

function getPerfectFreehandOutline(
  points: StrokePoint[],
  pixelSize: number,
  brush: BrushKind,
  curve: PressureCurve,
  isPenDown: boolean,
): number[][] {
  const { thinning, smoothing, streamline, sizeMul } = BRUSH_OPTIONS[brush];
  // Feed perfect-freehand the pressure-curved values so its thinning behaves
  // the way the user expects (high sensitivity = light strokes turn thin
  // faster).
  const pts = points.map((p) => [p.x, p.y, applyPressureCurve(p.pressure, curve)]);
  return getStroke(pts, {
    size: pixelSize * sizeMul,
    thinning,
    smoothing,
    streamline,
    simulatePressure: false,  // we always supply pressure (real or fallback)
    last: !isPenDown,         // closes the tail of finished strokes
    start: { taper: 0, cap: true },
    end:   { taper: 0, cap: true },
  }) as number[][];
}

/** Render a single point as a tiny dot (used when a stroke has only one point —
 *  perfect-freehand returns nothing degenerate for a 1-point input). */
function renderDot(
  ctx: CanvasRenderingContext2D,
  p: StrokePoint,
  color: string,
  pixelSize: number,
  brush: BrushKind,
  curve: PressureCurve,
) {
  const { sizeMul, alpha } = BRUSH_OPTIONS[brush];
  const pressed = applyPressureCurve(p.pressure, curve);
  const r = (pixelSize * sizeMul * Math.max(0.3, pressed)) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Stamp an airbrush soft circle at a single position (radial gradient). */
function airbrushStamp(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  color: string,
  radius: number,
) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0.0, hexWithAlpha(color, 0.18));
  grad.addColorStop(0.6, hexWithAlpha(color, 0.08));
  grad.addColorStop(1.0, hexWithAlpha(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function hexWithAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Render an entire stroke (array of pixel-space points) onto a canvas.
 *  The caller is responsible for the canvas's pre-stroke state (clearing the
 *  active-stroke layer, or restoring a snapshot of the main canvas before
 *  re-rendering the in-progress stroke). */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  opts: {
    brush: BrushKind;
    tool: "pen" | "eraser";
    color: string;
    pixelSize: number;
    curve: PressureCurve;
    isPenDown: boolean;
  },
) {
  if (points.length === 0) return;
  const { brush, tool, color, pixelSize, curve, isPenDown } = opts;
  const drawColor = tool === "eraser" ? "#ffffff" : color;

  if (brush === "airbrush" && tool === "pen") {
    // Stamp soft circles along the path with low alpha so they build up.
    const baseRadius = pixelSize * 1.2;
    ctx.save();
    if (points.length === 1) {
      airbrushStamp(ctx, points[0].x, points[0].y,
        drawColor, baseRadius * Math.max(0.3, applyPressureCurve(points[0].pressure, curve)));
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        // Step density: ~1 stamp per (radius * 0.25) pixels.
        const radius = baseRadius * Math.max(0.3, applyPressureCurve(b.pressure, curve));
        const step = Math.max(1, radius * 0.25);
        const n = Math.max(1, Math.ceil(dist / step));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          airbrushStamp(ctx, a.x + dx * t, a.y + dy * t, drawColor, radius);
        }
      }
    }
    ctx.restore();
    return;
  }

  if (points.length === 1) {
    renderDot(ctx, points[0], drawColor, pixelSize, brush, curve);
    return;
  }

  const outline = getPerfectFreehandOutline(points, pixelSize, brush, curve, isPenDown);
  // perfect-freehand swallows initial points until the user has dragged
  // ≥ `size` pixels (so larger brushes feel laggy at stroke start —
  // "한동안 선이 안 그어진다"). Render a plain polyline fallback so the
  // stroke shows up instantly; once getStroke kicks in, its variable-width
  // outline covers the polyline.
  if (outline.length < 4) {
    ctx.save();
    ctx.globalAlpha = BRUSH_OPTIONS[brush].alpha;
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = Math.max(1, pixelSize * BRUSH_OPTIONS[brush].sizeMul * 0.7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  // Eraser is painted white (canvas background is white anyway). Avoids
  // destination-out, which would make overlay compositing onto the main
  // canvas a no-op (transparent pixels don't erase the layer below).
  ctx.globalAlpha = tool === "eraser" ? 1 : BRUSH_OPTIONS[brush].alpha;
  ctx.fillStyle = drawColor;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1]);
  }
  ctx.closePath();
  ctx.fill();

  // Pencil overlay — fine grain noise. Uses a deterministic hash so the
  // pattern stays stable across re-renders of the same stroke (with
  // Math.random it visibly twinkled every frame AND wasted RNG calls).
  if (brush === "pencil" && tool === "pen") {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    const step = 3;
    const hash = (a: number, b: number) => {
      const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.floor(dist / step));
      for (let k = 0; k < n; k++) {
        if (hash(i, k) > 0.55) continue;
        const t = k / n;
        const jx = (hash(i, k + 1.7) - 0.5) * pixelSize * 0.6;
        const jy = (hash(i, k + 3.3) - 0.5) * pixelSize * 0.6;
        ctx.fillRect(a.x + (b.x - a.x) * t + jx, a.y + (b.y - a.y) * t + jy, 1, 1);
      }
    }
  }
  ctx.restore();
}

// ============================================================================
// Stroke buffer replay (for reconnect / saved drawings)
// ============================================================================

/** Render an entire stroke buffer onto a canvas (white background first).
 *
 *  Splits the buffer into per-stroke segments (start..end) and renders each
 *  using the new engine. Old payloads without brush/pressure work via the
 *  fallbacks (default pen, pressure 0.5). */
export function replayStrokes(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  strokes: DmStrokePayload[],
  opts?: { curve?: PressureCurve },
) {
  const curve = opts?.curve ?? "mid";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Accumulate per-stroke. A "stroke" starts at "start" and ends at the next
  // "end" (or whenever the buffer flips to a different op like fill).
  let cur: StrokePoint[] = [];
  let curColor = "#000000";
  let curSize = 4;
  let curTool: "pen" | "eraser" = "pen";
  let curBrush: BrushKind = "pen";
  let curStab: StabilizerLevel = 0;
  /** Stabilizes a raw payload point against the previous stabilized one and
   *  pushes the result onto `cur`. Caller is responsible for raw → canvas-px
   *  conversion before calling (x/y are already in canvas px). */
  const pushStabilized = (rawX: number, rawY: number, rawP: number) => {
    const raw: StrokePoint = { x: rawX, y: rawY, pressure: rawP };
    const prev = cur.length > 0 ? cur[cur.length - 1] : null;
    cur.push(stabilizePoint(prev, raw, curStab));
  };
  const flush = (isPenDown: boolean) => {
    if (cur.length === 0) return;
    const pixelSize = curSize * (w / BRUSH_REFERENCE_WIDTH);
    renderStroke(ctx, cur, {
      brush: curBrush, tool: curTool, color: curColor,
      pixelSize, curve, isPenDown,
    });
    cur = [];
  };

  for (const p of strokes) {
    const x = p.x * w;
    const y = p.y * h;
    if (p.op === "fill") {
      flush(false);
      floodFill(ctx, w, h, Math.floor(x), Math.floor(y), p.color || "#000000");
    } else if (p.op === "start") {
      flush(false);
      curColor = p.color || "#000000";
      curSize = p.size || 4;
      curTool = (p.tool === "fill" ? "pen" : p.tool) || "pen";
      curBrush = p.brush || "pen";
      curStab = (p.stab ?? 0) as StabilizerLevel;
      pushStabilized(x, y, p.pressure ?? 0.5);
    } else if (p.op === "move") {
      pushStabilized(x, y, p.pressure ?? 0.5);
    } else if (p.op === "end") {
      // op:"end" carries x:0, y:0 sentinels — don't append, just flush.
      flush(false);
    }
  }
  // Trailing stroke without explicit end (e.g. mid-stroke disconnect).
  flush(true);
}

/** Fast, low-fidelity stroke replay for small board thumbnails.
 *
 *  Skips perfect-freehand entirely — its variable-width outline is
 *  invisible at ~320px and `getStroke` (called once per stroke segment)
 *  is the dominant cost when a board renders a dozen previews at once.
 *  Plain polylines are roughly an order of magnitude cheaper and look
 *  near-identical at thumbnail scale. Use `replayStrokes` for the
 *  full-size detail view where the fidelity actually shows. */
export function replayStrokesPreview(
  ctx: CanvasRenderingContext2D, w: number, h: number, strokes: DmStrokePayload[],
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let drawing = false;
  let lastX = 0, lastY = 0;
  for (const p of strokes) {
    const x = p.x * w;
    const y = p.y * h;
    if (p.op === "fill") {
      floodFill(ctx, w, h, Math.floor(x), Math.floor(y), p.color || "#000000");
      drawing = false;
    } else if (p.op === "start") {
      ctx.strokeStyle = (p.tool === "eraser") ? "#ffffff" : (p.color || "#000000");
      ctx.lineWidth = Math.max(0.75, (p.size || 4) * (w / BRUSH_REFERENCE_WIDTH));
      lastX = x; lastY = y;
      drawing = true;
    } else if (p.op === "move" && drawing) {
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x; lastY = y;
    } else if (p.op === "end") {
      drawing = false;
    }
  }
}
