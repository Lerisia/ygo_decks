import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PackCard, PackDetail } from "@/api/packApi";
import { getCard } from "@/api/cardDexApi";
import CardZoom from "@/components/CardZoom";
import type { FinishParams } from "@/lib/cardFinish";
import { playPackSound, setSoundOn, soundOn, unlockPackSound } from "@/lib/packSound";
import { type Pulled, type Rarity, GEMS_PER_PACK } from "@/utils/packDraw";

const FX = "/media/md_ui/packopen/";
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, UR: 3 };
const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Stage = "pack" | "tearing" | "cards" | "result";
type Zoom = { card: Pulled<PackCard>; params: FinishParams | null };

const best = (cards: Pulled<PackCard>[]) => cards.reduce<Rarity>((b, c) => (RANK[c.rarity] > RANK[b] ? c.rarity : b), "N");
const high = (r: Rarity) => r === "SR" || r === "UR";

/** The game's pack opening, drawn again from its own pictures and sounds (엘리스 2026-10-12): the pack on the blue rays
 *  with a floor light in its best card's colour, a tap tears its top off, its eight cards come out face down (an SR
 *  glows gold, a UR rainbow), a tap turns one, 전부 넘긴다 turns all; then the next pack, and the 팩 개봉 결과. */
export default function PackOpening({ pack, packs, fresh, onClose, onAgain }: {
  pack: PackDetail; packs: Pulled<PackCard>[][]; fresh: Set<number>;
  onClose: () => void; onAgain: (count: 1 | 10) => void;
}) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("pack");
  const [turned, setTurned] = useState<boolean[]>(() => Array(8).fill(false));
  const [sound, setSound] = useState(soundOn);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const cards = packs[index];
  const flare = best(cards);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    playPackSound("01_op", 0.6);
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const toResult = useCallback(() => setStage("result"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoom]);

  const tear = () => {
    if (stage !== "pack") return;
    unlockPackSound();
    playPackSound("03_cut");
    setStage("tearing");
    const wait = reduced() ? 50 : 750;
    window.setTimeout(() => {
      playPackSound("05_cardout", 0.7);
      setStage("cards");
    }, wait);
  };

  const turn = (i: number) => {
    if (turned[i]) return;
    const r = cards[i].rarity;
    playPackSound(r === "UR" ? "card_ur" : r === "SR" ? "card_sr" : "card_move_01", r === "N" || r === "R" ? 0.5 : 0.8);
    setTurned((t) => t.map((v, j) => v || j === i));
  };

  const turnAll = () => {
    const left = cards.filter((_, i) => !turned[i]);
    const top = best(left);
    playPackSound(top === "UR" ? "card_ur" : top === "SR" ? "card_sr" : "card_move_01", top === "N" || top === "R" ? 0.5 : 0.8);
    setTurned(Array(8).fill(true));
  };

  const next = () => {
    if (index + 1 >= packs.length) return toResult();
    setIndex(index + 1);
    setTurned(Array(8).fill(false));
    setStage("pack");
    playPackSound("01_op", 0.6);
  };

  const open = async (card: Pulled<PackCard>) => {
    setZoom({ card, params: null });
    if (card.finish === "basic") return;
    try {
      const doc = await getCard(card.card.card);
      const face = doc.faces.find((f) => f.id === card.card.print);
      setZoom((z) => z && z.card === card ? {
        card, params: { ...doc.finish, frame: face?.overframe ? "overframe" : doc.finish.frame, name: face?.name_mask ?? null },
      } : z);
    } catch {
      /* the plain face then */
    }
  };

  const allTurned = turned.every(Boolean);
  const total = packs.length;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white select-none" role="dialog" aria-modal="true" aria-label={`${pack.name} 개봉`}>
      <style>{CSS}</style>
      <Rays flash={stage === "tearing" || (stage === "cards" && high(flare))} />

      <div className="relative z-10 flex items-center justify-between gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 text-sm">
        <span className="font-semibold tabular-nums">{stage === "result" ? "팩 개봉 결과" : total > 1 ? `${index + 1} / ${total}` : pack.name}</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSoundOn(!sound);
              setSound(!sound);
            }}
            aria-label={sound ? "소리 끄기" : "소리 켜기"}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20"
          >
            {sound ? "🔊" : "🔇"}
          </button>
          {stage !== "result" && total > 1 && (
            <button type="button" onClick={toResult} className="px-3 h-9 rounded-full bg-white/10 hover:bg-white/20 font-bold tracking-wide">SKIP</button>
          )}
          <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20">✕</button>
        </span>
      </div>

      {stage === "result" ? (
        <Result pack={pack} packs={packs} fresh={fresh} onOpen={open} onAgain={onAgain} onClose={onClose} />
      ) : (
        <>
          <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-4">
            {stage !== "cards" ? (
              <PackFrontTear key={index} pack={pack} flare={flare} tearing={stage === "tearing"} onTear={tear} />
            ) : (
              <div className="po-grid" style={{ "--n": 4 } as CSSProperties}>
                {cards.map((c, i) => (
                  <FaceDown key={`${index}-${i}`} pulled={c} turned={turned[i]} order={i} isNew={fresh.has(c.card.print)}
                            onTurn={() => (turned[i] ? open(c) : turn(i))} />
                ))}
              </div>
            )}
          </div>
          <div className="relative z-10 flex justify-center gap-3 px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] min-h-[76px]">
            {stage === "pack" && (
              <button type="button" onClick={tear} className="po-button">OPEN</button>
            )}
            {stage === "cards" && !allTurned && (
              <button type="button" onClick={turnAll} className="po-button">전부 넘긴다</button>
            )}
            {stage === "cards" && allTurned && (
              <button type="button" onClick={next} className="po-button">{index + 1 < total ? "NEXT" : "OK"}</button>
            )}
          </div>
        </>
      )}

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

