import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { PackCard, PackDetail } from "@/api/packApi";
import { getCard } from "@/api/cardDexApi";
import CardZoom from "@/components/CardZoom";
import { type FinishParams, finishSupported } from "@/lib/cardFinish";
import { lazyChunk } from "@/lib/lazyChunk";
import { FxLayer } from "@/lib/packFx";
import { playCardMove, playPackSound, setSoundOn, soundOn, unlockPackSound } from "@/lib/packSound";
import { type Pulled, type Rarity, GEMS_PER_PACK } from "@/utils/packDraw";

const FX = "/media/md_ui/packopen/";
const CardFinishCanvas = lazyChunk(() => import("@/components/CardFinishCanvas"));
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, UR: 3 };
const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const high = (r: Rarity) => r === "SR" || r === "UR";
const best = (cards: Pulled<PackCard>[]) => cards.reduce<Rarity>((b, c) => (RANK[c.rarity] > RANK[b] ? c.rarity : b), "N");

/** What a pack shows before it opens: its tier (a gold pack for an SR, a rainbow one for a UR, as the game's pack turns
 *  into its gold or rainbow version), lightning (one to three strikes) and the Hope cut-in. The game's own rule for these
 *  is not known (its server decides): lightning often for an SR or better and now and then without, Hope only for a UR,
 *  one time in two, so it never lies (엘리스 10/13). */
type Tier = "N" | "SR" | "UR";
type Hints = { tier: Tier; strikes: number; monster: boolean };
const hintsFor = (cards: Pulled<PackCard>[]): Hints => {
  const top = best(cards);
  const tier: Tier = top === "UR" ? "UR" : top === "SR" ? "SR" : "N";
  const lit = Math.random() < (tier !== "N" ? 0.6 : 0.12);
  return { tier, strikes: lit ? 1 + Math.floor(Math.random() * 3) : 0, monster: tier === "UR" && Math.random() < 0.5 };
};
const frameOf = (tier: Tier) => (tier === "UR" ? "po-frame-ur" : tier === "SR" ? "po-frame-sr" : "");

type Stage = "overview" | "pack" | "cards" | "result";
type Zoom = { card: Pulled<PackCard>; params: FinishParams | null };
type Fx = MutableRefObject<FxLayer | null>;

/** The game's pack opening, rebuilt from its own pictures, sounds and effect data and from watching it (엘리스 10/12–13:
 *  "진짜 마듀처럼"): a blue burst to begin; a dark stage with a lit horizon the packs and cards stand and mirror on; ten
 *  packs laid out first (gold those with an SR, rainbow those with a UR); each pack comes on, lightning may strike, a
 *  single pack may turn into its gold or rainbow pack, Hope may cut in for a UR; a tap or a stroke across its top cuts it
 *  in a white flash, light pours up through a blue, gold or rainbow curtain and the cards fly in onto the floor, a glint
 *  running along them; a tap or a finger drawn across turns them — N and R whisk over, SR and UR leap up in light and
 *  dust (a UR twisting the wrong way first, a ring spreading), and a shine or royal card turns once more into its finish
 *  in the game's shader. Then the cards slide off, the next pack comes, and the 팩 개봉 결과. */
