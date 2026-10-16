/** The deck's small cards in 샤인 / 로얄, drawn with the card page's own shaders (참혈 2026-10-16) through one shared
 *  WebGL 2 context: a page keeps only so many (a phone fewer than 16), so not one a card. Each tick the visible
 *  copies are drawn side by side in one canvas off the page and copied into their own 2D canvases, so badges, rings,
 *  fading and the 대표 카드' tilt sit on them as on a picture. 30 frames a second at most, a deck too big for a tick
 *  drawn over a few; nothing off screen or in a hidden tab. All copies keep one clock, as Master Duel's deck screen
 *  does (its edges flash on every card at once). */
import { FinishShaders, type FinishParams, type FinishStyle } from "./cardFinish";
import { TextureCache, due, packCells, pickBatch } from "./finishBatch";

export type TileLook = { face: string; style: FinishStyle; params: FinishParams };
type Events = { onShown: (shown: boolean) => void; onLost: () => void };
type Tile = TileLook & Events & {
  id: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  visible: boolean;
  card: WebGLTexture | null;
  name: WebGLTexture | null;
  /** the texture keys it holds, released when it goes or changes face */
  keys: string[];
  /** bumped with each new face, so a load finishing late is dropped */
  load: number;
  shown: boolean;
};
type Atlas = HTMLCanvasElement | OffscreenCanvas;
type Core = { canvas: Atlas; shaders: FinishShaders; textures: TextureCache<WebGLTexture>; onLost: (e: Event) => void };

const FPS = 30;
// device pixels drawn in one tick at most (a phone's card page draws ~0.7M at 60 a second): past it the copies take
// turns (finishBatch.pickBatch)
const PIXELS_PER_TICK = 600_000;
const ATLAS_WIDTH = 2048;
const KEEP_IDLE = 24;
// a name mask (1056 × 256) a third the size: enough for a card this small, a tenth of the memory
const NAME_SIZE = [352, 86];
// the shared context goes this long after the last copy does (leaving the page)
const LINGER_MS = 5000;

const tiles = new Map<number, Tile>();
let nextId = 0;
let core: Core | null = null;
let making: Promise<Core> | null = null;
let lost = false;
let raf = 0;
let last = 0;
let cursor = 0;
let linger = 0;
const start = performance.now();
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;
const byCanvas = new Map<Element, Tile>();

/** Whether the shared context has been lost on this visit (the copies show the still marks instead). */
export const tilesLost = () => lost;

function loadImage(src: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.src = src;
  return im.decode().then(() => im);
}

/** The shared canvas: off the main thread's page where the browser has it (its drawing handed over in one piece each
 *  tick, transferToImageBitmap), else a canvas element never put on the page. */
function atlas(): { canvas: Atlas; gl: WebGL2RenderingContext } | null {
  const attrs: WebGLContextAttributes = { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true };
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(ATLAS_WIDTH, 256);
      const gl = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
      if (gl) return { canvas, gl };
    } catch {
      // Safari before 17 has no WebGL off the page
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_WIDTH;
  canvas.height = 256;
  const gl = canvas.getContext("webgl2", attrs);
  return gl ? { canvas, gl } : null;
}

function makeCore(): Promise<Core> {
  making ??= (async () => {
    const made = atlas();
    if (!made) throw new Error("webgl2");
    const { canvas, gl } = made;
    const onLost = (e: Event) => {
      e.preventDefault();
      loseAll();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    const shaders = await FinishShaders.create(gl);
    const textures = new TextureCache<WebGLTexture>(KEEP_IDLE, (t) => gl.deleteTexture(t));
    core = { canvas, shaders, textures, onLost };
    return core;
  })();
  making.catch(() => loseAll());
  return making;
}

function loseAll() {
  lost = true;
  core = null;
  making = null;
  [...tiles.values()].forEach((t) => t.onLost());
}

function dropCore() {
  if (!core || tiles.size) return;
  const { canvas, shaders, textures, onLost } = core;
  canvas.removeEventListener("webglcontextlost", onLost);   // let go on purpose, not lost
  textures.clear();
  shaders.dispose();
  shaders.gl.getExtension("WEBGL_lose_context")?.loseContext();
  core = null;
  making = null;
}

/** The tile's canvas sized to its box (its laid-out size, so the 대표 카드' tilt does not count) at the screen's
 *  density, two at most; true when it changed (which empties it). */
function fit(t: Tile) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(t.canvas.offsetWidth * dpr);
  const h = Math.round(t.canvas.offsetHeight * dpr);
  if (w === t.w && h === t.h) return false;
  t.w = t.canvas.width = w;
  t.h = t.canvas.height = h;
  return true;
}

function observers() {
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = byCanvas.get(e.target);
      if (t) t.visible = e.isIntersecting;
    }
    kick();
  }, { rootMargin: "64px" });
  ro ??= new ResizeObserver((entries) => {
    const redraw: Tile[] = [];
    for (const e of entries) {
      const t = byCanvas.get(e.target);
      if (t && fit(t) && t.shown) redraw.push(t);
    }
    // before this frame is painted, so a resized copy is never seen empty
    if (redraw.length && core) render(core, redraw, performance.now());
  });
}

