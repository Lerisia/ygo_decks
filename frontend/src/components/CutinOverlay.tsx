import { useEffect, useRef, useState } from "react";
import type { CutinSound } from "@/lib/cutinSound";
import { BG_ATTRIBUTES, BG_BASE, BG_VERSION, type CutinInfo, cutinBase, markPlayed } from "@/lib/cutinPrefetch";
import { SpinePlayer } from "@/lib/spine";
import { SummonFx, vignetteAlpha } from "@/lib/summonfx";

export type { CutinInfo };

const SCREEN = 16 / 9;   // the game's screen the camera view is made for
const BG_DPR = 1;        // the background's pixels to a CSS pixel, at most
const CAMERA_SIZE = 5;   // half the height the game's camera shows, in world units: the backgrounds are made for it

/** The last summon played, kept ready (엘리스 10/12: people play them one after another): its two canvases, their
 *  WebGL contexts with the pictures already on the GPU, outlive the overlay. One is kept, the cut-in and the
 *  background last asked for; another card's replaces it. Loads are held as promises, so a reopening mid-load waits
 *  for the same one and a load overtaken by another card's is let go when it lands. */
type Slot = "cutin" | "bg";
const held: Record<Slot, { key: string; ready: Promise<unknown> } | null> = { cutin: null, bg: null };
const canvases: Partial<Record<Slot, HTMLCanvasElement>> = {};

function keptCanvas(slot: Slot): HTMLCanvasElement {
  let c = canvases[slot];
  if (!c) {
    c = canvases[slot] = document.createElement("canvas");
    c.className = "absolute inset-0 w-full h-full";
    // a context the browser takes back (memory, a long while in the background) is gone for good: a new canvas then
    c.addEventListener("webglcontextlost", () => {
      delete canvases[slot];
      held[slot] = null;
    });
  }
  return c;
}

function keep<T>(slot: Slot, key: string, load: () => Promise<T>, dispose: (x: T) => void): Promise<T> {
  const was = held[slot];
  if (was?.key === key) return was.ready as Promise<T>;
  was?.ready.then((x) => dispose(x as T), () => {});
  const ready = load();
  held[slot] = { key, ready };
  ready.catch(() => {
    if (held[slot]?.ready === ready) held[slot] = null;
  });
  return ready;
}

/** A monster's cut-in played once over the whole screen, as Master Duel plays it when the monster is summoned, with the
 *  attribute's sound (엘리스 2026-10-11) and, behind it, the attribute's background through the same camera. The figure
 *  is fitted to the screen: what the game's camera shows of it, as large as the screen allows in either orientation.
 *  A tap or Escape closes it early. */
