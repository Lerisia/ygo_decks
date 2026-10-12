/** The pack opening's light, drawn on one canvas over the cards (엘리스 2026-10-13: "진짜 마듀처럼"): the game's own
 *  particle pictures (md_ui/packopen), added onto what is under them as the game's effects are, so black is nothing and
 *  light piles up. Bursts when a card turns (bigger and brighter by rarity), twinkles around a face-down SR or UR,
 *  sparks along the pack's cut, and a slow drift of light behind it all. */
import type { Rarity } from "@/utils/packDraw";

const FX = "/media/md_ui/packopen/";
const TEXTURES = ["star", "star_big", "dot", "shards", "burst", "soft", "cross", "glow_soft", "bg_particle", "card_light"] as const;
type Tex = (typeof TEXTURES)[number];
const GRIDS = new Set<Tex>(["shards"]);   // sprite sheets: their cells are cut, not faded

type Particle = {
  tex: Tex; frame?: number; grid?: number; color: string;
  x: number; y: number; vx: number; vy: number; ax: number; ay: number; drag: number;
  life: number; t: number; size: number; grow: number; rot: number; vr: number; alpha: number; fadeIn: number; twinkle: number;
  stretch?: number;
};
type Emitter = (dt: number, fx: FxLayer) => boolean;   // false: done

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const RAINBOW = ["#ff5a7a", "#ffb84a", "#fff35a", "#6cff8a", "#5ad8ff", "#7a7cff", "#e06bff"];
export const GOLD = "#ffd36a";
export const WHITE = "#ffffff";
export const BLUE = "#a8d8ff";

