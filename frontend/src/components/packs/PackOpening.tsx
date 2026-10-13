import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { PackCard, PackDetail } from "@/api/packApi";
import { getCard } from "@/api/cardDexApi";
import CardZoom from "@/components/CardZoom";
import { type FinishParams, finishSupported } from "@/lib/cardFinish";
import { lazyChunk } from "@/lib/lazyChunk";
import { FxLayer } from "@/lib/packFx";
import { GemCount, GemIcon } from "@/components/packs/Gem";
import { playCardMove, playPackSound, setSoundOn, soundOn, unlockPackSound } from "@/lib/packSound";
import { type Pulled, type Rarity, GEMS_PER_PACK } from "@/utils/packDraw";

const FX = "/media/md_ui/packopen/";
/** How long the cards take (ms), slow enough to follow a turn on a phone (엘리스 10/13: "회전이 너무 빨라서 안 보여요"). */
const T = {
  // from the tear, as the game's openings go (its 4.5 s cut sound rising under them, 엘리스 10/13): the cards out at
  // 1.3 s, the pack gone at 2.3 s, the cards dealt at 3.2 s
  out: 1320, gone: 2300, dealt: 3200,
  strikeAt: 120, tearAt: 1000,                  // from the tap: the first strike, then the tear (or Hope)
  rattle: 480, rattleWait: { SR: 40, UR: 620 }, // a marked SR / UR shaking before it turns, a UR then held a moment
  stream: 240, streamGap: 95,                   // out of the opened pack and off the top, one after the next
  deal: 320, dealGap: 50,                       // up into place from below, one after the next
  turn: { N: 400, R: 400, SR: 520, UR: 900 },   // face down to face up (a UR twisting the wrong way first)
  leap: { SR: 1500, UR: 1900 },                 // an SR / UR up, held large and back down
  premium: 1000, premiumLift: 1400,             // a shine / royal card's extra turn into its finish
  allGap: { low: 200, high: 700 },              // 전부 넘긴다: between one card and the next
};
const CardFinishCanvas = lazyChunk(() => import("@/components/CardFinishCanvas"));
const MAX_SHADED = 12;
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, UR: 3 };
const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;
// The opening plays in full whatever the device's reduced-motion setting says: it is what a visitor comes to watch
// (엘리스 10/13 "동작 줄이기 무시하세요" — on an iPhone with it on, the cards did not turn at all).
const high = (r: Rarity) => r === "SR" || r === "UR";
const best = (cards: Pulled<PackCard>[]) => cards.reduce<Rarity>((b, c) => (RANK[c.rarity] > RANK[b] ? c.rarity : b), "N");

/** What a pack shows of what it holds, by what the game's players have found (AppMedia's 확정 연출 page, 2025) and the
 *  game's openings watched here (엘리스 10/13); the odds are ours, its server deciding:
 *  - tier: the colour of its floor and of the curtain the cards come out through, which never lies — gold for an SR or
 *    better (a UR pack one time in two), rainbow only for a UR;
 *  - aura: the pack itself turning gold or rainbow as it comes on — as its tier, and now and then gold on a pack of N
 *    and R only (an upgrade is no promise);
 *  - lightning: one to three bolts each time it is opened, more for an SR or better, the third one red;
 *  - Hope tearing it: mostly when a card in it comes in a shine or royal finish, whatever its rarity (엘리스: "호프
 *    나왔는데 쪽박일 때도 많았다");
 *  - an SR / UR's gold / blue-purple back in one pack of two (a promise); and every SR / UR shakes before it turns. */
type Tier = "N" | "SR" | "UR";
type Hints = { tier: Tier; aura: Tier; strikes: number; red: number; monster: boolean; marked: boolean };
const pick = (weights: number[]) => {
  let x = Math.random();
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
  return weights.length - 1;
};
const hintsFor = (cards: Pulled<PackCard>[]): Hints => {
  const top = best(cards);
  const rare = top === "SR" || top === "UR";
  const tier: Tier = top === "UR" && Math.random() < 0.5 ? "UR" : rare ? "SR" : "N";
  const aura: Tier = rare ? tier : Math.random() < 0.06 ? "SR" : "N";
  const strikes = 1 + pick(rare ? [0.25, 0.4, 0.35] : [0.6, 0.35, 0.05]);
  const finish = cards.some((c) => c.finish !== "basic");
  return { tier, aura, strikes, red: strikes === 3 ? 2 : -1, monster: Math.random() < (finish ? 0.15 : 0.02),
           marked: rare && Math.random() < 0.5 };
};
const frameOf = (tier: Tier) => (tier === "UR" ? "po-frame-ur" : tier === "SR" ? "po-frame-sr" : "");

type Stage = "overview" | "pack" | "cards" | "result";
type Zoom = { card: Pulled<PackCard>; params: FinishParams | null };
type Fx = MutableRefObject<FxLayer | null>;

/** The game's pack opening, rebuilt from its own pictures, sounds and effect data and from watching it (엘리스 10/12–13:
 *  "진짜 마듀처럼"): a blue burst to begin; a dark stage with a lit horizon the packs and cards stand and mirror on; ten
 *  packs laid out first (gold those with an SR, rainbow those with a UR); each pack comes on, a single pack may turn
 *  into its gold or rainbow pack; a tap or a stroke opens it — lightning strikes (a red bolt hinting at an SR / UR), then
 *  it tears in a white flash or Hope tears it for a UR; light pours up through a blue, gold or rainbow curtain, the
 *  cards shoot out and rise into place from below, a glint running along them; a tap or a finger drawn across turns
 *  them — N and R whisk over, SR and UR leap up in light and dust (one whose back showed it rattling first, a UR
 *  twisting the wrong way, a ring spreading), and a shine or royal card turns once more into its finish
 *  in the game's shader. Then the cards slide off, the next pack comes, and the 팩 개봉 결과. */