/** The blue rays behind it all, the game's quarter picture turned four ways, slowly turning; brighter as a pack tears
 *  and when an SR or UR is among the cards. */
function Rays({ flash }: { flash: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="po-rays">
        {[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y], i) => (
          <span key={i} style={{ backgroundImage: `url(${FX}rays.webp)`, transform: `scale(${x}, ${y})`,
                                  left: x > 0 ? 0 : "50%", top: y > 0 ? 0 : "50%" }} />
        ))}
      </div>
      <div className={`absolute inset-0 transition-opacity duration-500 ${flash ? "opacity-100" : "opacity-0"}`}
           style={{ background: "radial-gradient(circle at 50% 50%, rgba(160,200,255,.35), transparent 60%)" }} />
    </div>
  );
}

/** The pack, its floor light, and on a tap its top strip (the top 17%, where the game's pack splits) torn away. */
function PackFrontTear({ pack, flare, tearing, onTear }: { pack: PackDetail; flare: Rarity; tearing: boolean; onTear: () => void }) {
  const src = pack.image_hd ?? pack.image;
  const face = (part: "top" | "body") => src ? (
    <img src={src} alt="" draggable={false} className={`po-${part} absolute inset-0 w-full h-full object-cover`} />
  ) : (
    <div className={`po-${part} absolute inset-0 bg-gradient-to-b from-amber-200 via-amber-500 to-amber-800 flex items-center justify-center p-3`}>
      <span className="text-center font-extrabold break-keep">{pack.name}</span>
    </div>
  );
  return (
    <button type="button" onClick={onTear} aria-label={`${pack.name} 팩 열기`} className={`po-pack ${tearing ? "po-tearing" : ""}`}>
      <img src={`${FX}flare_${flare === "UR" ? "ur" : flare === "SR" ? "sr" : "n"}.webp`} alt="" aria-hidden="true" className="po-flare" />
      <span className="po-pack-box">
        {face("body")}
        {face("top")}
        <img src={`${FX}slash.webp`} alt="" aria-hidden="true" className="po-slash" />
      </span>
    </button>
  );
}

/** A card face down; an SR glows gold and a UR rainbow before it turns (the game's own glow and foil). */
function FaceDown({ pulled, turned, order, isNew, onTurn }: {
  pulled: Pulled<PackCard>; turned: boolean; order: number; isNew: boolean; onTurn: () => void;
}) {
  const r = pulled.rarity;
  return (
    <button type="button" onClick={onTurn} className="po-card" style={{ animationDelay: `${order * 45}ms` }}
            aria-label={turned ? `${pulled.card.name} ${r}${pulled.finish !== "basic" ? ` ${FINISH_LABEL[pulled.finish]}` : ""}` : `${order + 1}번째 카드 넘기기`}>
      <span className={`po-inner ${turned ? "po-turned" : ""}`}>
        <span className="po-back">
          {high(r) && <img src={`${FX}glow_${r.toLowerCase()}.webp`} alt="" aria-hidden="true" className="po-glow" />}
          <img src={`${FX}back.webp`} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover rounded-[4%]" />
          {high(r) && <span className="po-foil" style={{ backgroundImage: `url(${FX}foil_${r.toLowerCase()}.webp)` }} />}
        </span>
        <span className="po-front">
          <CardFace pulled={pulled} isNew={isNew} />
        </span>
      </span>
    </button>
  );
}

