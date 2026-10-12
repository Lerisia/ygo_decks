import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PackCard, PackDetail } from "@/api/packApi";
import { getCard } from "@/api/cardDexApi";
import CardZoom from "@/components/CardZoom";
import type { FinishParams } from "@/lib/cardFinish";
import { FxLayer } from "@/lib/packFx";
import { playPackSound, setSoundOn, soundOn, unlockPackSound } from "@/lib/packSound";
import { type Pulled, type Rarity, GEMS_PER_PACK } from "@/utils/packDraw";

const FX = "/media/md_ui/packopen/";
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, UR: 3 };
const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const high = (r: Rarity) => r === "SR" || r === "UR";
const best = (cards: Pulled<PackCard>[]) => cards.reduce<Rarity>((b, c) => (RANK[c.rarity] > RANK[b] ? c.rarity : b), "N");

/** How a card turns, by rarity (ms): a wait while an SR / UR shakes, then the turn; the burst comes as the face shows. */
const TURN = {
  N: { wait: 0, turn: 300 }, R: { wait: 0, turn: 320 }, SR: { wait: 200, turn: 380 }, UR: { wait: 420, turn: 440 },
} as const;

type Stage = "pack" | "cut" | "cards" | "result";
type Zoom = { card: Pulled<PackCard>; params: FinishParams | null };

/** The game's pack opening, drawn again from its own pictures and sounds (엘리스 2026-10-12, made livelier 10-13): the
 *  pack on the turning blue rays with an aura in its best card's colour (lightning when it holds a UR); a tap or a
 *  stroke across its top cuts it, sparks fly and the top flies off; the eight cards spring out of it to their places,
 *  an SR glowing gold and a UR rainbow, trembling and twinkling; a tap, or a finger drawn across them, turns them —
 *  the card lifts, spins and bursts into light as its face shows (a gold starburst for SR, a rainbow one with a flash
 *  and a shake for UR). Then the next pack, and the 팩 개봉 결과. */