export default function PackOpening({ pack, packs, fresh, gems, owed = false, onClose, onAgain, onStage }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>; gems: number; owed?: boolean;
  onClose: () => void; onAgain: (count: 1 | 10) => void; onStage?: (stage: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>(packs.length > 1 ? "overview" : "pack");
  const [sound, setSound] = useState(soundOn);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [flash, setFlash] = useState<{ id: number; white: boolean } | null>(null);
  const hints = useMemo(() => packs.map(hintsFor), [packs]);
  const fxCanvas = useRef<HTMLCanvasElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fx = useRef<FxLayer | null>(null);
  const shaker = useRef<HTMLDivElement>(null);
  const [warp, setWarp] = useState(true);
  const [finishes, setFinishes] = useState<Map<number, FinishParams>>(() => new Map());
  const total = packs.length;

  // the opening's start sound, once, with the blue burst (the game's openings: once each, before the packs); Hope's picture
  // fetched now, so it is there when it cuts in
  useEffect(() => {
    playPackSound("01_op", 0.7);
    new Image().src = `${FX}monster.webp`;
  }, []);

  // a shine or royal card turns into its finish in the game's shader: what that needs, asked for once now
  useEffect(() => {
    let live = true;
    const want = packs.flat().filter((c) => c.finish !== "basic");
    Promise.all(want.map(async (c) => {
      try {
        const doc = await getCard(c.card.card);
        const face = doc.faces.find((f) => f.id === c.card.print);
        const params: FinishParams = { ...doc.finish, frame: face?.overframe ? "overframe" : doc.finish.frame, name: face?.name_mask ?? null };
        return [c.card.print, params] as const;
      } catch {
        return null;
      }
    })).then((rows) => {
      if (live) setFinishes(new Map(rows.filter((r): r is readonly [number, FinishParams] => !!r)));
    });
    return () => { live = false; };
  }, [packs]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";   // no pull-to-refresh under a stroke
    const front = new FxLayer(fxCanvas.current!);
    const back = new FxLayer(bgCanvas.current!);
    fx.current = front;
    let gone = false;
    back.drift(() => gone);
    const onResize = () => {
      front.resize();
      back.resize();
    };
    window.addEventListener("resize", onResize);
    for (const c of packs.flat()) new Image().src = c.card.thumb;   // a card shows the moment it turns
    return () => {
      gone = true;
      front.destroy();
      back.destroy();
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = prev;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
    };
  }, [packs]);

  useEffect(() => {
    onStage?.(stage);
  }, [stage, onStage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoom]);

  const flashNow = useCallback((white: boolean) => setFlash({ id: Date.now() + Math.random(), white }), []);
  const shake = useCallback(() => {
    if (!shaker.current) return;
    shaker.current.animate(
      [{ transform: "none" }, { transform: "translate(-6px, 3px)" }, { transform: "translate(5px, -4px)" }, { transform: "translate(-3px, 2px)" }, { transform: "none" }],
      { duration: 320, easing: "ease-out" },
    );
  }, []);

  const toResult = () => {
    fx.current?.clear();
    setStage("result");
  };
  const next = () => {
    fx.current?.clear();
    if (index + 1 >= total) return toResult();
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

  return (
    <div className="po-root fixed inset-0 z-[60] text-white select-none overflow-hidden" role="dialog" aria-modal="true" aria-label={`${pack.name} 개봉`}>
      <style>{CSS}</style>
      <div ref={shaker} className="absolute inset-0">
        <div className="po-backdrop" aria-hidden="true" />
        <div className="po-horizon" aria-hidden="true" />
        <canvas ref={bgCanvas} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />

        {stage === "overview" && <Overview packs={packs} hints={hints} pack={pack} onOpen={() => {
          // the game's pack-out sound as the ten go and the first comes forward (heard there in its openings, 엘리스 10/13)
          unlockPackSound();
          playPackSound("02_packout", 0.8);
          setStage("pack");
        }} />}
        {stage === "pack" && (
          <PackScene key={index} pack={pack} hints={hints[index]} framed={total > 1} fx={fx} flash={flashNow} onOpened={() => setStage("cards")} />
        )}
        {stage === "cards" && (
          <Cards key={index} cards={packs[index]} marked={hints[index].marked} fresh={fresh} finishes={finishes} fx={fx} flash={flashNow} shake={shake} onOpen={open}
                 last={index + 1 >= total} onNext={next} />
        )}
        {stage === "result" && <Result pack={pack} packs={packs} fresh={fresh} finishes={finishes} gems={gems} owed={owed} onOpen={open} onAgain={onAgain} onClose={onClose} />}

        <div className="absolute left-0 right-0 top-0 z-40 flex items-start justify-between px-4 pt-[max(12px,env(safe-area-inset-top))]">
          <span className="po-count">{stage === "result" ? "팩 개봉 결과" : stage === "overview" ? pack.name : `${index + 1}/${total}`}</span>
          <span className="flex items-center gap-2">
            <GemCount dark />
            <button type="button" onClick={() => { setSoundOn(!sound); setSound(!sound); }} aria-label={sound ? "소리 끄기" : "소리 켜기"}
                    className="w-9 h-9 rounded-full bg-black/40 border border-white/30">{sound ? "🔊" : "🔇"}</button>
            <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-full bg-black/40 border border-white/30">✕</button>
          </span>
        </div>
        {stage !== "result" && total > 1 && (
          <button type="button" onClick={toResult} className="po-skip">SKIP</button>
        )}
      </div>

      <canvas ref={fxCanvas} className="absolute inset-0 z-50 w-full h-full pointer-events-none" aria-hidden="true" />
      {warp && (
        <div className="po-warp" aria-hidden="true" onAnimationEnd={() => setWarp(false)}>
          <div className="po-warp-rays">
            {[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y], i) => (
              <span key={i} style={{ backgroundImage: `url(${FX}rays.webp)`, transform: `scale(${x}, ${y})`, left: x > 0 ? 0 : "50%", top: y > 0 ? 0 : "50%" }} />
            ))}
          </div>
        </div>
      )}
      {flash && <span key={flash.id} className={flash.white ? "po-flash-white" : "po-flash"} aria-hidden="true" onAnimationEnd={() => setFlash(null)} />}

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

/** Ten packs laid out on the stage, gold those holding an SR, rainbow those holding a UR; OPEN opens them one by one. */
function Overview({ packs, hints, pack, onOpen }: { packs: Pulled<PackCard>[][]; hints: Hints[]; pack: PackDetail; onOpen: () => void }) {
  return (
    <>
      <div className="po-overview">
        {packs.map((_, i) => (
          <div key={i} className={`po-mini ${frameOf(hints[i].tier)}`} style={{ animationDelay: `${i * 40}ms` }}>
            <PackPicture pack={pack} small />
          </div>
        ))}
      </div>
      <div className="po-bottom">
        <button type="button" onClick={onOpen} className="po-cmd">OPEN</button>
      </div>
    </>
  );
}

function PackPicture({ pack, small = false }: { pack: PackDetail; small?: boolean }) {
  const src = small ? pack.image : pack.image_hd ?? pack.image;
  return src ? (
    <img src={src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
  ) : (
    <span className="absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-500 to-amber-800 flex items-center justify-center p-2">
      <span className="text-center text-xs font-extrabold break-keep">{pack.name}</span>
    </span>
  );
}

/** One pack: it comes on (turning gold or rainbow if it holds an SR / UR), and a tap or a stroke opens it. */
function PackScene({ pack, hints, framed, fx, flash, onOpened }: {
  pack: PackDetail; hints: Hints; framed: boolean; fx: Fx; flash: (white: boolean) => void; onOpened: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [bolts, setBolts] = useState<number[]>([]);
  const [floor, setFloor] = useState(false);
  // a single pack starts plain and turns into its gold or rainbow pack; after the ten laid out it already is
  const [tier, setTier] = useState<Tier>(framed ? hints.tier : "N");
  const [upgrading, setUpgrading] = useState(false);
  const [monster, setMonster] = useState(false);
  const [phase, setPhase] = useState<"stand" | "strike" | "cut" | "pour" | "rise" | "leave">("stand");
  const [line, setLine] = useState(0);
  const timers = useRef<number[]>([]);
  const drag = useRef<{ x: number; max: number; onPack: boolean } | null>(null);
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // the strikes land left, right, then lower left of the pack, a sixth of a second apart
  const SPOTS = [0.2, 0.8, 0.1];
  const strike = (k: number) => {
    setBolts((b) => [...b, k]);
    // one thunder an opening, whichever of the game's three, however many bolts (its openings: one each time)
    if (k === 0) playPackSound((["kaminari_01", "kaminari_02", "kaminari_03"] as const)[Math.floor(Math.random() * 3)], 0.7);
    const r = root.current?.getBoundingClientRect();
    const p = box.current?.getBoundingClientRect();
    if (r && p && fx.current) {
      const foot = fx.current.local(r.left + r.width * SPOTS[k], p.bottom + (k === 2 ? p.height * 0.08 : 0));
      fx.current.strike(foot.x, foot.y, p.width * 0.35, k === hints.red);
    }
  };

  useEffect(() => {
    if (!framed) playPackSound("02_packout_1pack", 0.8);
    const t = 420;
    const shown = framed ? hints.tier : "N";   // as it comes on: after the ten laid out, as it was there
    if (framed && hints.tier !== "N") at(t, () => setFloor(true));
    if (hints.aura !== shown) {
      // the upgrade: a sheen runs over it, it draws in and springs out as its gold or rainbow pack, to the game's upgrade
      // sound from just before its peak so the peak meets the flash (proc_rare is a finish's); the floor lights only for
      // a real one
      at(t, () => {
        setUpgrading(true);
        playPackSound(hints.aura === "UR" ? "upgrad_01_ur" : "upgrad_01", 0.75, 1, hints.aura === "UR" ? 2.675 : 1.24);
      });
      at(t + 330, () => { setTier(hints.aura); if (hints.tier !== "N") setFloor(true); flash(false); });
      at(t + 800, () => setUpgrading(false));
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // a tap or a stroke opens it as the game does: lightning first, every time, then the tear a second after the tap —
  // or Hope tearing it
  const cut = () => {
    if (phase !== "stand") return;
    unlockPackSound();
    setTier(hints.aura);
    setLine(1);
    setPhase("strike");
    for (let k = 0; k < hints.strikes; k++) at(T.strikeAt + k * 167, () => strike(k));
    at(T.tearAt, () => (hints.monster ? setMonster(true) : tear()));
  };

  const tear = () => {
    const p = box.current?.getBoundingClientRect();
    if (p && fx.current) {
      const a = fx.current.local(p.left, p.top + p.height * 0.17);
      fx.current.cut(a.x - p.width * 0.1, a.x + p.width * 1.1, a.y, p.width);
    }
    setLine(1);
    setPhase("cut");
    flash(true);
    playPackSound("03_cut", 0.6);
    at(140, () => setPhase("pour"));
    at(T.out, () => setPhase("rise"));
    at(T.gone, () => setPhase("leave"));
    at(T.dealt, onOpened);
  };

  const monsterDone = () => {
    setMonster(false);
    tear();
  };

  // a stroke sideways anywhere on the screen opens it, a third of the pack's width being enough (엘리스 10/13: "인식 범위가
  // 너무 좁아요"); a tap opens it only on the pack
  const SWIPE = 0.32;
  const down = (e: ReactPointerEvent) => {
    unlockPackSound();
    const target = e.target as HTMLElement;
    if (phase !== "stand" || target.closest("button")) return;
    drag.current = { x: e.clientX, max: 0, onPack: !!box.current?.contains(target) };
    try {
      root.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the stroke still counts while it stays on the screen */
    }
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const p = box.current?.getBoundingClientRect();
    if (!d || !p || phase !== "stand") return;
    const span = Math.abs(e.clientX - d.x) / p.width;
    d.max = Math.max(d.max, span);
    setLine(Math.min(1, span / SWIPE));
    if (span > SWIPE) {
      drag.current = null;
      cut();
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || phase !== "stand") return;
    if (d.max < 0.08 && d.onPack) cut();
    else setLine(0);
  };

  const poured = phase === "pour" || phase === "rise" || phase === "leave";
  return (
    <div ref={root} className="absolute inset-0" style={{ touchAction: "none" }}
         onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className={`po-floor po-floor-${hints.tier.toLowerCase()} ${floor ? "po-on" : ""}`} aria-hidden="true" />
      <div className={`po-curtain po-curtain-${hints.tier.toLowerCase()} ${poured && phase !== "leave" ? "po-on" : ""}`} aria-hidden="true">
        <span style={{ backgroundImage: `url(${FX}streaks.webp)` }} />
        <span style={{ backgroundImage: `url(${FX}streaks.webp)` }} />
      </div>
      {bolts.map((k) => (
        <img key={k} src={`${FX}thunder.webp`} alt="" aria-hidden="true" className={`po-bolt po-bolt-${k} ${k === hints.red ? "po-bolt-red" : ""}`} />
      ))}

      <div ref={box} className={`po-pack ${frameOf(tier)} ${upgrading ? "po-upgrading" : ""} po-${phase}`}
           role="button" tabIndex={0} aria-label={`${pack.name} 팩 열기`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && cut()}>
        <span className="po-cone" aria-hidden="true" />
        {(phase === "rise" || phase === "leave") && <Stream />}
        <span className="po-part po-body"><PackPicture pack={pack} /></span>
        <span className="po-part po-top"><PackPicture pack={pack} /></span>
        <span className="po-pack-sheen" aria-hidden="true" />
        <span className="po-mouth" aria-hidden="true" />
        {phase === "stand" && <span className="po-perf" aria-hidden="true"><i /></span>}
        <span className="po-cutline" style={{ transform: `scaleX(${line})` }} aria-hidden="true" />
      </div>

      <div className="po-bottom">
        {phase === "stand" && (
          <>
            <button type="button" onClick={cut} className="po-cmd">OPEN</button>
            <span className="po-hint">화면을 옆으로 그어도 열립니다</span>
          </>
        )}
      </div>
      {monster && <Monster onDone={monsterDone} />}
    </div>
  );
}

/** The eight cards out of the opened pack, one after another (엘리스 10/13: "후루루루룩 8장 나오는 게 팩뜯의 맛"): as
 *  the game's own openings show them, each a white glow shot straight up out of the mouth and off the top, a tenth of
 *  a second after the one before. The game gives them no sound of their own: the cut sound's long rise carries the
 *  rush. */
function Stream() {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const cards = [...(box.current?.children ?? [])] as HTMLElement[];
    cards.forEach((el, i) => {
      el.animate(
        [{ transform: "translateY(0) scaleY(1)", opacity: 1 },
         { transform: "translateY(-120%) scaleY(1.12)", opacity: 1, offset: 0.3 },
         { transform: "translateY(-460%) scaleY(1.12)", opacity: 0.9 }],
        { duration: T.stream, delay: T.streamGap * i, easing: "linear", fill: "both" },
      );
    });
  }, []);
  return (
    <span ref={box} className="po-stream" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => <i key={i} />)}
    </span>
  );
}

/** Hope tearing the pack, as the game plays it (its openings, frame by frame; 엘리스 10/13: "너무 피피티 같대요"): the
 *  screen goes black; a yellow sword-arc is drawn across it, then another, crossing; a grey, then a white flash; Hope
 *  comes out of the white burnt bright, its colour returning as the white sinks to a dim grey-violet, a golden flare
 *  bursting under it and jagged yellow lightning crackling across the screen; a moment held; then it burns out white and
 *  the pack is back. */
const ZAPS = [
  { y: 16, r: -7, d: 0 }, { y: 31, r: 5, d: 90 }, { y: 55, r: -4, d: 40 }, { y: 70, r: 8, d: 130 }, { y: 86, r: -6, d: 70 },
];
function Monster({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    playPackSound("hope", 0.75);
    const done = window.setTimeout(onDone, 2150);
    return () => window.clearTimeout(done);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="po-monster" aria-hidden="true">
      <span className="po-mglow" />
      <svg className="po-slash" viewBox="0 0 100 178" preserveAspectRatio="xMidYMid slice">
        <path className="po-slash-a" d="M 30 -14 Q 104 70 50 196" pathLength={1} />
        <path className="po-slash-b" d="M -12 132 Q 46 50 112 86" pathLength={1} />
      </svg>
      <img className="po-mflare" src={`${FX}mons_flare.webp`} alt="" />
      <img className="po-hope" src={`${FX}monster.webp`} alt="" />
      <span className="po-zaps">
        {ZAPS.map((z, i) => (
          <i key={i} style={{ top: `${z.y}%`, rotate: `${z.r}deg`, animationDelay: `${z.d}ms`, backgroundImage: `url(${FX}line.webp)` }} />
        ))}
      </span>
      <span className="po-whiteout" />
    </div>
  );
}

/** The eight cards: they rise from below into place, a glint runs along them, then they turn — a tap, or a
 *  finger drawn across them turning each it passes, in the way it moves. */
function Cards({ cards, marked, fresh, finishes, fx, flash, shake, onOpen, last, onNext }: {
  cards: Pulled<PackCard>[]; marked: boolean; fresh: Set<number>; finishes: Map<number, FinishParams>; fx: Fx; flash: (white: boolean) => void; shake: () => void;
  onOpen: (c: Pulled<PackCard>) => void; last: boolean; onNext: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const turnedRef = useRef<boolean[]>(Array(8).fill(false));
  const [turned, setTurned] = useState<boolean[]>(() => Array(8).fill(false));
  const [finished, setFinished] = useState<boolean[]>(() => Array(8).fill(false));
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ x: number; y: number; lastX: number; moved: boolean } | null>(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const rows = () => {
    const out = new Map<number, DOMRect[]>();
    els.current.forEach((el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const key = Math.round(r.top / 10);
      out.set(key, [...(out.get(key) ?? []), r]);
    });
    return [...out.values()];
  };

  // as in the game's openings: up from below the screen straight into place, left to right, white as they rise; then
  // a glint along each row
  useLayoutEffect(() => {
    const vh = window.innerHeight;
    playPackSound("04_cardin", 0.8);
    els.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.animate(
        [{ transform: `translateY(${vh - r.top + 12}px)`, filter: "brightness(3)" },
         { filter: "brightness(1.5)", offset: 0.8 },
         { transform: "none", filter: "brightness(1)" }],
        { duration: T.deal, delay: T.dealGap * i, easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" },
      );
    });
    const landed = T.dealGap * 7 + T.deal;
    const t1 = window.setTimeout(() => {
      if (!alive.current || !fx.current) return;
      rows().forEach((row, k) => {
        const first = row[0];
        const lastR = row[row.length - 1];
        window.setTimeout(() => {
          if (!alive.current || !fx.current) return;
          const a = fx.current.local(first.left, first.top + first.height / 2);
          const b = fx.current.local(lastR.right, lastR.top + lastR.height / 2);
          fx.current.sweep(a.x, b.x, a.y, first.width, 480);
        }, k * 110);
      });
    }, landed + 60);
    const t2 = window.setTimeout(() => {
      if (!alive.current) return;
      setReady(true);
      els.current.forEach((el, i) => {
        if (el && marked && high(cards[i].rarity) && fx.current) {
          fx.current.twinkleOn(() => (alive.current ? el.getBoundingClientRect() : null), cards[i].rarity, () => !alive.current || turnedRef.current[i]);
        }
      });
    }, landed + 300);
    return () => [t1, t2].forEach(clearTimeout);
  }, [cards, fx, marked]);

  /** A shine or royal card, once face up, turns once more and comes round in its finish, in a burst of light (the
   *  game's "premium" turn, seen in its own openings). */
  const premium = useCallback((i: number, dir: 1 | -1, delay: number) => {
    const el = els.current[i];
    const inner = el?.querySelector<HTMLElement>(".po-inner");
    if (!el || !inner) return;
    const royal = cards[i].finish === "royal";
    window.setTimeout(() => { if (alive.current) el.style.zIndex = "20"; }, delay);
    el.animate([{ transform: "none" }, { transform: "translateY(-8%) scale(1.22)", offset: 0.4 }, { transform: "translateY(-8%) scale(1.22)", offset: 0.8 }, { transform: "none" }],
      { duration: T.premiumLift, delay, easing: "cubic-bezier(.3,.7,.3,1)" }).onfinish = () => { el.style.zIndex = ""; };
    const a = inner.animate([{ transform: `rotateY(${dir * 180}deg)` }, { transform: `rotateY(${dir * 540}deg)` }],
      { duration: T.premium, delay: delay + 120, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" });
    a.onfinish = () => { inner.style.transform = `rotateY(${dir * 540}deg)`; };
    window.setTimeout(() => { if (alive.current) { setFinished((f) => f.map((v, j) => v || j === i)); playCardMove(0.6); } }, delay + 120 + T.premium / 2);
    window.setTimeout(() => {
      if (!alive.current) return;
      const rect = el.getBoundingClientRect();
      if (fx.current) {
        const c = fx.current.local(rect.left + rect.width / 2, rect.top + rect.height / 2);
        fx.current.premium(c.x, c.y, rect.width, royal);
      }
      playPackSound(royal ? "proc_rare_02" : "proc_rare", 0.8);   // the game's, as a shine / royal card comes round
      flash(false);
    }, delay + 120 + T.premium);
  }, [cards, fx, flash]);

  /** How long a card rattles (and a UR then waits) before it turns: every SR / UR (the game's openings: its shake sound
   *  before each SR / UR, its back marked or not; a shake promises one). */
  const rattleOf = useCallback((i: number) => {
    const r = cards[i].rarity;
    return high(r) ? T.rattle + T.rattleWait[r as "SR" | "UR"] : 0;
  }, [cards]);

  const flip = useCallback((i: number, dir: 1 | -1, start = 0) => {
    if (turnedRef.current[i]) return;
    turnedRef.current[i] = true;
    setTurned([...turnedRef.current]);
    const el = els.current[i];
    const inner = el?.querySelector<HTMLElement>(".po-inner");
    if (!el || !inner) return;
    const r = cards[i].rarity;
    const big = high(r);
    const ur = r === "UR";
    // a marked SR / UR first rattles where it lies, "챠카챠카", with the game's sound for it (엘리스 10/13)
    const wait = rattleOf(i);
    if (wait) {
      el.animate([0, 7, -7, 6, -6, 5, -4, 2, 0].map((d) => ({ transform: `rotate(${d}deg)` })), { duration: T.rattle, delay: start });
      // the game's card-shake rattle, "챠카챠카" (엘리스 10/13; heard in its openings under each shake once the music is
      // filtered out — not the rising proc_rare_02 used before)
      window.setTimeout(() => { if (alive.current) playPackSound("card_shake", 0.85); }, start);
    }
    const delay = start + wait;
    // a UR first twists the wrong way, then whips round
    const turn = T.turn[r];
    const a = inner.animate(ur
      ? [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${-dir * 38}deg)`, offset: 0.38 }, { transform: `rotateY(${dir * 180}deg)` }]
      : [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${dir * 180}deg)` }],
      { duration: turn, delay, easing: ur ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    a.onfinish = () => { inner.style.transform = `rotateY(${dir * 180}deg)`; };
    const show = turn * (ur ? 0.72 : 0.5);   // when the face comes round
    // and the back is put away then: Safari draws a back's moving glow and foil (an SR / UR's whose back showed it) on
    // their own layers, which ignore its backface hiding, so a turned card came round to its back (엘리스 10/13)
    window.setTimeout(() => { inner.querySelector<HTMLElement>(".po-back")?.style.setProperty("visibility", "hidden"); }, delay + show);
    let settled = delay + turn + 70;
    if (big) {
      // the leap: up and large, held a moment in its light, then back to its place
      const scale = r === "UR" ? 1.75 : 1.5;
      const hold = T.leap[r as "SR" | "UR"];
      const start = delay + (ur ? turn * 0.45 : 0);
      window.setTimeout(() => { if (alive.current) el.style.zIndex = "20"; }, start);
      el.animate(
        [{ transform: "none" }, { transform: `translateY(-28%) scale(${scale})`, offset: 0.2 },
         { transform: `translateY(-29%) scale(${scale * 1.02})`, offset: 0.74 }, { transform: "none" }],
        { duration: hold, delay: start, easing: "cubic-bezier(.3,.7,.3,1)" },
      ).onfinish = () => { el.style.zIndex = ""; };
      settled = start + hold;
    } else {
      el.animate([{ transform: "none" }, { transform: `translateY(-5%) scale(1.07) rotate(${-dir * 2}deg)`, offset: 0.5 }, { transform: "none" }],
        { duration: turn + 70, delay, easing: "ease-out" });
    }
    window.setTimeout(() => {
      if (!alive.current) return;
      const rect = el.getBoundingClientRect();
      if (fx.current) {
        const c = fx.current.local(rect.left + rect.width / 2, rect.top + rect.height / 2);
        fx.current.reveal(c.x, c.y, rect.width, r);
        if (big) fx.current.dust(c.x, c.y, rect.width, r);
        if (r === "UR") fx.current.ring(c.x, c.y, rect.width);
      }
      if (big) {
        playPackSound(r === "UR" ? "card_ur" : "card_sr", r === "UR" ? 0.7 : 0.65);
        flash(false);
        if (r === "UR") shake();
      }
    }, delay + show);
    // an N / R's whisk sounds as the turn starts, with the tap, not when its face comes round (엘리스 10/13: the sounds
    // came late)
    if (!big) window.setTimeout(() => { if (alive.current) playCardMove(0.7); }, delay);
    if (cards[i].finish !== "basic") premium(i, dir, settled + 160);
  }, [cards, fx, flash, shake, premium, rattleOf]);

  const turnAll = () => {
    let at = 0;
    turnedRef.current.forEach((done, i) => {
      if (done) return;
      flip(i, 1, at);
      at += (high(cards[i].rarity) ? T.allGap.high : T.allGap.low) + rattleOf(i);
    });
  };

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    els.current.forEach((el, i) => el?.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(-110vw)", opacity: 1 }],
      { duration: 360, delay: i * 28, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" }));
    playPackSound("05_cardout", 0.7);   // the game's, as the cards go (heard at each NEXT in its openings)
    window.setTimeout(onNext, 7 * 28 + 360);
  };

  const cardAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card]");
    return el ? Number(el.dataset.card) : -1;
  };
  const down = (e: ReactPointerEvent) => {
    if (!ready) return;
    unlockPackSound();
    drag.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true;
    if (d.moved) {
      if (fx.current) {   // a trail of light under the finger
        const p = fx.current.local(e.clientX, e.clientY);
        fx.current.add({ tex: "star", x: p.x, y: p.y, size: 18, grow: -0.5, life: 0.45, color: "#cfefff", fadeIn: 0.02 });
      }
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
      <div ref={grid} className="po-grid" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
        {cards.map((c, i) => (
          <div key={i} ref={(el) => { els.current[i] = el; }} data-card={i} className="po-card" role="button" tabIndex={0}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { if (turned[i]) onOpen(c); else flip(i, 1); } }}
               aria-label={turned[i] ? `${c.card.name} ${c.rarity}${c.finish !== "basic" ? ` ${FINISH_LABEL[c.finish]}` : ""}` : `${i + 1}번째 카드 넘기기`}>
            <span className="po-inner">
              <span className={`po-back po-back-${marked ? c.rarity.toLowerCase() : "n"}`}>
                {marked && high(c.rarity) && <img src={`${FX}glow_${c.rarity.toLowerCase()}.webp`} alt="" aria-hidden="true" className="po-glow" />}
                <img src={`${FX}back.webp`} alt="" aria-hidden="true" draggable={false} className="po-back-img" />
                {marked && high(c.rarity) && <span className="po-foil" style={{ backgroundImage: `url(${FX}foil_${c.rarity.toLowerCase()}.webp)` }} />}
              </span>
              <span className="po-front">
                <CardFace pulled={c} isNew={fresh.has(c.card.print)} finishOn={finished[i]} params={finishes.get(c.card.print)} />
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="po-bottom">
        {!allTurned ? (
          <>
            <button type="button" onClick={turnAll} disabled={!ready} className="po-cmd">전부 넘긴다</button>
            <span className="po-hint">카드를 쓸어 넘겨도 됩니다</span>
          </>
        ) : (
          <button type="button" onClick={leave} className="po-cmd po-pop">{last ? "OK" : "NEXT"}</button>
        )}
      </div>
    </>
  );
}

/** A card's face; once its finish has come round, the finish itself — the game's shader when the browser can draw it
 *  (in the opening), a light sheen otherwise (the results, where there may be many). */
function CardFace({ pulled, isNew, finishOn = true, params }: { pulled: Pulled<PackCard>; isNew: boolean; finishOn?: boolean; params?: FinishParams }) {
  const { card, rarity, finish } = pulled;
  const showFinish = finishOn && finish !== "basic";
  const shader = showFinish && !!params && finishSupported();
  const plain = <img src={card.thumb} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover card-corner" />;
  return (
    <>
      {shader ? (
        <Suspense fallback={plain}>
          <CardFinishCanvas faceUrl={card.face ?? card.thumb} style={finish as "shine" | "royal"} params={params!} alt="" sharp={2} className="absolute inset-0 w-full h-full card-corner" />
        </Suspense>
      ) : plain}
      {showFinish && !shader && <span className={`po-sheen ${finish === "royal" ? "po-royal" : ""}`} style={finish === "royal" ? { backgroundImage: `url(${FX}rainbow.webp)` } : undefined} />}
      <img src={`/media/md_ui/rarity_${rarity.toLowerCase()}_hd.png`} alt="" className="absolute top-0 right-0 h-[11%] w-auto" />
      {isNew && <img src={`${FX}new.webp`} alt="NEW" className="absolute -top-[4%] -left-[4%] h-[12%] w-auto drop-shadow" />}
      {showFinish && (
        <span className={`absolute bottom-[3%] left-[3%] px-1 rounded text-[9px] sm:text-[11px] font-bold leading-4 ${finish === "royal" ? "bg-fuchsia-600" : "bg-sky-600"}`}>
          {FINISH_LABEL[finish]}
        </span>
      )}
    </>
  );
}

/** 팩 개봉 결과: every card pulled, UR first, a royal or shine one before a plain one, popping in; a tap shows it large. */
function Result({ pack, packs, fresh, finishes, gems, owed, onOpen, onAgain, onClose }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>; finishes: Map<number, FinishParams>; gems: number; owed: boolean;
  onOpen: (c: Pulled<PackCard>) => void; onAgain: (count: 1 | 10) => void; onClose: () => void;
}) {
  const all = useMemo(() => {
    const finishRank = { royal: 2, shine: 1, basic: 0 };
    return packs.flat().map((c, i) => ({ c, i }))
      .sort((a, b) => RANK[b.c.rarity] - RANK[a.c.rarity] || finishRank[b.c.finish] - finishRank[a.c.finish] || a.i - b.i)
      .map((x) => x.c);
  }, [packs]);
  const count = (r: Rarity) => all.filter((c) => c.rarity === r).length;
  // the finishes in the game's shader, as in the opening (엘리스 10/13: the sheen standing in for them looked off); a
  // browser keeps about sixteen such drawings at once, so past twelve the sheen stands in
  const shaded = useMemo(() => new Set(all.filter((c) => c.finish !== "basic").slice(0, MAX_SHADED)), [all]);
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/55 pt-[max(56px,calc(env(safe-area-inset-top)+44px))]">
      <div className="px-4 pb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {(["UR", "SR", "R", "N"] as Rarity[]).map((r) => (
          <span key={r} className="flex items-center gap-1 tabular-nums">
            <img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" />{count(r)}
          </span>
        ))}
        <span className="ml-auto text-white/70 tabular-nums">쓴 <GemIcon /> {(packs.length * GEMS_PER_PACK).toLocaleString()}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-w-4xl mx-auto">
          {all.map((c, i) => (
            <button key={i} type="button" onClick={() => onOpen(c)} className={`po-result relative aspect-[704/1024] ${high(c.rarity) ? `po-result-${c.rarity.toLowerCase()}` : ""}`}
                    style={{ animationDelay: `${Math.min(i, 40) * 22}ms` }}
                    aria-label={`${c.card.name} ${c.rarity}${c.finish !== "basic" ? ` ${FINISH_LABEL[c.finish]}` : ""}`}>
              <CardFace pulled={c} isNew={fresh.has(c.card.print)} params={shaded.has(c) ? finishes.get(c.card.print) : undefined} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-2 px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/60">
        <button type="button" onClick={() => onAgain(1)} disabled={gems < GEMS_PER_PACK} className="po-btn">1팩 <small><GemIcon /> {GEMS_PER_PACK}</small></button>
        <button type="button" onClick={() => onAgain(10)} disabled={gems < GEMS_PER_PACK * 10} className={`po-btn ${owed ? "po-btn-owed" : ""}`}
                title={owed ? "10팩이면 UR 1장 확정" : undefined}>
          10팩 <small><GemIcon /> {(GEMS_PER_PACK * 10).toLocaleString()}</small>{owed && <small className="po-owed">UR 확정</small>}
        </button>
        <button type="button" onClick={onClose} className="po-btn po-plain" aria-label={`${pack.name} 페이지로`}>닫기</button>
      </div>
    </div>
  );
}

const CSS = `
.po-root { --horizon: 60%; background: #0b0816; }
.po-warp { position: absolute; inset: 0; z-index: 46; pointer-events: none; overflow: hidden; animation: po-warp-out .7s ease-out forwards;
  background: radial-gradient(circle at 50% 50%, rgba(220,250,255,1), rgba(80,190,255,.7) 18%, rgba(10,40,140,.6) 55%, rgba(0,0,0,.2)); }
.po-warp-rays { position: absolute; left: 50%; top: 50%; width: 170vmax; height: 170vmax; translate: -50% -50%; animation: po-warp-rays .7s cubic-bezier(.2,.6,.3,1) forwards; }
.po-warp-rays > span { position: absolute; width: calc(50% + 2px); height: calc(50% + 2px); margin: -1px; background-size: 100% 100%; mix-blend-mode: screen; }
@keyframes po-warp-rays { from { transform: scale(.35) rotate(-8deg); } to { transform: scale(1.6) rotate(6deg); } }
@keyframes po-warp-out { 0%, 55% { opacity: 1; } 100% { opacity: 0; } }
@media (orientation: landscape) and (min-aspect-ratio: 4/3) { .po-root { --horizon: 64%; } }
.po-backdrop { position: absolute; inset: 0;
  background:
    radial-gradient(55% 32% at 0% 0%, rgba(120,170,235,.55), transparent 70%),
    radial-gradient(55% 32% at 100% 0%, rgba(120,170,235,.55), transparent 70%),
    radial-gradient(70% 22% at 50% var(--horizon), rgba(170,140,230,.35), transparent 70%),
    linear-gradient(180deg, #111735 0%, #1a1337 28%, #2a1747 calc(var(--horizon) - 6%), #463664 calc(var(--horizon) - .4%),
      #0d0a13 calc(var(--horizon) + .6%), #100a19 74%, #2b1342 100%); }
.po-horizon { position: absolute; left: -10%; right: -10%; top: var(--horizon); height: 3px; translate: 0 -50%; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.85) 18%, #fff 50%, rgba(255,255,255,.85) 82%, transparent);
  box-shadow: 0 0 12px 3px rgba(225,215,255,.8), 0 0 46px 12px rgba(150,125,255,.35); }
.po-count { font-size: 22px; font-weight: 900; letter-spacing: .04em; text-shadow: 0 2px 6px rgba(0,0,0,.6); line-height: 36px; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.po-skip { position: absolute; right: 16px; bottom: max(20px, env(safe-area-inset-bottom)); z-index: 40; height: 32px; padding: 0 20px; border-radius: 6px;
  border: 1.5px solid rgba(255,255,255,.85); background: rgba(0,0,0,.6); font-size: 12px; font-weight: 800; letter-spacing: .08em; }
.po-bottom { position: absolute; left: 0; right: 0; bottom: max(64px, calc(env(safe-area-inset-bottom) + 56px)); z-index: 35; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.po-cmd { min-width: 220px; height: 46px; padding: 0 28px; font-size: 17px; font-weight: 800; letter-spacing: .14em; color: #fff;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.14) 22%, rgba(255,255,255,.14) 78%, transparent);
  border-top: 1px solid rgba(255,255,255,.35); border-bottom: 1px solid rgba(255,255,255,.35); text-shadow: 0 0 10px rgba(160,200,255,.9); }
.po-cmd:disabled { opacity: .45; }
.po-hint { font-size: 12px; color: rgba(255,255,255,.6); }
@media (max-height: 520px) {
  .po-root { --horizon: 56%; }
  .po-bottom { bottom: max(8px, env(safe-area-inset-bottom)); }
  .po-hint { display: none; }
  .po-cmd { height: 38px; font-size: 15px; }
  .po-grid { width: min(94vw, calc((56svh - 70px) * .6875 * 8 + 70px)); grid-template-columns: repeat(8, 1fr); }
  .po-pack { height: min(40svh, 84vw); }
  .po-overview { grid-template-columns: repeat(10, 1fr); width: min(94vw, calc((56svh - 80px) * .488 * 10 + 90px)); }
  .po-skip { bottom: max(8px, env(safe-area-inset-bottom)); }
}
@media (hover: hover) { .po-cmd:hover { background: linear-gradient(90deg, transparent, rgba(255,255,255,.24) 22%, rgba(255,255,255,.24) 78%, transparent); } }

.po-overview { position: absolute; left: 50%; bottom: calc(100% - var(--horizon)); translate: -50% 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
  width: min(calc(100vw - 64px), calc((60svh - 110px) / 2 * .488 * 5 + 40px)); -webkit-box-reflect: below 4px linear-gradient(transparent 60%, rgba(255,255,255,.25)); }
@media (orientation: landscape) and (min-aspect-ratio: 4/3) { .po-overview { grid-template-columns: repeat(10, 1fr); width: min(94vw, calc((64svh - 120px) * .488 * 10 + 90px)); } }
.po-mini { position: relative; aspect-ratio: 250 / 512; animation: po-slide-in .45s cubic-bezier(.2,.8,.3,1) both; }
@keyframes po-slide-in { from { transform: translateX(60vw); opacity: 0; } }
.po-frame-sr { outline: 2px solid #ffd86b; outline-offset: 1px; box-shadow: 0 0 10px 2px rgba(255,205,90,.85), 0 0 26px 6px rgba(255,180,40,.45); }
.po-frame-ur { outline: 2px solid #ff6ad5; outline-offset: 1px; animation-name: po-rainbow-frame; animation-duration: 1.6s; animation-iteration-count: infinite; animation-timing-function: linear; }
@keyframes po-rainbow-frame {
  0% { outline-color: #ff6ad5; box-shadow: 0 0 12px 3px rgba(255,106,213,.85); } 20% { outline-color: #9b7bff; box-shadow: 0 0 12px 3px rgba(155,123,255,.85); }
  40% { outline-color: #57d2ff; box-shadow: 0 0 12px 3px rgba(87,210,255,.85); } 60% { outline-color: #6cff9a; box-shadow: 0 0 12px 3px rgba(108,255,154,.85); }
  80% { outline-color: #ffe25a; box-shadow: 0 0 12px 3px rgba(255,226,90,.85); } 100% { outline-color: #ff6ad5; box-shadow: 0 0 12px 3px rgba(255,106,213,.85); } }
.po-mini.po-frame-ur { animation: po-slide-in .45s cubic-bezier(.2,.8,.3,1) both, po-rainbow-frame 1.6s linear infinite; }
.po-pack.po-frame-ur { animation: po-pack-in .4s cubic-bezier(.2,.8,.3,1) both, po-rainbow-frame 1.6s linear infinite; }
.po-pack-sheen { position: absolute; inset: 0; pointer-events: none; opacity: 0; mix-blend-mode: screen;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,.9) 45%, transparent 60%); background-size: 300% 100%; }
.po-upgrading .po-pack-sheen { animation: po-pack-sheen .5s ease-in-out forwards; }
.po-upgrading .po-part { animation: po-upgrade .8s cubic-bezier(.3,.6,.3,1) forwards; }
@keyframes po-pack-sheen { 0% { opacity: 1; background-position: 120% 0; } 100% { opacity: 1; background-position: -120% 0; } }
@keyframes po-upgrade { 0% { transform: none; } 35% { transform: scale(.85); filter: brightness(1.6); } 55% { transform: scale(1.3); filter: brightness(2.2); } 100% { transform: none; filter: none; } }

.po-pack { position: absolute; left: 50%; bottom: calc(100% - var(--horizon) - .5%); height: min(40svh, 84vw); aspect-ratio: 250 / 512; translate: -50% 0;
  touch-action: none; cursor: pointer; z-index: 10; -webkit-box-reflect: below 2px linear-gradient(transparent 62%, rgba(255,255,255,.28));
  animation: po-pack-in .4s cubic-bezier(.2,.8,.3,1) both; }
@keyframes po-pack-in { from { transform: translateX(70vw); } }
.po-part { position: absolute; inset: 0; display: block; overflow: hidden; }
.po-top { clip-path: inset(0 0 83% 0); }
.po-body { clip-path: inset(17% 0 0 0); }
.po-cutline { position: absolute; left: -4%; right: -4%; top: 17%; height: 4px; margin-top: -2px; transform-origin: left center; border-radius: 4px; pointer-events: none;
  background: linear-gradient(90deg, rgba(255,255,255,.2), #fff 70%); box-shadow: 0 0 10px 3px rgba(190,230,255,.95), 0 0 26px 8px rgba(110,180,255,.6); transition: transform .08s; }
.po-cone { position: absolute; left: -75%; right: -75%; bottom: 82%; height: 130%; opacity: 0; pointer-events: none; transform-origin: 50% 100%;
  clip-path: polygon(41% 100%, 59% 100%, 100% 0, 0 0); background: linear-gradient(to top, rgba(255,255,255,.95), rgba(235,240,255,.45) 45%, transparent 90%); filter: blur(3px); }
.po-mouth { position: absolute; left: 2%; right: 2%; top: 14%; height: 6%; opacity: 0; border-radius: 40%; background: #fff; filter: blur(5px); pointer-events: none; }
.po-cut .po-top, .po-pour .po-top, .po-rise .po-top, .po-leave .po-top { animation: po-top-off .5s cubic-bezier(.3,.6,.4,1) forwards; transform-origin: 85% 17%; }
@keyframes po-top-off { to { transform: translate(18%, -150%) rotate(24deg); opacity: 0; } }
.po-cut .po-cutline, .po-pour .po-cutline, .po-rise .po-cutline, .po-leave .po-cutline { opacity: 0; transition: opacity .2s; }
.po-pour .po-cone, .po-rise .po-cone { opacity: 1; transition: opacity .25s; }
.po-pour .po-mouth, .po-rise .po-mouth { opacity: 1; transition: opacity .2s; }
.po-pack.po-pour, .po-pack.po-rise, .po-pack.po-leave, .po-pack.po-cut { outline-color: transparent !important; box-shadow: none !important; }
.po-leave { opacity: 0; transform: translateY(6%); transition: opacity .3s, transform .3s; }
.po-stream { position: absolute; inset: 0; pointer-events: none; }
/* the pack kicks down and flares white with each card it fires up, springing back, a tenth of a second apart (the game's
   openings at 60 frames a second: some 2% down each time; 엘리스 10/13 "발사하듯 위아래로"): one beat a card, as long
   as T.streamGap */
.po-rise .po-body, .po-rise .po-mouth { animation: po-recoil 95ms cubic-bezier(.2,.7,.3,1) 8; }
@keyframes po-recoil { 0% { transform: translateY(3.2%) scaleY(.982); filter: brightness(1.8) saturate(.5); }
  45% { transform: translateY(-1%) scaleY(1.004); filter: brightness(1.3) saturate(.8); } 80% { transform: translateY(.3%); filter: brightness(1.05); }
  100% { transform: none; filter: none; } }
.po-stream i { position: absolute; left: 22%; top: 20%; width: 56%; aspect-ratio: 0.6875; border-radius: 3px; background: #fff;
  box-shadow: 0 0 10px 3px rgba(255,255,255,.95), 0 0 30px 10px rgba(175,210,255,.6); }
/* 절취선 (엘리스 10/13): where the pack tears, dashes along its top with a light running over them */
.po-perf { position: absolute; left: 4%; right: 4%; top: 17%; height: 3px; margin-top: -1.5px; pointer-events: none; border-radius: 2px;
  background: repeating-linear-gradient(90deg, #fff 0 7px, transparent 7px 12px);
  filter: drop-shadow(0 0 2px rgba(170,215,255,.95)) drop-shadow(0 0 6px rgba(110,170,255,.7));
  animation: po-perf-in .4s .25s both, po-perf-breathe 1.8s .65s ease-in-out infinite; }
.po-perf i { position: absolute; top: -7px; bottom: -7px; left: 0; width: 26%; opacity: 0;
  background: radial-gradient(closest-side, #fff, rgba(190,225,255,.7) 40%, transparent);
  animation: po-perf-run 1.8s .65s ease-in-out infinite; }
@keyframes po-perf-in { from { opacity: 0; clip-path: inset(-10px 100% -10px -10px); } to { opacity: 1; clip-path: inset(-10px -10px -10px -10px); } }
@keyframes po-perf-breathe { 50% { opacity: .72; } }
@keyframes po-perf-run { 0% { transform: translateX(-100%); opacity: 0; } 12% { opacity: 1; } 62% { transform: translateX(385%); opacity: 1; } 70%, 100% { transform: translateX(385%); opacity: 0; } }

.po-floor { position: absolute; left: 0; right: 0; top: var(--horizon); bottom: 0; opacity: 0; pointer-events: none; transition: opacity .35s; }
.po-floor-sr { background: radial-gradient(70% 55% at 50% 0%, rgba(255,205,70,.75), rgba(255,170,30,.25) 50%, transparent 80%); }
.po-floor-ur { background: radial-gradient(70% 55% at 50% 0%, rgba(255,120,220,.7), rgba(150,110,255,.3) 50%, transparent 80%); }
.po-floor.po-on { opacity: 1; }
.po-curtain { position: absolute; inset: 0; z-index: 5; opacity: 0; pointer-events: none; transition: opacity .3s;
  background: linear-gradient(90deg, #0617a0, #1c3cf2 30%, #2848ff 50%, #1c3cf2 70%, #0617a0); }
.po-curtain-sr { background: linear-gradient(90deg, #5a3800, #c98f12 30%, #f1c43a 50%, #c98f12 70%, #5a3800); }
.po-curtain-ur { background: linear-gradient(90deg, #ff2fd0, #8a3cff 14%, #2c6bff 28%, #22d0ff 40%, #27e07a 54%, #f5e33a 68%, #ff8a2a 82%, #ff2fd0);
  background-size: 200% 100%; animation: po-rainbow-shift 1.6s linear infinite; }
@keyframes po-rainbow-shift { to { background-position: 200% 0; } }
.po-curtain.po-on { opacity: 1; }
.po-curtain > span { position: absolute; inset: -10% 0 0 0; background-size: 300px 100svh; background-repeat: repeat; mix-blend-mode: screen; animation: po-streak 1.4s linear infinite; }
.po-curtain > span + span { background-size: 190px 120svh; background-position: 90px 0; opacity: .75; animation-duration: .9s; }
@keyframes po-streak { from { background-position: 0 0; } to { background-position: 0 -100svh; } }
.po-bolt { position: absolute; bottom: calc(100% - var(--horizon)); height: 62svh; width: auto; max-width: none; translate: -50% 0; pointer-events: none; z-index: 6;
  mix-blend-mode: screen; filter: sepia(1) hue-rotate(175deg) saturate(6) brightness(1.25) drop-shadow(0 0 10px #3aa0ff); animation: po-bolt .55s steps(1) forwards; }
.po-bolt-0 { left: 20%; }
.po-bolt-1 { left: 80%; transform: scaleX(-1); }
.po-bolt-2 { left: 10%; height: 70svh; bottom: calc(100% - var(--horizon) - 6%); }
.po-bolt-red { filter: sepia(1) hue-rotate(295deg) saturate(6) brightness(1.2) drop-shadow(0 0 10px #ff3d8b); }
@keyframes po-bolt { 0% { opacity: 1; } 18% { opacity: .35; } 30% { opacity: 1; } 55% { opacity: .8; } 100% { opacity: 0; } }

.po-monster { position: fixed; inset: 0; z-index: 45; overflow: hidden; background: #000; animation: po-monster-bg 2.15s linear forwards; }
@keyframes po-monster-bg { 0%, 14% { background-color: #000; } 15% { background-color: #7a7a84; } 16.5%, 20% { background-color: #fff; }
  42%, 100% { background-color: #3b3848; } 0%, 86% { opacity: 1; } 100% { opacity: 0; } }
/* the lighter side of the grey-violet it sinks to */
.po-mglow { position: absolute; inset: 0; opacity: 0; background: radial-gradient(90% 70% at 22% 40%, rgba(214,212,226,.85), transparent 70%);
  animation: po-mglow 2.15s linear forwards; }
@keyframes po-mglow { 0%, 20% { opacity: 0; } 42%, 100% { opacity: 1; } }
/* the sword-arcs drawn on the black, then given over to Hope's own */
.po-slash { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; animation: po-slash-out 2.15s linear forwards; }
.po-slash path { fill: none; stroke: #fff6a0; stroke-width: 3.4; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1;
  filter: drop-shadow(0 0 6px #ffe14a) drop-shadow(0 0 18px #ffb400); }
.po-slash-a { animation: po-slash-draw 2.15s cubic-bezier(.3,.6,.4,1) forwards; }
.po-slash-b { animation: po-slash-draw-b 2.15s cubic-bezier(.3,.6,.4,1) forwards; }
@keyframes po-slash-draw { 0%, 7% { stroke-dashoffset: 1; } 12.5%, 100% { stroke-dashoffset: 0; } }
@keyframes po-slash-draw-b { 0%, 10% { stroke-dashoffset: 1; } 15%, 100% { stroke-dashoffset: 0; } }
@keyframes po-slash-out { 0%, 22% { opacity: 1; } 32%, 100% { opacity: 0; } }
/* Hope's head (37.5% down its picture, a little left of the middle) a third of the way down, all of it from its horns to
   its legs in view on a phone held upright (엘리스 10/13). Its box is square before the picture comes and the move to its
   head is in the animation itself: Safari worked out a translate in % of the picture before it had come (0) and kept it,
   leaving Hope low and to the right. It comes out of the white burnt bright, its colour returning as the white sinks. */
.po-hope { position: absolute; left: 50%; top: 33%; width: min(max(105vw, 88svh), 200svh); aspect-ratio: 1; height: auto; max-width: none;
  transform-origin: 47% 37.5%; opacity: 0; animation: po-hope 2.15s cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes po-hope {
  0%, 17% { opacity: 0; transform: translate(-47%, -37.5%) scale(1.16); filter: brightness(3.4) saturate(.4); }
  19% { opacity: 1; }
  42% { transform: translate(-47%, -37.5%) scale(1.06); filter: brightness(1) saturate(1); }
  74% { opacity: 1; transform: translate(-47%, -37.5%) scale(1.03); filter: brightness(1) saturate(1); }
  84%, 100% { opacity: 1; transform: translate(-47%, -37.5%) scale(1.02); filter: brightness(2.6) saturate(.5); } }
/* the golden flare that bursts under it as it comes */
.po-mflare { position: absolute; left: 50%; top: 58%; width: min(120vw, 90svh); max-width: none; aspect-ratio: 1; mix-blend-mode: screen; opacity: 0;
  translate: -50% -50%; animation: po-mflare 2.15s ease-out forwards; }
@keyframes po-mflare { 0%, 17% { opacity: 0; transform: scale(.4); } 20% { opacity: 1; transform: scale(1.2); } 36%, 100% { opacity: 0; transform: scale(2); } }
/* jagged yellow lightning crackling across while it is held */
.po-zaps { position: absolute; inset: 0; opacity: 0; mix-blend-mode: screen; animation: po-zaps 2.15s linear forwards; }
@keyframes po-zaps { 0%, 19% { opacity: 0; } 22%, 72% { opacity: 1; } 77%, 100% { opacity: 0; } }
.po-zaps i { position: absolute; left: -15%; width: 130%; height: 4.6svh; background-size: 100% 100%; background-repeat: no-repeat;
  filter: sepia(1) saturate(9) hue-rotate(8deg) brightness(1.6) drop-shadow(0 0 5px #ffd21e);
  animation: po-zap .14s steps(1) infinite; }
@keyframes po-zap { 0% { opacity: 1; transform: scaleY(1); } 33% { opacity: .35; transform: scaleY(-1.2); } 66% { opacity: .85; transform: scaleX(-1); } }
/* and it burns out white, the pack behind as the white goes */
.po-whiteout { position: absolute; inset: 0; background: #fff; opacity: 0; animation: po-whiteout 2.15s ease-in forwards; }
@keyframes po-whiteout { 0%, 72% { opacity: 0; } 83%, 100% { opacity: 1; } }

.po-grid { position: absolute; left: 50%; bottom: calc(100% - var(--horizon) - .5%); translate: -50% 0; z-index: 10; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  width: min(calc(100vw - 64px), calc((60svh - 110px) / 2 * .6875 * 4 + 30px)); perspective: 1100px; touch-action: none;
  -webkit-box-reflect: below 4px linear-gradient(transparent 58%, rgba(255,255,255,.22)); }
@media (orientation: landscape) and (min-aspect-ratio: 4/3) { .po-grid { grid-template-columns: repeat(8, 1fr); width: min(94vw, calc((64svh - 130px) * .6875 * 8 + 70px)); } }
.po-card { position: relative; aspect-ratio: 704 / 1024; cursor: pointer; will-change: transform; }
.po-inner { position: absolute; inset: 0; display: block; transform-style: preserve-3d; }
.po-back, .po-front { position: absolute; inset: 0; display: block; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.po-front { transform: rotateY(180deg); }
.po-back-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; border-radius: 4%; }
.po-back-sr .po-back-img { filter: sepia(.6) saturate(2.6) hue-rotate(-8deg) brightness(1.55) contrast(1.05); }
.po-back-ur .po-back-img { filter: sepia(1) hue-rotate(205deg) saturate(3.2) brightness(1.35); }
.po-back-sr { box-shadow: 0 0 0 1.5px #ffe27a, 0 0 12px 3px rgba(255,200,70,.85); border-radius: 4%; }
.po-back-ur { box-shadow: 0 0 0 1.5px #fff, 0 0 14px 4px rgba(170,190,255,.9), 0 0 28px 8px rgba(200,120,255,.45); border-radius: 4%; }
.po-glow { position: absolute; inset: -10% -13%; width: 126%; height: 120%; max-width: none; mix-blend-mode: screen; animation: po-glow 1s ease-in-out infinite alternate; }
@keyframes po-glow { from { opacity: .45; } to { opacity: .9; } }
.po-foil { position: absolute; inset: 0; border-radius: 4%; background-size: 220% 220%; mix-blend-mode: screen; opacity: .5; animation: po-foil 4s linear infinite; }
@keyframes po-foil { to { background-position: 220% 110%; } }
.po-sheen { position: absolute; inset: 0; border-radius: 4.5%; pointer-events: none; background-image: linear-gradient(115deg, transparent 32%, rgba(255,255,255,.6) 46%, transparent 60%); background-size: 260% 100%; mix-blend-mode: overlay; animation: po-sheen 2.4s ease-in-out infinite; }
.po-royal { background-size: 100% 300%; mix-blend-mode: soft-light; opacity: .85; animation: po-royal 3s linear infinite; }
@keyframes po-sheen { from { background-position: 130% 0; } to { background-position: -130% 0; } }
@keyframes po-royal { to { background-position: 0 300%; } }

.po-flash { position: absolute; inset: 0; z-index: 48; pointer-events: none; background: radial-gradient(circle at 50% 45%, rgba(255,255,255,.6), rgba(255,255,255,.1) 60%, transparent); animation: po-fade .4s ease-out forwards; }
.po-flash-white { position: absolute; inset: 0; z-index: 48; pointer-events: none; background: #fff; animation: po-fade .38s cubic-bezier(.2,.6,.4,1) forwards; }
@keyframes po-fade { from { opacity: 1; } to { opacity: 0; } }

.po-result { animation: po-pop .34s cubic-bezier(.2,.8,.3,1.3) both; }
.po-result-ur { filter: drop-shadow(0 0 6px rgba(255,255,255,.55)); }
.po-result-sr { filter: drop-shadow(0 0 5px rgba(255,200,80,.55)); }
@keyframes po-pop { from { transform: scale(.6); opacity: 0; } }
.po-pop { animation: po-pop .3s cubic-bezier(.2,.8,.3,1.4) both; }
.po-btn { height: 44px; padding: 0 16px; border-radius: 9999px; font-size: 14px; font-weight: 800; color: #fff;
  background: linear-gradient(180deg, #4f8ff7, #1d4ed8); box-shadow: 0 0 0 1px rgba(255,255,255,.3) inset; }
.po-btn small { font-weight: 600; opacity: .8; margin-left: 4px; }
.po-plain { background: rgba(255,255,255,.12); box-shadow: none; }
/* the next ten owe a UR (ten without one before): the game's button turns bright (엘리스 10/13) */
.po-btn-owed { background: linear-gradient(90deg, #e879f9, #a855f7 55%, #7c3aed); box-shadow: 0 0 0 1px rgba(255,255,255,.5) inset, 0 0 14px rgba(232,121,249,.65); }
.po-owed { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 9999px; background: rgba(255,255,255,.25); opacity: 1 !important; }
.po-btn:disabled { opacity: .4; }
}
`;