export default function CutinOverlay({ id, info, attribute, sound, alt, onClose }: {
  id: number; info: CutinInfo; attribute: string; sound: CutinSound | null; alt: string; onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "failed">("loading");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const canvas = keptCanvas("cutin"), bgCanvas = keptCanvas("bg");
    // both unseen until all is ready: the warm-up draws on them
    canvas.style.visibility = "hidden";
    bgCanvas.style.visibility = "hidden";
    hostRef.current!.append(bgCanvas, canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    // the background is glow and bloom: one pixel to a CSS pixel is enough, and a phone's GPU draws a quarter of it
    // (10/12: water, earth and divine dropped frames at the phone's full resolution)
    bgCanvas.width = Math.round(window.innerWidth * Math.min(dpr, BG_DPR));
    bgCanvas.height = Math.round(window.innerHeight * Math.min(dpr, BG_DPR));
    markPlayed();
    let alive = true, raf = 0;
    const base = cutinBase(id, info);
    const cutinLoad = keep("cutin", `${base}@${info.v ?? 0}`, () => SpinePlayer.load(canvas, base, info.v), (p) => p.dispose());
    // the background is a bonus: without it (no WebGL2, a failed file) the cut-in plays alone
    const bgLoad = BG_ATTRIBUTES.has(attribute)
      ? keep("bg", `${attribute}@${BG_VERSION}`, () => SummonFx.load(bgCanvas, `${BG_BASE}/${attribute}`, BG_VERSION, { vignette: false }),
             (fx) => fx.dispose()).catch(() => null)
      : Promise.resolve(null);
    // the sound too, fetched and decoded, so that it starts with the first frame (a file that never comes lets the
    // summon play without it)
    const soundLoad = sound ? Promise.race([sound.ready, new Promise((r) => setTimeout(r, 8000))]) : null;
    Promise.all([cutinLoad, bgLoad, soundLoad])
      .then(([p, loadedFx]) => {
        if (!alive) return;
        let fx = loadedFx;
        // the game's vignette darkens the corners of the whole picture, the cut-in too: a small black layer, stretched
        if (fx) {
          const v = vignetteRef.current!, ctx = v.getContext("2d")!;
          const img = ctx.createImageData(v.width, v.height);
          for (let y = 0; y < v.height; y++) {
            for (let x = 0; x < v.width; x++) {
              img.data[(y * v.width + x) * 4 + 3] = Math.round(255 * vignetteAlpha((x + 0.5) / v.width, (y + 0.5) / v.height));
            }
          }
          ctx.putImageData(img, 0, 0);
        }
        const anim = p.animation(info.anim);
        if (!anim) throw new Error("no animation");
        // what to fit: the figure over the animation, cut to the game's camera view
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const f of [0.3, 0.5, 0.7, 0.9]) {
          const b = p.bounds(anim, anim.duration * f);
          x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
        }
        // (a view far smaller than the figure is one the export misread: the figure alone then)
        if (info.view && 4 * info.view[2] * info.view[2] * SCREEN > 0.3 * (x1 - x0) * (y1 - y0)) {
          const [vx, vy, vh] = info.view, vw = vh * SCREEN;
          x0 = Math.max(x0, vx - vw); x1 = Math.min(x1, vx + vw); y0 = Math.max(y0, vy - vh); y1 = Math.min(y1, vy + vh);
        }
        if (!(x1 > x0 && y1 > y0)) [x0, y0, x1, y1] = [-500, -500, 500, 500];
        const aspect = canvas.width / canvas.height;
        let halfW = ((x1 - x0) / 2) * 1.08, halfH = ((y1 - y0) / 2) * 1.08;
        if (halfW / halfH > aspect) halfH = halfW / aspect;
        else halfW = halfH * aspect;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        // the background's world is the game's: the cut-in's camera view (its centre and half height, in the figure's
        // units) is the camera's 5 units up and down from the origin
        const [vx, vy, vh] = info.view ?? [cx, cy, halfH];
        const k = CAMERA_SIZE / vh;
        // the first play's heavy work (shaders compiled, pictures sent to the GPU, the bloom's targets made) done
        // here, behind the loading line, rather than in the first frames (엘리스 10/14: "첫 실행부터 매끄러운 편이")
        p.warm(anim, cx, cy, halfW, halfH);
        try {
          fx?.warm((cx - vx) * k, (cy - vy) * k, halfW * k, halfH * k);
        } catch {
          fx = null;
        }
        setState("playing");
        canvas.style.visibility = "";
        if (fx) bgCanvas.style.visibility = "";
        // the opening moment shown still for two frames, while the page takes the change in (the canvases' first
        // showing can hold a frame back a quarter of a second): then the clock and the sound start together
        fx?.draw(0, (cx - vx) * k, (cy - vy) * k, halfW * k, halfH * k);
        p.draw(anim, 0, 0, cx, cy, halfW, halfH);
        let settle = 2, start = -1, last = 0;
        const frame = (now: number) => {
          if (!alive) return;
          if (settle > 0) {
            settle--;
            raf = requestAnimationFrame(frame);
            return;
          }
          if (start < 0) {
            start = last = now;
            sound?.play();
          }
          const t = (now - start) / 1000;
          if (fx) {
            try {
              fx.draw(t, (cx - vx) * k, (cy - vy) * k, halfW * k, halfH * k);
            } catch {
              fx = null;   // a background that cannot draw leaves the cut-in alone
              bgCanvas.style.visibility = "hidden";
            }
          }
          p.draw(anim, Math.min(t, anim.duration), (now - last) / 1000, cx, cy, halfW, halfH);
          last = now;
          if (t > anim.duration + 0.15) onClose();
          else raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      // the canvases leave with the overlay; what is on them stays for the next play
      canvas.remove();
      bgCanvas.remove();
    };
  }, [id, info, attribute, sound, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 cursor-pointer" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <div ref={hostRef} className="absolute inset-0" />
      <canvas ref={vignetteRef} width={64} height={64} className={`absolute inset-0 w-full h-full ${state === "playing" ? "" : "invisible"}`} />
      {state !== "playing" && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/80" aria-live="polite">
          {state === "loading" ? "소환 연출을 불러오는 중…" : "소환 연출을 재생하지 못했습니다."}
        </p>
      )}
    </div>
  );
}