export default function PackOpening({ pack, packs, fresh, onClose, onAgain }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>;
  onClose: () => void; onAgain: (count: 1 | 10) => void;
}) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("pack");
  const [sound, setSound] = useState(soundOn);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [flash, setFlash] = useState(0);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fx = useRef<FxLayer | null>(null);
  const shaker = useRef<HTMLDivElement>(null);
  const cards = packs[index];
  const top = best(cards);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const front = new FxLayer(fxCanvas.current!);
    const back = new FxLayer(bgCanvas.current!);
    fx.current = front;
    let gone = false;
    if (!reduced()) back.drift(() => gone);
    const onResize = () => {
      front.resize();
      back.resize();
    };
    window.addEventListener("resize", onResize);
    // the faces, so a card shows the moment it turns
    for (const c of packs.flat()) new Image().src = c.card.thumb;
    return () => {
      gone = true;
      front.destroy();
      back.destroy();
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = prev;
    };
  }, [packs]);

  useEffect(() => {
    if (stage !== "pack") return;
    playPackSound("01_op", 0.6);
    if (top === "UR") window.setTimeout(() => playPackSound("hope", 0.7), 350);
  }, [stage, index, top]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoom]);

  const bang = useCallback((strength: "SR" | "UR") => {
    setFlash((n) => n + 1);
    if (strength === "UR" && shaker.current && !reduced()) {
      shaker.current.animate(
        [{ transform: "none" }, { transform: "translate(-6px, 3px)" }, { transform: "translate(5px, -4px)" }, { transform: "translate(-3px, 2px)" }, { transform: "none" }],
        { duration: 320, easing: "ease-out" },
      );
    }
  }, []);

  const cut = useCallback(() => {
    if (stage !== "pack") return;
    unlockPackSound();
    playPackSound("03_cut");
    setStage("cut");
    window.setTimeout(() => {
      playPackSound("05_cardout", 0.7);
      setStage("cards");
    }, reduced() ? 60 : 640);
  }, [stage]);

  const next = () => {
    fx.current?.clear();
    if (index + 1 >= packs.length) return setStage("result");
    setIndex(index + 1);
    setStage("pack");
  };

  const open = async (card: Pulled<PackCard>) => {
    setZoom({ card, params: null });
    if (card.finish === "basic") return;
    try {
      const doc = await getCard(card.card.card);
      const face = doc.faces.find((f) => f.id === card.card.print);
      setZoom((z) => (z && z.card === card ? {
        card, params: { ...doc.finish, frame: face?.overframe ? "overframe" : doc.finish.frame, name: face?.name_mask ?? null },
      } : z));
    } catch {
      /* the plain face then */
    }
  };

  const total = packs.length;

  return (
    <div className="fixed inset-0 z-[60] bg-[#020617] text-white select-none overflow-hidden" role="dialog" aria-modal="true" aria-label={`${pack.name} 개봉`}>
      <style>{CSS}</style>
      <div ref={shaker} className="absolute inset-0 flex flex-col">
        <Backdrop rarity={stage === "result" ? "N" : top} lit={stage !== "pack"} />
        <canvas ref={bgCanvas} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />

        <div className="relative z-20 flex items-center justify-between gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 text-sm">
          <span className="font-semibold tabular-nums drop-shadow">{stage === "result" ? "팩 개봉 결과" : total > 1 ? `${index + 1} / ${total}` : pack.name}</span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => { setSoundOn(!sound); setSound(!sound); }} aria-label={sound ? "소리 끄기" : "소리 켜기"}
                    className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20">{sound ? "🔊" : "🔇"}</button>
            {stage !== "result" && total > 1 && (
              <button type="button" onClick={() => { fx.current?.clear(); setStage("result"); }} className="px-3 h-9 rounded-full bg-white/10 hover:bg-white/20 font-bold tracking-wide">SKIP</button>
            )}
            <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20">✕</button>
          </span>
        </div>

        {stage === "result" ? (
          <Result pack={pack} packs={packs} fresh={fresh} onOpen={open} onAgain={onAgain} onClose={onClose} />
        ) : stage === "cards" ? (
          <Cards key={index} cards={cards} fresh={fresh} fx={fx} bang={bang} onOpen={open} last={index + 1 >= total} onNext={next} />
        ) : (
          <PackStage key={index} pack={pack} top={top} cutting={stage === "cut"} fx={fx} onCut={cut} />
        )}
      </div>

      <canvas ref={fxCanvas} className="absolute inset-0 z-30 w-full h-full pointer-events-none" aria-hidden="true" />
      {flash > 0 && <span key={flash} className="po-flash" aria-hidden="true" />}

      {zoom && (
        <CardZoom
          src={zoom.card.card.face ?? zoom.card.card.thumb}
          alt={`${zoom.card.card.name}${zoom.card.finish !== "basic" ? ` (${FINISH_LABEL[zoom.card.finish]} 가공)` : ""}`}
          finish={zoom.card.finish !== "basic" && zoom.params ? zoom.card.finish : "normal"}
          params={zoom.params ?? { attribute: 0, level: 0, frame: "normal" }}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

/** The blue rays (the game's quarter picture turned four ways), slowly turning, light streaks rising through them, and
 *  a floor glow in the colour of what the pack holds; brighter once it is open. */
function Backdrop({ rarity, lit }: { rarity: Rarity; lit: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div className={`po-rays ${lit ? "po-lit" : ""}`}>
        {[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y], i) => (
          <span key={i} style={{ backgroundImage: `url(${FX}rays.webp)`, transform: `scale(${x}, ${y})`, left: x > 0 ? 0 : "50%", top: y > 0 ? 0 : "50%" }} />
        ))}
      </div>
      <div className="po-streaks" style={{ backgroundImage: `url(${FX}streaks.webp)` }} />
      <div className={`po-floor po-floor-${rarity.toLowerCase()}`} />
    </div>
  );
}