export class FxLayer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private images = new Map<Tex, HTMLImageElement>();
  private tinted = new Map<string, HTMLCanvasElement>();
  private raf = 0;
  private last = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private alive = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    for (const t of TEXTURES) {
      const img = new Image();
      img.decoding = "async";
      img.src = `${FX}${t}.webp`;
      this.images.set(t, img);
    }
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  /** The canvas's own coordinates of a point on the page. */
  local(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  }

  add(p: Partial<Particle> & Pick<Particle, "tex" | "x" | "y" | "life" | "size">) {
    this.particles.push({
      color: WHITE, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, t: 0, grow: 0, rot: 0, vr: 0, alpha: 1, fadeIn: 0.08, twinkle: 0, ...p,
    });
    this.start();
  }

  emit(e: Emitter) {
    this.emitters.push(e);
    this.start();
  }

  clear() {
    this.particles = [];
    this.emitters = [];
  }

  private start() {
    if (this.raf || !this.alive) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.emitters = this.emitters.filter((e) => e(dt, this));
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = "lighter";
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      const k = Math.exp(-p.drag * dt);
      p.vx = (p.vx + p.ax * dt) * k;
      p.vy = (p.vy + p.ay * dt) * k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const u = p.t / p.life;
      let a = p.alpha * Math.min(1, p.t / Math.max(0.001, p.fadeIn)) * (1 - u) ** 1.4;
      if (p.twinkle) a *= 0.55 + 0.45 * Math.sin(p.t * p.twinkle);
      const size = Math.max(0, p.size * (1 + p.grow * u));
      this.draw(p, a, size);
    }
    this.particles = keep;
    if (keep.length || this.emitters.length) this.raf = requestAnimationFrame(this.frame);
    else {
      ctx.clearRect(0, 0, this.w, this.h);
      this.raf = 0;
    }
  };

  private draw(p: Particle, alpha: number, size: number) {
    const img = this.tint(p.tex, p.color);
    if (!img || alpha <= 0.002 || size < 0.5) return;
    const { ctx } = this;
    const grid = p.grid ?? 1;
    const fw = img.width / grid;
    const fh = img.height / grid;
    const fx = ((p.frame ?? 0) % grid) * fw;
    const fy = Math.floor((p.frame ?? 0) / grid) * fh;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.translate(p.x, p.y);
    if (p.stretch) ctx.rotate(Math.atan2(p.vy, p.vx));
    else ctx.rotate(p.rot);
    const sx = p.stretch ? size * (1 + p.stretch * Math.hypot(p.vx, p.vy) / 600) : size;
    ctx.drawImage(img, fx, fy, fw, fh, -sx / 2, -size / 2, sx, size);
    ctx.restore();
  }

  /** The texture in a colour (multiplied, its own alpha kept), drawn once and kept. */
  private tint(tex: Tex, color: string) {
    const key = `${tex}${color}`;
    const done = this.tinted.get(key);
    if (done) return done;
    const img = this.images.get(tex);
    if (!img || !img.complete || !img.naturalWidth) return null;
    const canvas = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      return c;
    };
    const base = canvas();
    const g = base.getContext("2d")!;
    g.drawImage(img, 0, 0);
    if (!GRIDS.has(tex)) {
      // the game's glows fade to a grey, not to black, at their edges: added onto the rays that shows as a square
      const r = Math.min(base.width, base.height) / 2;
      const fade = g.createRadialGradient(base.width / 2, base.height / 2, r * 0.35, base.width / 2, base.height / 2, r);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      g.globalCompositeOperation = "destination-in";
      g.fillStyle = fade;
      g.fillRect(0, 0, base.width, base.height);
    }
    let out = base;
    if (color !== WHITE) {
      out = canvas();
      const t = out.getContext("2d")!;
      t.drawImage(base, 0, 0);
      t.globalCompositeOperation = "multiply";
      t.fillStyle = color;
      t.fillRect(0, 0, out.width, out.height);
      t.globalCompositeOperation = "destination-in";   // multiplying filled the clear parts: take the shape back
      t.drawImage(base, 0, 0);
    }
    this.tinted.set(key, out);
    return out;
  }

  // ---- what the opening asks for ----

  /** The burst as a card turns face up at (x, y), w its width: a puff for N, a few blue sparks for R, a gold
   *  starburst for SR, a rainbow one with long-lived stars for UR. */
  reveal(x: number, y: number, w: number, rarity: Rarity) {
    const big = rarity === "UR" ? 1.5 : rarity === "SR" ? 1.15 : rarity === "R" ? 0.8 : 0.65;
    const hue = () => (rarity === "UR" ? RAINBOW[Math.floor(Math.random() * RAINBOW.length)] : rarity === "SR" ? GOLD : rarity === "R" ? BLUE : WHITE);
    // the flash on the card
    const strong = rarity === "SR" || rarity === "UR";
    this.add({ tex: "glow_soft", x, y, size: w * 1.7 * big, grow: 0.5, life: strong ? 0.36 : 0.22, alpha: strong ? 0.9 : 0.35, fadeIn: 0.02,
               color: rarity === "SR" ? GOLD : WHITE });
    this.add({ tex: "card_light", x, y, size: w * 1.5, grow: 0.3, life: strong ? 0.4 : 0.2, alpha: strong ? 0.85 : 0.25, fadeIn: 0.02,
               color: rarity === "SR" ? GOLD : rarity === "UR" ? "#fff6d0" : BLUE });
    if (rarity === "SR" || rarity === "UR") {
      this.add({ tex: "burst", x, y, size: w * 2.6 * big, grow: 0.6, life: 0.55, vr: 1.2, rot: rand(0, 6), alpha: 0.95, fadeIn: 0.03, color: rarity === "SR" ? GOLD : WHITE });
      this.add({ tex: "star_big", x, y, size: w * 2.2 * big, grow: 0.3, life: 0.7, vr: -0.8, alpha: 0.85, fadeIn: 0.04, color: hue() });
    }
    // sparks flying out
    const n = rarity === "UR" ? 34 : rarity === "SR" ? 22 : rarity === "R" ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      const speed = w * rand(1.6, 3.6) * (rarity === "UR" ? 1.25 : 1);
      this.add({
        tex: i % 3 === 0 && rarity !== "N" ? "cross" : "star", x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - w * 0.3,
        ay: w * 1.6, drag: 2.6, life: rand(0.45, 0.9) * (rarity === "UR" ? 1.4 : 1), size: w * rand(0.18, 0.36) * big, grow: -0.6,
        rot: rand(0, 6), vr: rand(-3, 3), alpha: 1, fadeIn: 0.01, color: hue(), twinkle: rarity === "UR" ? rand(14, 24) : 0,
      });
    }
    if (rarity === "SR" || rarity === "UR") {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, Math.PI * 2);
        const speed = w * rand(2.5, 4.5);
        this.add({ tex: "shards", grid: 3, frame: Math.floor(rand(0, 9)), x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
                   ay: w * 3, drag: 1.8, life: rand(0.5, 0.8), size: w * rand(0.08, 0.14), rot: rand(0, 6), vr: rand(-12, 12), color: hue() });
      }
    }
  }

  /** Twinkles on and around a face-down SR or UR (its rect in canvas terms), until `until()` says stop. */
  twinkleOn(rect: () => DOMRect | null, rarity: Rarity, until: () => boolean) {
    let acc = 0;
    this.emit((dt) => {
      if (until()) return false;
      const r = rect();
      if (!r) return true;
      acc += dt * (rarity === "UR" ? 9 : 6);
      while (acc >= 1) {
        acc -= 1;
        const o = this.local(r.left, r.top);
        const edge = Math.random() < 0.6;
        const x = o.x + (edge ? (Math.random() < 0.5 ? 0 : r.width) + rand(-6, 6) : rand(0, r.width));
        const y = o.y + rand(0, r.height);
        this.add({ tex: "star", x, y, vy: -r.width * 0.25, size: r.width * rand(0.22, 0.42), grow: -0.5, life: rand(0.45, 0.8),
                   rot: rand(0, 6), vr: rand(-2, 2), fadeIn: 0.12, color: rarity === "UR" ? RAINBOW[Math.floor(rand(0, RAINBOW.length))] : GOLD });
      }
      return true;
    });
  }

  /** Sparks along the pack's cut, left to right, from (x0, y) to (x1, y). */
  cut(x0: number, x1: number, y: number, w: number) {
    for (let i = 0; i < 26; i++) {
      const x = x0 + ((x1 - x0) * i) / 25;
      this.add({ tex: i % 4 ? "dot" : "cross", x, y: y + rand(-3, 3), vx: rand(-40, 160), vy: rand(-260, -40), ay: 520, drag: 1.5,
                 life: rand(0.35, 0.7), size: w * rand(0.05, 0.12), fadeIn: 0.01, color: i % 2 ? "#fff3c0" : WHITE });
    }
    this.add({ tex: "glow_soft", x: (x0 + x1) / 2, y, size: w * 2.2, life: 0.35, alpha: 0.8, fadeIn: 0.02 });
  }

  /** Light drifting up behind everything, now and then. */
  drift(until: () => boolean) {
    let acc = 0;
    this.emit((dt) => {
      if (until()) return false;
      acc += dt * 3;
      while (acc >= 1) {
        acc -= 1;
        this.add({ tex: Math.random() < 0.5 ? "bg_particle" : "soft", x: rand(0, this.w), y: this.h + 20, vy: -rand(40, 110), vx: rand(-10, 10),
                   size: rand(10, 26), life: rand(3, 6), alpha: rand(0.15, 0.35), fadeIn: 0.8, color: Math.random() < 0.5 ? BLUE : WHITE });
      }
      return true;
    });
  }
}