function CardFace({ pulled, isNew }: { pulled: Pulled<PackCard>; isNew: boolean }) {
  const { card, rarity, finish } = pulled;
  return (
    <>
      <img src={card.thumb} alt="" className="absolute inset-0 w-full h-full object-cover card-corner" />
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

/** 팩 개봉 결과: every card pulled, UR first, a royal or shine one before a plain one; a tap shows it large. */
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
            <button key={i} type="button" onClick={() => onOpen(c)} className="relative aspect-[704/1024]"
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
.po-rays { position: absolute; left: 50%; top: 50%; width: 170vmax; height: 170vmax; translate: -50% -50%; animation: po-spin 90s linear infinite; opacity: .75; }
.po-rays > span { position: absolute; width: calc(50% + 2px); height: calc(50% + 2px); margin: -1px; background-size: 100% 100%; }
@keyframes po-spin { to { rotate: 360deg; } }
.po-pack { position: relative; display: block; height: min(58svh, 118vw); aspect-ratio: 250 / 512; }
.po-pack-box { position: absolute; inset: 0; display: block; animation: po-rise .5s ease-out both; }
.po-flare { position: absolute; left: 50%; bottom: -7%; width: 190%; max-width: none; translate: -50% 0; mix-blend-mode: screen; pointer-events: none; opacity: .7; animation: po-pulse 1.6s ease-in-out infinite alternate; }
.po-top { clip-path: inset(0 0 83% 0); transition: transform .5s cubic-bezier(.3,.6,.4,1), opacity .5s; transform-origin: 85% 17%; }
.po-body { clip-path: inset(17% 0 0 0); transition: transform .45s ease-in .3s, opacity .45s ease-in .3s; }
.po-slash { position: absolute; left: -40%; top: 17%; width: 180%; max-width: none; translate: 0 -50%; opacity: 0; mix-blend-mode: screen; pointer-events: none; }
.po-tearing .po-top { transform: translate(14%, -40%) rotate(14deg); opacity: 0; }
.po-tearing .po-body { transform: translateY(18%) scale(.96); opacity: 0; }
.po-tearing .po-slash { animation: po-slash .32s ease-out both; }
.po-tearing .po-flare { opacity: 0; transition: opacity .4s; }
@keyframes po-rise { from { transform: translateY(12%) scale(.9); opacity: 0; } }
@keyframes po-pulse { from { opacity: .45; } to { opacity: .8; } }
@keyframes po-slash { 0% { opacity: 0; transform: translateX(-30%); } 40% { opacity: 1; } 100% { opacity: 0; transform: translateX(30%); } }
.po-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: min(100%, calc((100svh - 190px) / 2 * 0.6875 * 4 + 24px), 760px); perspective: 1200px; }
.po-card { position: relative; aspect-ratio: 704 / 1024; animation: po-deal .38s cubic-bezier(.2,.7,.3,1) both; }
@keyframes po-deal { from { transform: translateY(40%) scale(.7); opacity: 0; } }
.po-inner { position: absolute; inset: 0; display: block; transform-style: preserve-3d; transition: transform .45s cubic-bezier(.3,.6,.3,1); }
.po-turned { transform: rotateY(180deg); }
.po-back, .po-front { position: absolute; inset: 0; display: block; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.po-front { transform: rotateY(180deg); }
.po-glow { position: absolute; inset: -9% -12%; width: 124%; height: 118%; max-width: none; mix-blend-mode: screen; animation: po-pulse 1.1s ease-in-out infinite alternate; }
.po-foil { position: absolute; inset: 0; border-radius: 4%; background-size: 220% 220%; mix-blend-mode: screen; opacity: .55; animation: po-foil 5s linear infinite; }
@keyframes po-foil { to { background-position: 220% 110%; } }
.po-sheen { position: absolute; inset: 0; border-radius: 4.5%; pointer-events: none; background-image: linear-gradient(115deg, transparent 32%, rgba(255,255,255,.55) 46%, transparent 60%); background-size: 260% 100%; mix-blend-mode: overlay; animation: po-sheen 2.6s ease-in-out infinite; }
.po-royal { background-size: 100% 300%; mix-blend-mode: soft-light; opacity: .8; animation: po-royal 3.2s linear infinite; }
@keyframes po-sheen { from { background-position: 130% 0; } to { background-position: -130% 0; } }
@keyframes po-royal { to { background-position: 0 300%; } }
.po-button { min-width: 140px; height: 48px; padding: 0 20px; border-radius: 9999px; font-weight: 800; letter-spacing: .04em; color: #fff;
  background: linear-gradient(180deg, #3b82f6, #1d4ed8); box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset, 0 6px 18px rgba(29,78,216,.45); }
.po-button small { font-weight: 600; opacity: .8; margin-left: 4px; }
.po-small { min-width: 0; height: 44px; padding: 0 16px; font-size: 14px; }
.po-plain { background: rgba(255,255,255,.12); box-shadow: none; }
@media (hover: hover) { .po-button:hover { filter: brightness(1.12); } }
@media (prefers-reduced-motion: reduce) {
  .po-rays, .po-flare, .po-glow, .po-foil, .po-sheen, .po-royal, .po-card, .po-pack-box { animation: none; }
  .po-inner, .po-top, .po-body { transition: none; }
}
`;