export default function PackOpening({ pack, packs, fresh, onClose, onAgain }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>;
  onClose: () => void; onAgain: (count: 1 | 10) => void;
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
  const [warp, setWarp] = useState(!reduced());
  const [finishes, setFinishes] = useState<Map<number, FinishParams>>(() => new Map());
  const total = packs.length;

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
    for (const c of packs.flat()) new Image().src = c.card.thumb;   // a card shows the moment it turns
    return () => {
      gone = true;
      front.destroy();
      back.destroy();
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = prev;
    };
  }, [packs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoom]);

  const flashNow = useCallback((white: boolean) => setFlash({ id: Date.now() + Math.random(), white }), []);
  const shake = useCallback(() => {
    if (!shaker.current || reduced()) return;
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

        {stage === "overview" && <Overview packs={packs} hints={hints} pack={pack} onOpen={() => { unlockPackSound(); setStage("pack"); }} />}
        {stage === "pack" && (
          <PackScene key={index} pack={pack} hints={hints[index]} framed={total > 1} fx={fx} flash={flashNow} onOpened={() => setStage("cards")} />
        )}
        {stage === "cards" && (
          <Cards key={index} cards={packs[index]} fresh={fresh} finishes={finishes} fx={fx} flash={flashNow} shake={shake} onOpen={open}
                 last={index + 1 >= total} onNext={next} />
        )}
        {stage === "result" && <Result pack={pack} packs={packs} fresh={fresh} onOpen={open} onAgain={onAgain} onClose={onClose} />}

        <div className="absolute left-0 right-0 top-0 z-40 flex items-start justify-between px-4 pt-[max(12px,env(safe-area-inset-top))]">
          <span className="po-count">{stage === "result" ? "팩 개봉 결과" : stage === "overview" ? pack.name : `${index + 1}/${total}`}</span>
          <span className="flex items-center gap-2">
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
  useEffect(() => {
    playPackSound("02_packout", 0.8);
  }, []);
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

/** One pack: it comes on, the signs of what it holds play, and a tap or a stroke across its top opens it. */
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
  const [monster, setMonster] = useState<"waiting" | "showing" | "done">(hints.monster ? "waiting" : "done");
  const [phase, setPhase] = useState<"stand" | "cut" | "pour" | "rise" | "leave">("stand");
  const [line, setLine] = useState(0);
  const wantCut = useRef(false);
  const timers = useRef<number[]>([]);
  const drag = useRef<{ x: number; max: number } | null>(null);
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, reduced() ? Math.min(ms, 30) : ms));

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // the strikes land left, right, then lower left of the pack, a sixth of a second apart
  const SPOTS = [0.2, 0.8, 0.1];
  const strike = (k: number) => {
    setBolts((b) => [...b, k]);
    playPackSound((["kaminari_01", "kaminari_02", "kaminari_03"] as const)[k], 0.7);
    const r = root.current?.getBoundingClientRect();
    const p = box.current?.getBoundingClientRect();
    if (r && p && fx.current) {
      const foot = fx.current.local(r.left + r.width * SPOTS[k], p.bottom + (k === 2 ? p.height * 0.08 : 0));
      fx.current.strike(foot.x, foot.y, p.width * 0.35);
    }
  };

  useEffect(() => {
    playPackSound("01_op", 0.7);
    let t = 420;
    for (let k = 0; k < hints.strikes; k++) at(t + k * 167, () => strike(k));
    if (hints.strikes) t += hints.strikes * 167 + 300;
    if (hints.tier !== "N") {
      if (framed) at(t, () => { setFloor(true); playPackSound("proc_rare", 0.8); });
      else {
        // the upgrade: a sheen runs over it, it draws in and springs out as its gold or rainbow pack
        at(t, () => { setUpgrading(true); playPackSound("proc_rare", 0.8); });
        at(t + 330, () => { setTier(hints.tier); setFloor(true); flash(false); });
        at(t + 800, () => setUpgrading(false));
      }
      t += 850;
    }
    if (hints.monster) at(t, () => setMonster("showing"));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const cut = () => {
    if (phase !== "stand") return;
    unlockPackSound();
    if (monster !== "done") {   // Hope has its moment first
      wantCut.current = true;
      if (monster === "waiting") setMonster("showing");
      return;
    }
    setTier(hints.tier);
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
    at(780, () => { setPhase("rise"); playPackSound("05_cardout", 0.7); });
    at(1380, () => setPhase("leave"));
    at(1700, onOpened);
  };

  const monsterDone = () => {
    setMonster("done");
    if (wantCut.current) window.setTimeout(() => { wantCut.current = false; cutRef.current(); }, 120);
  };
  const cutRef = useRef(cut);
  cutRef.current = cut;

  const down = (e: ReactPointerEvent) => {
    unlockPackSound();
    drag.current = { x: e.clientX, max: 0 };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    const p = box.current?.getBoundingClientRect();
    if (!d || !p || phase !== "stand") return;
    const span = Math.abs(e.clientX - d.x) / p.width;
    d.max = Math.max(d.max, span);
    setLine(Math.min(1, span));
    if (span > 0.55) {
      drag.current = null;
      cut();
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || phase !== "stand") return;
    if (d.max < 0.08) cut();
    else setLine(0);
  };

  const poured = phase === "pour" || phase === "rise" || phase === "leave";
  return (
    <div ref={root} className="absolute inset-0">
      <div className={`po-floor po-floor-${hints.tier.toLowerCase()} ${floor ? "po-on" : ""}`} aria-hidden="true" />
      <div className={`po-curtain po-curtain-${hints.tier.toLowerCase()} ${poured && phase !== "leave" ? "po-on" : ""}`} aria-hidden="true">
        <span style={{ backgroundImage: `url(${FX}streaks.webp)` }} />
        <span style={{ backgroundImage: `url(${FX}streaks.webp)` }} />
      </div>
      {bolts.map((k) => (
        <img key={k} src={`${FX}thunder.webp`} alt="" aria-hidden="true" className={`po-bolt po-bolt-${k}`} />
      ))}

      <div ref={box} className={`po-pack ${frameOf(tier)} ${upgrading ? "po-upgrading" : ""} po-${phase}`}
           onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
           role="button" tabIndex={0} aria-label={`${pack.name} 팩 열기`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && cut()}>
        <span className="po-cone" aria-hidden="true" />
        <span className="po-part po-body"><PackPicture pack={pack} /></span>
        <span className="po-part po-top"><PackPicture pack={pack} /></span>
        <span className="po-pack-sheen" aria-hidden="true" />
        <span className="po-mouth" aria-hidden="true" />
        <span className="po-cutline" style={{ transform: `scaleX(${line})` }} aria-hidden="true" />
        {phase === "rise" && <span className="po-bundle" aria-hidden="true" />}
      </div>

      <div className="po-bottom">
        {phase === "stand" && (
          <>
            <button type="button" onClick={cut} className="po-cmd">OPEN</button>
            <span className="po-hint">팩 윗부분을 옆으로 그어도 열립니다</span>
          </>
        )}
      </div>
      {monster === "showing" && <Monster onDone={monsterDone} flash={flash} />}
    </div>
  );
}

/** The monster bursting across the screen in yellow lightning — the game's sign of a pack with a UR. */
function Monster({ onDone, flash }: { onDone: () => void; flash: (white: boolean) => void }) {
  useEffect(() => {
    playPackSound("hope", 0.75);
    window.setTimeout(() => playPackSound("kaminari_03", 0.6), 120);
    const a = window.setTimeout(() => flash(true), 150);
    const b = window.setTimeout(() => flash(true), 1750);
    const c = window.setTimeout(onDone, reduced() ? 400 : 1950);
    return () => [a, b, c].forEach(clearTimeout);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="po-monster" aria-hidden="true">
      <img src={`${FX}monster.webp`} alt="" />
    </div>
  );
}

/** The eight cards: they fly in from the corner onto the floor, a glint runs along them, then they turn — a tap, or a
 *  finger drawn across them turning each it passes, in the way it moves. */
function Cards({ cards, fresh, finishes, fx, flash, shake, onOpen, last, onNext }: {
  cards: Pulled<PackCard>[]; fresh: Set<number>; finishes: Map<number, FinishParams>; fx: Fx; flash: (white: boolean) => void; shake: () => void;
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

  // in from the lower left, one after another, lit as they fly; then a glint along each row
  useLayoutEffect(() => {
    const quick = reduced();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    playPackSound("04_cardin", 0.8);
    els.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = -vw * 0.15 - (r.left + r.width / 2) + i * 18;
      const dy = vh * 1.05 - (r.top + r.height / 2);
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) rotate(-28deg) scale(.85)`, filter: "brightness(2.6)" },
         { filter: "brightness(1.6)", offset: 0.75 },
         { transform: "none", filter: "brightness(1)" }],
        { duration: quick ? 1 : 380, delay: quick ? 0 : 45 * i, easing: "cubic-bezier(.15,.75,.3,1)", fill: "backwards" },
      );
    });
    const landed = quick ? 0 : 45 * 7 + 380;
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
        if (el && high(cards[i].rarity) && fx.current && !quick) {
          fx.current.twinkleOn(() => (alive.current ? el.getBoundingClientRect() : null), cards[i].rarity, () => !alive.current || turnedRef.current[i]);
        }
      });
    }, landed + 300);
    return () => [t1, t2].forEach(clearTimeout);
  }, [cards, fx]);

  /** A shine or royal card, once face up, turns once more and comes round in its finish, in a burst of light (the
   *  game's "premium" turn, seen in its own openings). */
  const premium = useCallback((i: number, dir: 1 | -1, delay: number) => {
    const el = els.current[i];
    const inner = el?.querySelector<HTMLElement>(".po-inner");
    if (!el || !inner) return;
    const royal = cards[i].finish === "royal";
    if (reduced()) {
      window.setTimeout(() => alive.current && setFinished((f) => f.map((v, j) => v || j === i)), delay);
      return;
    }
    window.setTimeout(() => { if (alive.current) el.style.zIndex = "20"; }, delay);
    el.animate([{ transform: "none" }, { transform: "translateY(-8%) scale(1.22)", offset: 0.4 }, { transform: "translateY(-8%) scale(1.22)", offset: 0.8 }, { transform: "none" }],
      { duration: 900, delay, easing: "cubic-bezier(.3,.7,.3,1)" }).onfinish = () => { el.style.zIndex = ""; };
    const a = inner.animate([{ transform: `rotateY(${dir * 180}deg)` }, { transform: `rotateY(${dir * 540}deg)` }],
      { duration: 560, delay: delay + 80, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
    a.onfinish = () => { inner.style.transform = `rotateY(${dir * 540}deg)`; };
    window.setTimeout(() => { if (alive.current) { setFinished((f) => f.map((v, j) => v || j === i)); playCardMove(0.6); } }, delay + 80 + 260);
    window.setTimeout(() => {
      if (!alive.current) return;
      const rect = el.getBoundingClientRect();
      if (fx.current) {
        const c = fx.current.local(rect.left + rect.width / 2, rect.top + rect.height / 2);
        fx.current.premium(c.x, c.y, rect.width, royal);
      }
      playPackSound(royal ? "upgrad_01_ur" : "upgrad_01", royal ? 0.6 : 0.7);
      flash(false);
    }, delay + 80 + 560);
  }, [cards, fx, flash]);

  const flip = useCallback((i: number, dir: 1 | -1, delay = 0) => {
    if (turnedRef.current[i]) return;
    turnedRef.current[i] = true;
    setTurned([...turnedRef.current]);
    const el = els.current[i];
    const inner = el?.querySelector<HTMLElement>(".po-inner");
    if (!el || !inner) return;
    const r = cards[i].rarity;
    const big = high(r);
    const quick = reduced();
    const ur = r === "UR" && !quick;
    // a UR first twists the wrong way, then whips round
    const turn = quick ? 1 : ur ? 520 : big ? 260 : 200;
    const a = inner.animate(ur
      ? [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${-dir * 38}deg)`, offset: 0.38 }, { transform: `rotateY(${dir * 180}deg)` }]
      : [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${dir * 180}deg)` }],
      { duration: turn, delay, easing: ur ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
    a.onfinish = () => { inner.style.transform = `rotateY(${dir * 180}deg)`; };
    const show = big ? (ur ? turn * 0.72 : 150) : turn * 0.45;   // when the face comes round
    let settled = delay + turn + 70;
    if (big && !quick) {
      // the leap: up and large, held a moment in its light, then back to its place
      const scale = r === "UR" ? 1.75 : 1.5;
      const hold = r === "UR" ? 1500 : 1100;
      const start = delay + (ur ? turn * 0.45 : 0);
      window.setTimeout(() => { if (alive.current) el.style.zIndex = "20"; }, start);
      el.animate(
        [{ transform: "none" }, { transform: `translateY(-28%) scale(${scale})`, offset: 0.2 },
         { transform: `translateY(-29%) scale(${scale * 1.02})`, offset: 0.74 }, { transform: "none" }],
        { duration: hold, delay: start, easing: "cubic-bezier(.3,.7,.3,1)" },
      ).onfinish = () => { el.style.zIndex = ""; };
      settled = start + hold;
    } else if (!quick) {
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
      } else playCardMove(0.7);
    }, delay + show);
    if (cards[i].finish !== "basic") premium(i, dir, settled + 160);
  }, [cards, fx, flash, shake, premium]);

  const turnAll = () => {
    let at = 0;
    turnedRef.current.forEach((done, i) => {
      if (done) return;
      flip(i, 1, at);
      at += high(cards[i].rarity) ? 420 : 110;
    });
  };

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    const quick = reduced();
    els.current.forEach((el, i) => el?.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(-110vw)", opacity: 1 }],
      { duration: quick ? 1 : 360, delay: quick ? 0 : i * 28, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" }));
    playCardMove(0.5);
    window.setTimeout(onNext, quick ? 0 : 7 * 28 + 360);
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
              <span className={`po-back po-back-${c.rarity.toLowerCase()}`}>
                {high(c.rarity) && <img src={`${FX}glow_${c.rarity.toLowerCase()}.webp`} alt="" aria-hidden="true" className="po-glow" />}
                <img src={`${FX}back.webp`} alt="" aria-hidden="true" draggable={false} className="po-back-img" />
                {high(c.rarity) && <span className="po-foil" style={{ backgroundImage: `url(${FX}foil_${c.rarity.toLowerCase()}.webp)` }} />}
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
          <CardFinishCanvas faceUrl={card.face ?? card.thumb} style={finish as "shine" | "royal"} params={params!} alt="" className="absolute inset-0 w-full h-full card-corner" />
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
    <div className="absolute inset-0 z-30 flex flex-col bg-black/55 pt-[max(56px,calc(env(safe-area-inset-top)+44px))]">
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
        <button type="button" onClick={() => onAgain(1)} className="po-btn">1팩 <small>{GEMS_PER_PACK}젬</small></button>
        <button type="button" onClick={() => onAgain(10)} className="po-btn">10팩 <small>{(GEMS_PER_PACK * 10).toLocaleString()}젬</small></button>
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
@media (hover: hover) { .po-cmd:hover { background: linear-gradient(90deg, transparent, rgba(255,255,255,.24) 22%, rgba(255,255,255,.24) 78%, transparent); } }

.po-overview { position: absolute; left: 50%; bottom: calc(100% - var(--horizon)); translate: -50% 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
  width: min(92vw, calc((var(--horizon) - 0%) * 0 + (60svh - 110px) / 2 * .488 * 5 + 40px)); -webkit-box-reflect: below 4px linear-gradient(transparent 60%, rgba(255,255,255,.25)); }
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
.po-bundle { position: absolute; left: 14%; right: 14%; top: 4%; aspect-ratio: 704 / 1024; border-radius: 6px; background: #fff; pointer-events: none;
  box-shadow: 0 0 24px 10px rgba(255,255,255,.85), 0 0 60px 20px rgba(170,200,255,.5); animation: po-bundle .6s cubic-bezier(.5,0,.7,.4) forwards; }
@keyframes po-bundle { from { transform: translateY(10%); opacity: 0; } 25% { opacity: 1; } to { transform: translateY(-190%); opacity: .9; } }

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
@keyframes po-bolt { 0% { opacity: 1; } 18% { opacity: .35; } 30% { opacity: 1; } 55% { opacity: .8; } 100% { opacity: 0; } }

.po-monster { position: fixed; inset: 0; z-index: 45; overflow: hidden; background: radial-gradient(circle at 50% 45%, #dcdce4, #8b8b98 60%, #4a4a56);
  animation: po-monster-bg 1.95s linear forwards; }
.po-monster img { position: absolute; left: 50%; top: 50%; width: max(150vw, 150svh); max-width: none; translate: -50% -50%; animation: po-monster 1.95s cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes po-monster { 0% { transform: scale(1.5) translateX(14%); opacity: 0; } 8% { opacity: 1; } 70% { transform: scale(1.08) translateX(0); } 100% { transform: scale(1.03) translateX(-2%); opacity: 1; } }
@keyframes po-monster-bg { 0% { background: #000; } 6% { background: #000; } 9% { background: radial-gradient(circle at 50% 45%, #dcdce4, #8b8b98 60%, #4a4a56); } 92% { opacity: 1; } 100% { opacity: 0; } }

.po-grid { position: absolute; left: 50%; bottom: calc(100% - var(--horizon) - .5%); translate: -50% 0; z-index: 10; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  width: min(92vw, calc((60svh - 110px) / 2 * .6875 * 4 + 30px)); perspective: 1100px; touch-action: none;
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
@media (prefers-reduced-motion: reduce) {
  .po-warp, .po-warp-rays, .po-mini, .po-pack, .po-curtain > span, .po-bolt, .po-glow, .po-foil, .po-sheen, .po-royal, .po-result, .po-bundle, .po-monster, .po-monster img { animation: none; }
}
`;