/** The pack, its aura and, for a UR, lightning; a tap or a stroke across its top (where the game's pack splits, 17%
 *  down) cuts it: a line of light follows the finger, sparks fly along the cut and the top flies off. */
function PackStage({ pack, top, cutting, fx, onCut }: {
  pack: PackDetail; top: Rarity; cutting: boolean; fx: React.MutableRefObject<FxLayer | null>; onCut: () => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; y: number; max: number } | null>(null);
  const [line, setLine] = useState(0);   // how far the finger's cut has gone, 0–1
  const src = pack.image_hd ?? pack.image;

  const doCut = () => {
    const r = box.current?.getBoundingClientRect();
    if (r && fx.current) {
      const a = fx.current.local(r.left, r.top + r.height * 0.17);
      fx.current.cut(a.x - r.width * 0.05, a.x + r.width * 1.05, a.y, r.width);
    }
    setLine(1);
    onCut();
  };

  const down = (e: ReactPointerEvent) => {
    if (cutting) return;
    unlockPackSound();
    drag.current = { x: e.clientX, y: e.clientY, max: 0 };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const r = box.current?.getBoundingClientRect();
    if (!d || !r || cutting) return;
    const span = Math.abs(e.clientX - d.x) / r.width;
    d.max = Math.max(d.max, span);
    setLine(Math.min(1, span));
    if (span > 0.55) {
      drag.current = null;
      doCut();
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || cutting) return;
    if (d.max < 0.08) doCut();   // a tap
    else setLine(0);             // a stroke too short: try again
  };

  const face = (part: "top" | "body") => src ? (
    <img src={src} alt="" draggable={false} className={`po-${part} absolute inset-0 w-full h-full object-cover`} />
  ) : (
    <span className={`po-${part} absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-500 to-amber-800 flex items-center justify-center p-3`}>
      <span className="text-center font-extrabold break-keep">{pack.name}</span>
    </span>
  );

  return (
    <>
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-4">
        <div className={`po-pack ${cutting ? "po-cutting" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
             role="button" tabIndex={0} aria-label={`${pack.name} 팩 열기`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && doCut()}>
          <span className={`po-aura po-aura-${top.toLowerCase()}`} style={top === "UR" ? { backgroundImage: `url(${FX}rainbow.webp)` } : undefined} />
          {top === "UR" && !cutting && (
            <>
              <img src={`${FX}thunder.webp`} alt="" aria-hidden="true" className="po-thunder po-thunder-a" />
              <img src={`${FX}thunder.webp`} alt="" aria-hidden="true" className="po-thunder po-thunder-b" />
            </>
          )}
          <span ref={box} className="po-pack-box">
            {face("body")}
            {face("top")}
            <span className="po-cutline" style={{ transform: `scaleX(${line})` }} />
            <img src={`${FX}slash.webp`} alt="" aria-hidden="true" className="po-slash" />
          </span>
        </div>
      </div>
      <div className="relative z-20 flex flex-col items-center gap-1 px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] min-h-[96px]">
        {!cutting && (
          <>
            <button type="button" onClick={doCut} className="po-button">OPEN</button>
            <span className="text-xs text-white/60">팩 윗부분을 옆으로 그어도 열립니다</span>
          </>
        )}
      </div>
    </>
  );
}

/** The eight cards: they spring out of the pack to their places, then turn one by one — a tap, or a finger drawn
 *  across them turning each it passes, in the way it moves. */
function Cards({ cards, fresh, fx, bang, onOpen, last, onNext }: {
  cards: Pulled<PackCard>[]; fresh: Set<number>; fx: React.MutableRefObject<FxLayer | null>; bang: (r: "SR" | "UR") => void;
  onOpen: (c: Pulled<PackCard>) => void; last: boolean; onNext: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const turnedRef = useRef<boolean[]>(Array(8).fill(false));
  const [turned, setTurned] = useState<boolean[]>(() => Array(8).fill(false));
  const [dealt, setDealt] = useState(false);
  const drag = useRef<{ x: number; y: number; lastX: number; moved: boolean } | null>(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  // out of the pack (where it stood, a little above the middle) to their places, one after another
  useLayoutEffect(() => {
    const g = grid.current?.getBoundingClientRect();
    if (!g) return;
    const from = { x: g.left + g.width / 2, y: g.top + g.height * 0.25 };
    const quick = reduced();
    els.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = from.x - (r.left + r.width / 2);
      const dy = from.y - (r.top + r.height / 2);
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(.5) rotate(${(i % 2 ? 1 : -1) * 12}deg)`, opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { transform: "translate(0, 0) scale(1.06) rotate(0deg)", offset: 0.8 },
          { transform: "none", opacity: 1 },
        ],
        { duration: quick ? 1 : 460, delay: quick ? 0 : 60 * i, easing: "cubic-bezier(.2,.75,.25,1)", fill: "backwards" },
      );
      if (!quick && i % 2 === 0) window.setTimeout(() => alive.current && playPackSound("card_move_01", 0.35), 60 * i + 120);
    });
    const t = window.setTimeout(() => {
      if (!alive.current) return;
      setDealt(true);
      // SR and UR tremble and twinkle until turned
      els.current.forEach((el, i) => {
        if (el && high(cards[i].rarity) && fx.current && !reduced()) {
          fx.current.twinkleOn(() => (alive.current ? el.getBoundingClientRect() : null), cards[i].rarity, () => !alive.current || turnedRef.current[i]);
        }
      });
    }, quick ? 0 : 60 * 7 + 460);
    return () => window.clearTimeout(t);
  }, [cards, fx]);

  const flip = useCallback((i: number, dir: 1 | -1, delay = 0) => {
    if (turnedRef.current[i]) return;
    turnedRef.current[i] = true;
    setTurned([...turnedRef.current]);
    const el = els.current[i];
    const inner = el?.querySelector<HTMLElement>(".po-inner");
    if (!el || !inner) return;
    const r = cards[i].rarity;
    const quick = reduced();
    const { wait, turn } = quick ? { wait: 0, turn: 1 } : TURN[r];
    if (wait) {
      window.setTimeout(() => alive.current && playPackSound("card_shake", 0.6), delay);
      el.animate(
        [{ transform: "none" }, { transform: "rotate(-2.5deg) scale(1.03)" }, { transform: "rotate(2.5deg) scale(1.05)" },
         { transform: "rotate(-2deg) scale(1.06)" }, { transform: "rotate(2deg) scale(1.07)" }, { transform: "scale(1.08)" }],
        { duration: wait, delay, easing: "linear" },
      );
    }
    el.animate(
      [{ transform: wait ? "scale(1.08)" : "none" },
       { transform: `translateY(-7%) scale(1.18) rotate(${-dir * 4}deg)`, offset: 0.45 },
       { transform: "translateY(0) scale(.96) rotate(0deg)", offset: 0.82 },
       { transform: "none" }],
      { duration: turn + 120, delay: delay + wait, easing: "cubic-bezier(.3,.6,.3,1)" },
    );
    const a = inner.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${dir * 180}deg)` }],
      { duration: turn, delay: delay + wait, easing: "cubic-bezier(.5,.05,.2,1)", fill: "forwards" });
    a.onfinish = () => { inner.style.transform = `rotateY(${dir * 180}deg)`; };
    window.setTimeout(() => {
      if (!alive.current) return;
      if (!(r === "SR" || r === "UR")) playPackSound("card_move_01", 0.55);
    }, delay + wait);
    window.setTimeout(() => {
      if (!alive.current) return;
      const rect = el.getBoundingClientRect();
      if (fx.current) {
        const c = fx.current.local(rect.left + rect.width / 2, rect.top + rect.height / 2);
        fx.current.reveal(c.x, c.y, rect.width, r);
      }
      if (r === "SR" || r === "UR") {
        playPackSound(r === "UR" ? "card_ur" : "card_sr", 0.85);
        bang(r);
      }
    }, delay + wait + turn * 0.48);
  }, [cards, fx, bang]);

  const turnAll = () => {
    let at = 0;
    turnedRef.current.forEach((done, i) => {
      if (done) return;
      flip(i, 1, at);
      at += 90 + TURN[cards[i].rarity].wait * 0.5;
    });
  };

  const cardAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card]");
    return el ? Number(el.dataset.card) : -1;
  };
  const down = (e: ReactPointerEvent) => {
    if (!dealt) return;
    unlockPackSound();
    drag.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true;
    if (d.moved) {
      const i = cardAt(e.clientX, e.clientY);
      if (i >= 0) flip(i, e.clientX >= d.lastX ? 1 : -1);
    }
    d.lastX = e.clientX;
  };
  const up = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const i = cardAt(e.clientX, e.clientY);
    if (i < 0) return;
    if (turnedRef.current[i]) onOpen(cards[i]);
    else flip(i, 1);
  };

  const allTurned = turned.every(Boolean);
  return (
    <>
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-4">
        <div ref={grid} className="po-grid" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
          {cards.map((c, i) => (
            <div key={i} ref={(el) => { els.current[i] = el; }} data-card={i} className={`po-card ${high(c.rarity) && !turned[i] ? `po-card-${c.rarity.toLowerCase()}` : ""}`}
                 role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { if (turned[i]) onOpen(c); else flip(i, 1); } }}
                 aria-label={turned[i] ? `${c.card.name} ${c.rarity}${c.finish !== "basic" ? ` ${FINISH_LABEL[c.finish]}` : ""}` : `${i + 1}번째 카드 넘기기`}>
              <span className="po-inner">
                <span className="po-back">
                  {high(c.rarity) && <img src={`${FX}glow_${c.rarity.toLowerCase()}.webp`} alt="" aria-hidden="true" className="po-glow" />}
                  <img src={`${FX}back.webp`} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 w-full h-full object-cover rounded-[4%]" />
                  {high(c.rarity) && <span className="po-foil" style={{ backgroundImage: `url(${FX}foil_${c.rarity.toLowerCase()}.webp)` }} />}
                </span>
                <span className="po-front">
                  <CardFace pulled={c} isNew={fresh.has(c.card.print)} />
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-20 flex flex-col items-center gap-1 px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] min-h-[96px]">
        {!allTurned ? (
          <>
            <button type="button" onClick={turnAll} disabled={!dealt} className="po-button">전부 넘긴다</button>
            <span className="text-xs text-white/60">카드를 쓸어 넘겨도 됩니다</span>
          </>
        ) : (
          <button type="button" onClick={onNext} className="po-button po-pop">{last ? "OK" : "NEXT"}</button>
        )}
      </div>
    </>
  );
}

function CardFace({ pulled, isNew }: { pulled: Pulled<PackCard>; isNew: boolean }) {
  const { card, rarity, finish } = pulled;
  return (
    <>
      <img src={card.thumb} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover card-corner" />
      {finish !== "basic" && <span className={`po-sheen ${finish === "royal" ? "po-royal" : ""}`} style={finish === "royal" ? { backgroundImage: `url(${FX}rainbow.webp)` } : undefined} />}
      <img src={`/media/md_ui/rarity_${rarity.toLowerCase()}_hd.png`} alt="" className="absolute top-0 right-0 h-[11%] w-auto" />
      {isNew && <img src={`${FX}new.webp`} alt="NEW" className="absolute -top-[4%] -left-[4%] h-[12%] w-auto drop-shadow" />}
      {finish !== "basic" && (
        <span className={`absolute bottom-[3%] left-[3%] px-1 rounded text-[9px] sm:text-[11px] font-bold leading-4 ${finish === "royal" ? "bg-fuchsia-600" : "bg-sky-600"}`}>
          {FINISH_LABEL[finish]}
        </span>
      )}
    </>
  );
}

/** 팩 개봉 결과: every card pulled, UR first, a royal or shine one before a plain one, popping in; a tap shows it large. */
function Result({ pack, packs, fresh, onOpen, onAgain, onClose }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>;
  onOpen: (c: Pulled<PackCard>) => void; onAgain: (count: 1 | 10) => void; onClose: () => void;
}) {
  const all = useMemo(() => {
    const finishRank = { royal: 2, shine: 1, basic: 0 };
    return packs.flat().map((c, i) => ({ c, i }))
      .sort((a, b) => RANK[b.c.rarity] - RANK[a.c.rarity] || finishRank[b.c.finish] - finishRank[a.c.finish] || a.i - b.i)
      .map((x) => x.c);
  }, [packs]);
  const count = (r: Rarity) => all.filter((c) => c.rarity === r).length;
  return (
    <div className="relative z-10 flex-1 min-h-0 flex flex-col">
      <div className="px-4 pb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {(["UR", "SR", "R", "N"] as Rarity[]).map((r) => (
          <span key={r} className="flex items-center gap-1 tabular-nums">
            <img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" />{count(r)}
          </span>
        ))}
        <span className="ml-auto text-white/70 tabular-nums">{(packs.length * GEMS_PER_PACK).toLocaleString()}젬</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-w-4xl mx-auto">
          {all.map((c, i) => (
            <button key={i} type="button" onClick={() => onOpen(c)} className={`po-result relative aspect-[704/1024] ${high(c.rarity) ? `po-result-${c.rarity.toLowerCase()}` : ""}`}
                    style={{ animationDelay: `${Math.min(i, 40) * 22}ms` }}
                    aria-label={`${c.card.name} ${c.rarity}${c.finish !== "basic" ? ` ${FINISH_LABEL[c.finish]}` : ""}`}>
              <CardFace pulled={c} isNew={fresh.has(c.card.print)} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-2 px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/60">
        <button type="button" onClick={() => onAgain(1)} className="po-button po-small">1팩 <small>{GEMS_PER_PACK}젬</small></button>
        <button type="button" onClick={() => onAgain(10)} className="po-button po-small">10팩 <small>{(GEMS_PER_PACK * 10).toLocaleString()}젬</small></button>
        <button type="button" onClick={onClose} className="po-button po-small po-plain" aria-label={`${pack.name} 페이지로`}>닫기</button>
      </div>
    </div>
  );
}

const CSS = `
.po-rays { position: absolute; left: 50%; top: 50%; width: 170vmax; height: 170vmax; translate: -50% -50%; animation: po-spin 70s linear infinite; opacity: .6; transition: opacity .6s; }
.po-rays.po-lit { opacity: .85; }
.po-rays > span { position: absolute; width: calc(50% + 2px); height: calc(50% + 2px); margin: -1px; background-size: 100% 100%; }
@keyframes po-spin { to { rotate: 360deg; } }
.po-streaks { position: absolute; inset: 0; background-size: 120% 100%; background-position: center 0; mix-blend-mode: screen; opacity: .22; animation: po-rise-bg 6s linear infinite; }
@keyframes po-rise-bg { to { background-position: center -100vh; } }
.po-floor { position: absolute; left: -20%; right: -20%; bottom: -30%; height: 70%; border-radius: 50%; filter: blur(30px); opacity: .55; transition: background .6s; }
.po-floor-n, .po-floor-r { background: radial-gradient(closest-side, rgba(90,160,255,.6), transparent); }
.po-floor-sr { background: radial-gradient(closest-side, rgba(255,200,70,.65), transparent); }
.po-floor-ur { background: conic-gradient(from 0deg, #ff5a7a, #ffb84a, #fff35a, #6cff8a, #5ad8ff, #7a7cff, #e06bff, #ff5a7a); mask-image: radial-gradient(closest-side, #000, transparent); -webkit-mask-image: radial-gradient(closest-side, #000, transparent); animation: po-spin 8s linear infinite; }

.po-pack { position: relative; height: min(58svh, 118vw); aspect-ratio: 250 / 512; touch-action: none; cursor: pointer; }
.po-pack-box { position: absolute; inset: 0; display: block; animation: po-arrive .6s cubic-bezier(.2,.8,.3,1.15) both, po-float 3s ease-in-out .6s infinite alternate; }
@keyframes po-arrive { from { transform: translateY(40%) scale(.6) rotate(-6deg); opacity: 0; } }
@keyframes po-float { to { transform: translateY(-2%); } }
.po-aura { position: absolute; inset: -14% -22%; border-radius: 40%; filter: blur(22px); opacity: .75; animation: po-breathe 1.4s ease-in-out infinite alternate; background-size: 100% 300%; }
.po-aura-n, .po-aura-r { background-color: rgba(110,170,255,.55); }
.po-aura-sr { background-color: rgba(255,196,64,.75); }
.po-aura-ur { opacity: .9; animation: po-breathe 1s ease-in-out infinite alternate, po-hue 2.4s linear infinite; }
@keyframes po-breathe { from { transform: scale(.94); opacity: .55; } to { transform: scale(1.04); opacity: .95; } }
@keyframes po-hue { to { background-position: 0 300%; } }
.po-thunder { position: absolute; top: -25%; height: 150%; width: auto; max-width: none; mix-blend-mode: screen; opacity: 0; pointer-events: none; }
.po-thunder-a { left: -55%; animation: po-strike 2.3s steps(1) infinite; }
.po-thunder-b { right: -55%; transform: scaleX(-1); animation: po-strike 2.3s steps(1) 1.1s infinite; }
@keyframes po-strike { 0% { opacity: 0; } 4% { opacity: 1; } 7% { opacity: .2; } 10% { opacity: .9; } 16% { opacity: 0; } }
.po-top { clip-path: inset(0 0 83% 0); }
.po-body { clip-path: inset(17% 0 0 0); }
.po-cutline { position: absolute; left: -3%; right: -3%; top: 17%; height: 4px; margin-top: -2px; transform-origin: left center; border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,.2), #fff 70%, #fff); box-shadow: 0 0 10px 3px rgba(255,240,180,.95), 0 0 24px 8px rgba(120,190,255,.6); transition: transform .08s; pointer-events: none; }
.po-slash { position: absolute; left: -40%; top: 17%; width: 180%; max-width: none; translate: 0 -50%; opacity: 0; mix-blend-mode: screen; pointer-events: none; }
.po-cutting .po-pack-box { animation: none; }
.po-cutting .po-top { animation: po-fly-top .55s cubic-bezier(.3,.6,.4,1) forwards; transform-origin: 90% 17%; }
.po-cutting .po-body { animation: po-drop .45s ease-in .28s forwards; }
.po-cutting .po-slash { animation: po-slash .3s ease-out both; }
.po-cutting .po-cutline { opacity: 0; transition: opacity .25s .1s; }
.po-cutting .po-aura, .po-cutting .po-thunder { opacity: 0 !important; transition: opacity .3s; animation: none; }
@keyframes po-fly-top { to { transform: translate(30%, -120%) rotate(28deg); opacity: 0; } }
@keyframes po-drop { to { transform: translateY(25%) scale(.92); opacity: 0; } }
@keyframes po-slash { 0% { opacity: 0; transform: translateX(-30%); } 35% { opacity: 1; } 100% { opacity: 0; transform: translateX(35%); } }

.po-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; width: min(100%, calc((100svh - 210px) / 2 * 0.6875 * 4 + 30px), 760px); perspective: 1100px; touch-action: none; }
.po-card { position: relative; aspect-ratio: 704 / 1024; cursor: pointer; will-change: transform; }
.po-card-sr .po-back, .po-card-ur .po-back { animation: po-tremble 2.2s ease-in-out infinite; }
@keyframes po-tremble { 0%, 86%, 100% { transform: none; } 88% { transform: rotate(-1.6deg); } 91% { transform: rotate(1.6deg); } 94% { transform: rotate(-1deg); } 97% { transform: rotate(.8deg); } }
.po-inner { position: absolute; inset: 0; display: block; transform-style: preserve-3d; }
.po-back, .po-front { position: absolute; inset: 0; display: block; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.po-front { transform: rotateY(180deg); }
.po-glow { position: absolute; inset: -10% -13%; width: 126%; height: 120%; max-width: none; mix-blend-mode: screen; animation: po-glow 1s ease-in-out infinite alternate; }
@keyframes po-glow { from { opacity: .55; transform: scale(.98); } to { opacity: 1; transform: scale(1.04); } }
.po-foil { position: absolute; inset: 0; border-radius: 4%; background-size: 220% 220%; mix-blend-mode: screen; opacity: .6; animation: po-foil 4s linear infinite; }
@keyframes po-foil { to { background-position: 220% 110%; } }
.po-sheen { position: absolute; inset: 0; border-radius: 4.5%; pointer-events: none; background-image: linear-gradient(115deg, transparent 32%, rgba(255,255,255,.6) 46%, transparent 60%); background-size: 260% 100%; mix-blend-mode: overlay; animation: po-sheen 2.4s ease-in-out infinite; }
.po-royal { background-size: 100% 300%; mix-blend-mode: soft-light; opacity: .85; animation: po-royal 3s linear infinite; }
@keyframes po-sheen { from { background-position: 130% 0; } to { background-position: -130% 0; } }
@keyframes po-royal { to { background-position: 0 300%; } }

.po-flash { position: absolute; inset: 0; z-index: 40; pointer-events: none; background: radial-gradient(circle at 50% 50%, rgba(255,255,255,.75), rgba(255,255,255,.15) 60%, transparent); animation: po-flash .42s ease-out forwards; }
@keyframes po-flash { from { opacity: 1; } to { opacity: 0; } }

.po-result { animation: po-pop .34s cubic-bezier(.2,.8,.3,1.3) both; }
.po-result-ur { filter: drop-shadow(0 0 6px rgba(255,255,255,.55)); }
.po-result-sr { filter: drop-shadow(0 0 5px rgba(255,200,80,.55)); }
@keyframes po-pop { from { transform: scale(.6); opacity: 0; } }

.po-button { min-width: 150px; height: 50px; padding: 0 22px; border-radius: 9999px; font-weight: 800; letter-spacing: .05em; color: #fff;
  background: linear-gradient(180deg, #4f8ff7, #1d4ed8); box-shadow: 0 0 0 1px rgba(255,255,255,.3) inset, 0 0 22px rgba(80,150,255,.55); }
.po-button:disabled { opacity: .5; }
.po-button small { font-weight: 600; opacity: .8; margin-left: 4px; }
.po-pop { animation: po-pop .3s cubic-bezier(.2,.8,.3,1.4) both; }
.po-small { min-width: 0; height: 44px; padding: 0 16px; font-size: 14px; }
.po-plain { background: rgba(255,255,255,.12); box-shadow: none; }
@media (hover: hover) { .po-button:hover { filter: brightness(1.12); } }
@media (prefers-reduced-motion: reduce) {
  .po-rays, .po-streaks, .po-floor-ur, .po-pack-box, .po-aura, .po-thunder, .po-glow, .po-foil, .po-sheen, .po-royal, .po-result, .po-card-sr .po-back, .po-card-ur .po-back { animation: none; }
}
`;
