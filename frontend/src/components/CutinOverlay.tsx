import { useEffect, useRef, useState } from "react";
import { SpinePlayer } from "@/lib/spine";

export type CutinInfo = { anim: string; view: [number, number, number] | null };

const BASE = "/media/md_ui/cutin";
const SCREEN = 16 / 9;   // the game's screen the camera view is made for

/** A monster's cut-in played once over the whole screen, as Master Duel plays it when the monster is summoned, with the
 *  attribute's sound (엘리스 2026-10-11). The figure is fitted to the screen: what the game's camera shows of it, as
 *  large as the screen allows in either orientation. A tap or Escape closes it early. */
export default function CutinOverlay({ id, info, sound, alt, onClose }: {
  id: number; info: CutinInfo; sound: HTMLAudioElement | null; alt: string; onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    let alive = true, raf = 0, player: SpinePlayer | null = null;
    SpinePlayer.load(canvas, `${BASE}/${id}`)
      .then((p) => {
        player = p;
        if (!alive) return p.dispose();
        const anim = p.animation(info.anim);
        if (!anim) throw new Error("no animation");
        // what to fit: the figure over the animation, cut to the game's camera view
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const f of [0.3, 0.5, 0.7, 0.9]) {
          const b = p.bounds(anim, anim.duration * f);
          x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
        }
        if (info.view) {
          const [vx, vy, vh] = info.view, vw = vh * SCREEN;
          x0 = Math.max(x0, vx - vw); x1 = Math.min(x1, vx + vw); y0 = Math.max(y0, vy - vh); y1 = Math.min(y1, vy + vh);
        }
        if (!(x1 > x0 && y1 > y0)) [x0, y0, x1, y1] = [-500, -500, 500, 500];
        const aspect = canvas.width / canvas.height;
        let halfW = ((x1 - x0) / 2) * 1.08, halfH = ((y1 - y0) / 2) * 1.08;
        if (halfW / halfH > aspect) halfH = halfW / aspect;
        else halfW = halfH * aspect;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        p.restart();
        setState("playing");
        sound?.play().catch(() => {});
        let start = -1, last = 0;
        const frame = (now: number) => {
          if (!alive) return;
          if (start < 0) start = last = now;
          const t = (now - start) / 1000;
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
      player?.dispose();
    };
  }, [id, info, sound, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 cursor-pointer" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {state !== "playing" && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/80" aria-live="polite">
          {state === "loading" ? "컷인을 불러오는 중…" : "컷인을 재생하지 못했습니다."}
        </p>
      )}
    </div>
  );
}
