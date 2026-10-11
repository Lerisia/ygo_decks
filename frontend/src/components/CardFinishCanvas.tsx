import { useEffect, useRef, useState } from "react";
import { CardFinish, type FinishParams, type FinishStyle } from "@/lib/cardFinish";

/** A card face in Master Duel's Shine or Royal finish, animated as in the deck screen (the game moves it with time,
 *  not with tilting). It pauses off screen, in a hidden tab and when paused (holding its last frame); it moves even
 *  for reduced motion, since the motion is what the viewer tapped the finish to see. The renderer is made once for
 *  the canvas and another face only swaps its texture; the plain face shows until the finish has it. */
export default function CardFinishCanvas({ faceUrl, style, params, alt, paused = false, className = "" }: {
  faceUrl: string; style: FinishStyle; params: FinishParams; alt: string; paused?: boolean; className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef(performance.now());
  const [finish, setFinish] = useState<CardFinish | null>(null);
  const [onCard, setOnCard] = useState<string | null>(null);   // the face (and frame) the renderer has
  const [failed, setFailed] = useState(false);
  const want = `${faceUrl} ${params.frame} ${params.name ?? ""}`;
  const ready = finish !== null && onCard === want;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    let alive = true;
    let made: CardFinish | null = null;
    CardFinish.create(canvas)
      .then((f) => {
        made = f;
        if (alive) setFinish(f);
        else f.dispose();
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      made?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!finish) return;
    let alive = true;
    finish.clear();   // not the last card's frame over the new plain face while it loads
    finish
      .setFace(faceUrl, params.frame, params.name)
      .then((put) => alive && put && setOnCard(want))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [finish, want]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!finish || !ready || paused) return;
    const canvas = canvasRef.current!;
    let raf = 0;
    let visible = true;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      finish.draw(style, (now - start.current) / 1000, params);
    };
    raf = requestAnimationFrame(frame);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [finish, ready, paused, style, params.attribute, params.level]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <img src={faceUrl} alt={alt} className={className} />;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      className={className}
      style={ready ? undefined : { backgroundImage: `url(${faceUrl})`, backgroundSize: "100% 100%" }}
    />
  );
}
