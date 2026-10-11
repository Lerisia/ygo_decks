import { useEffect, useRef, useState } from "react";
import { CardFinish, type FinishParams, type FinishStyle } from "@/lib/cardFinish";

const FPS = 30;

/** A card face in Master Duel's Shine or Royal finish, animated as in the deck screen (the game moves it with time,
 *  not with tilting). It pauses off screen and in a hidden tab, and stands still for reduced motion. */
export default function CardFinishCanvas({ faceUrl, style, params, alt, className = "" }: {
  faceUrl: string; style: FinishStyle; params: FinishParams; alt: string; className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [finish, setFinish] = useState<CardFinish | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    let alive = true;
    let made: CardFinish | null = null;
    CardFinish.create(canvas, faceUrl)
      .then((f) => {
        made = f;
        if (alive) setFinish(f);
        else f.dispose();
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      made?.dispose();
      setFinish(null);
    };
  }, [faceUrl]);

  useEffect(() => {
    if (!finish) return;
    const canvas = canvasRef.current!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || now - last < 1000 / FPS) return;
      last = now;
      finish.draw(style, (now - t0) / 1000, params);
    };
    if (still) finish.draw(style, 2, params);
    else raf = requestAnimationFrame(frame);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [finish, style, params.attribute, params.level]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <img src={faceUrl} alt={alt} className={className} />;
  return <canvas ref={canvasRef} role="img" aria-label={alt} className={className} />;
}
