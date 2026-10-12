import { useEffect, useRef, useState } from "react";
import { CardFinish, type FinishParams, type FinishStyle } from "@/lib/cardFinish";

/** A card face in Master Duel's Shine or Royal finish, animated as in the deck screen (the game moves it with time,
 *  not with tilting). It pauses off screen, in a hidden tab and when paused (holding its last frame); it moves even
 *  for reduced motion, since the motion is what the viewer tapped the finish to see. The renderer is made once for
 *  the canvas and another face only swaps its texture; the plain face shows until the finish has it. */
export default function CardFinishCanvas({ faceUrl, style, params, alt, paused = false, sharp = 1, className = "" }: {
  faceUrl: string; style: FinishStyle; params: FinishParams; alt: string; paused?: boolean; sharp?: number; className?: string;
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
    // its laid-out size, not its size on screen: the pack simulator puts a finish on a card in the middle of a turn,
    // when it shows as a sliver, and a canvas sized then drew a few pixels stretched (엘리스 10/13 "샤인이 되는 순간
    // 초저화질"); `sharp` draws finer for a card that will be shown larger than it is laid out
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * sharp;
      const w = Math.round(canvas.offsetWidth * dpr);
      const h = Math.round(canvas.offsetHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
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
      ro.disconnect();
      made?.dispose();
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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