/** Draw these tiles: side by side in the shared canvas, then each copied into its own. */
function render(c: Core, batch: Tile[], now: number) {
  const ready = batch.filter((t) => t.card && t.w && t.h);
  if (!ready.length) return;
  const { cells, height } = packCells(ready.map((t) => ({ w: t.w, h: t.h })), ATLAS_WIDTH);
  if (c.canvas.height < height) c.canvas.height = Math.ceil(height / 256) * 256;
  const H = c.canvas.height;
  ready.forEach((t, i) => {
    const { x, y } = cells[i];
    c.shaders.draw(t.style, (now - start) / 1000, t.params, t.card!, t.name, [x, H - y - t.h, t.w, t.h]);
  });
  // the tick's drawing taken once, not copied out of the context for each copy
  const src = "transferToImageBitmap" in c.canvas ? c.canvas.transferToImageBitmap() : c.canvas;
  ready.forEach((t, i) => {
    const { x, y } = cells[i];
    t.ctx.clearRect(0, 0, t.w, t.h);
    t.ctx.drawImage(src, x, y, t.w, t.h, 0, 0, t.w, t.h);
    if (!t.shown) {
      t.shown = true;
      t.onShown(true);
    }
  });
  if (src instanceof ImageBitmap) src.close();
}

function tick(now: number) {
  raf = 0;
  const c = core;
  if (!c || lost) return;
  const list = [...tiles.values()];
  if (!list.some((t) => t.visible && t.card)) return;   // nothing to draw: waits for a copy to show or load (kick)
  raf = requestAnimationFrame(tick);
  if (document.hidden || !due(now, last, FPS)) return;
  last = now;
  const { ids, next } = pickBatch(
    list.map((t) => ({ id: t.id, pixels: t.w * t.h, visible: t.visible, ready: !!t.card && t.w > 0 })), cursor, PIXELS_PER_TICK);
  cursor = next;
  render(c, ids.map((id) => tiles.get(id)!), now);
}

function kick() {
  if (!raf && core && !lost) raf = requestAnimationFrame(tick);
}

/** Load the tile's face and name into textures (shared with the copies of the same print) and the frame's patterns. */
async function load(t: Tile) {
  const call = ++t.load;
  const c = await makeCore();
  const keys = [t.face, ...(t.params.name ? [`name ${t.params.name}`] : [])];
  const [card, name] = await Promise.all([
    c.textures.acquire(keys[0], async () => c.shaders.texture(await loadImage(t.face))),
    t.params.name
      ? c.textures.acquire(keys[1], async () => {
          const im = await loadImage(t.params.name!);
          const small = document.createElement("canvas");
          [small.width, small.height] = NAME_SIZE;
          small.getContext("2d")!.drawImage(im, 0, 0, small.width, small.height);
          return c.shaders.texture(small);
        })
      : Promise.resolve(null),
    c.shaders.prepare(t.params.frame),
  ]).catch((e) => {
    // what was got is given back: the tile shows its still marks
    keys.forEach((k) => c.textures.release(k));
    throw e;
  });
  if (call !== t.load || !tiles.has(t.id) || core !== c) {
    keys.forEach((k) => c.textures.release(k));
    return;
  }
  t.keys = keys;
  t.card = card;
  t.name = name;
  kick();
}

function release(t: Tile) {
  if (core) t.keys.forEach((k) => core!.textures.release(k));
  t.keys = [];
  t.card = t.name = null;
}

/** Draw a copy in its finish on this canvas (laid over its plain face): onShown(true) once it is drawn (the plain face
 *  can hide), onShown(false) when another face is loading (it should show again); onLost when the shared context is
 *  lost or the face would not load (the still marks instead). */
export function addTile(canvas: HTMLCanvasElement, look: TileLook, events: Events) {
  const ctx = canvas.getContext("2d");
  if (lost || !ctx) {
    queueMicrotask(events.onLost);
    return { update: () => {}, remove: () => {} };
  }
  window.clearTimeout(linger);
  observers();
  const t: Tile = {
    ...look, ...events, id: nextId++, canvas, ctx, w: 0, h: 0, visible: false, card: null, name: null, keys: [], load: 0, shown: false,
  };
  tiles.set(t.id, t);
  byCanvas.set(canvas, t);
  fit(t);
  io!.observe(canvas);
  ro!.observe(canvas);
  const begin = () => load(t).catch(() => tiles.has(t.id) && t.onLost());
  begin();
  return {
    /** The copy took another look: a new face (or name, or frame) is loaded, the plain face showing meanwhile. */
    update(next: TileLook) {
      const reload = next.face !== t.face || next.params.name !== t.params.name || next.params.frame !== t.params.frame;
      Object.assign(t, next);
      if (!reload) return;
      release(t);
      t.ctx.clearRect(0, 0, t.w, t.h);
      if (t.shown) {
        t.shown = false;
        t.onShown(false);
      }
      begin();
    },
    remove() {
      io?.unobserve(canvas);
      ro?.unobserve(canvas);
      byCanvas.delete(canvas);
      tiles.delete(t.id);
      t.load++;
      release(t);
      if (!tiles.size) {
        window.clearTimeout(linger);
        linger = window.setTimeout(dropCore, LINGER_MS);
      }
    },
  };
}
