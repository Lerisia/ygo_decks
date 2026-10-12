import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import BackToDex from "@/components/BackToDex";
import { type BanStatus, type CardDoc, type CardTexts, getCard } from "@/api/cardDexApi";
import CardFinishCanvas from "@/components/CardFinishCanvas";
import CutinOverlay, { type CutinInfo } from "@/components/CutinOverlay";
import { hasPlayed, prefetchSummon } from "@/lib/cutinPrefetch";
import { type CutinSound, primeCutinSound } from "@/lib/cutinSound";
import { type FinishParams, type FinishStyle, finishSupported } from "@/lib/cardFinish";

// Master Duel's finishes (가공), drawn with the game's own shaders (엘리스 2026-10-11); 로얄 comes in SR and UR only
const ROYAL_RARITIES = new Set(["SR", "UR", ""]);   // "" for a print whose rarity is not known
const FINISHES: { key: "normal" | FinishStyle; label: string }[] = [
  { key: "normal", label: "일반" },
  { key: "shine", label: "샤인" },
  { key: "royal", label: "로얄" },
];

const MARKERS = ["top_left", "top", "top_right", "left", "", "right", "bottom_left", "bottom", "bottom_right"];
const ARROWS: Record<string, string> = {
  top_left: "↖", top: "↑", top_right: "↗", left: "←", right: "→", bottom_left: "↙", bottom: "↓", bottom_right: "↘",
};

const day = (d: string | null) => (d ? d.replace(/-/g, ".") : "");

/** The link markers as a small 3×3 (the size of an icon), the arrows in red. */
function LinkMarkers({ on }: { on: string[] }) {
  return (
    <span role="img" aria-label={`링크 마커 ${on.map((m) => ARROWS[m]).join(" ")}`} className="grid grid-cols-3 gap-px w-6 h-6 md:w-7 md:h-7 shrink-0">
      {MARKERS.map((m, i) => (
        <span key={i} className={m ? `rounded-[1px] ${on.includes(m) ? "bg-red-500" : "bg-gray-400/40 dark:bg-gray-500/40"}` : ""} />
      ))}
    </span>
  );
}

function TextBlock({ t, pendulum }: { t: CardTexts; pendulum: boolean }) {
  if (!t) return <p className="text-gray-500 dark:text-gray-400">효과문이 없습니다.</p>;
  return (
    <div className="flex flex-col gap-3 whitespace-pre-line leading-relaxed">
      {t.pendulum_effect && (
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">펜듈럼 효과</p>
          <p>{t.pendulum_effect}</p>
        </div>
      )}
      {(t.materials || t.effect) && (
        <div>
          {pendulum && t.pendulum_effect && <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">몬스터 효과</p>}
          {t.materials && <p className="font-medium">{t.materials}</p>}
          {t.effect && <p>{t.effect}</p>}
        </div>
      )}
      {t.flavor && <p className="italic text-gray-600 dark:text-gray-300">{t.flavor}</p>}
    </div>
  );
}

// The card in a box of its frame's colour with Master Duel's icons, as 나무위키 lays a card out (엘리스 2026-10-12): the
// names on top, the card small beside its stats and the effect text right under them, so a phone shows the card and
// what it does together (10/11); a tap shows the card large. Wider screens keep the card in its own column, the stats
// in one line. The pale panels hold the card too: on a phone the card and its stats share one (엘리스 10/12). A
// pendulum's box turns green where its pendulum effect begins, as the card does.
const BOX = "grid grid-cols-[40%_1fr] gap-1.5 p-1.5 rounded-xl dark:ring-1 dark:ring-white/10 md:grid-cols-[20rem_1fr] md:grid-rows-[auto_auto_1fr] md:gap-x-2";
const AREA = {
  head: "col-span-2 col-start-1 row-start-1 md:col-span-1 md:col-start-2 px-1.5 pt-1 pb-0.5",
  card: "col-start-1 row-start-2 p-1.5 md:row-start-1 md:row-span-3",
  stats: "col-start-2 row-start-2 self-start md:self-auto",
  effect: "col-span-2 col-start-1 row-start-3 md:col-span-1 md:col-start-2",
  lower: "col-span-2 col-start-1 row-start-3 -mx-1.5 -mb-1.5 -mt-[3px] rounded-b-xl",
  pair: "col-span-2 col-start-1 row-start-2 md:hidden",   // a phone's one panel under the card and its stats
};
const PANEL = "rounded-lg bg-gray-200 dark:bg-gray-800";
const PANEL_ON_WHITE = "rounded-lg bg-white dark:bg-gray-800";   // a synchro's frame is as pale as the usual panel
const PANEL_WIDE = "md:rounded-lg md:bg-gray-200 md:dark:bg-gray-800";   // panels of their own on wider screens only
const PANEL_WIDE_ON_WHITE = "md:rounded-lg md:bg-white md:dark:bg-gray-800";
const ROW = "border-b last:border-b-0 border-gray-300 dark:border-gray-600";
// Master Duel's frame colours, taken from its card frames so that the box matches the card in it
const FRAME_COLORS: Record<string, string> = {
  normal: "#c08e3f", effect: "#b8592f", ritual: "#4c75b5", fusion: "#874095", synchro: "#d7d7d5", xyz: "#0b0b0e",
  link: "#006bb5", spell: "#008a72", trap: "#a91777", token: "#7d6d65",
};
const DARK_NAMES = new Set(["normal", "synchro"]);   // frames light enough for dark names
// the game's icons (mdpipeline/info_icons.py), served from media: the repo is public
const ICONS = "/media/md_ui/info";
const LEVEL_ICONS: Record<string, string> = { 레벨: "level", 랭크: "rank", 링크: "link" };
const KIND_ICONS = new Set(["quick_play", "continuous", "field", "equip", "ritual", "counter"]);

/** One stat behind its icon (a blank of the same width where the game shows none, so a phone's list stays aligned). */
function Stat({ icon, label, children }: { icon: string | null; label?: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {icon ? <img src={`${ICONS}/${icon}.webp`} alt="" className="w-6 h-6 md:w-7 md:h-7 shrink-0" /> : <span className="w-6 shrink-0 md:hidden" />}
      {label && <span className="sr-only">{label}</span>}
      <span className="flex items-center gap-1.5 break-keep">{children}</span>
    </span>
  );
}

/** Stats one under another on a phone, in a line between bars on wider screens. */
function StatGroup({ items }: { items: ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center">
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="hidden md:inline mx-2 text-gray-400 dark:text-gray-500" aria-hidden="true">|</span>}
          {it}
        </Fragment>
      ))}
    </div>
  );
}

function Skeleton() {
  const bar = "rounded-lg bg-gray-300 dark:bg-gray-600";
  return (
    <div className="h-auto min-h-screen w-full max-w-4xl mx-auto px-4 pt-6 pb-4">
      <BackToDex to="/cards" label="카드 도감으로" />
      <div className={`${BOX} bg-gray-200 dark:bg-gray-700 animate-pulse`}>
        {/* the same heading and lines as the names, so the box below starts where it will */}
        <div className={AREA.head}>
          <h1 className="text-xl md:text-2xl font-extrabold"><span className={`inline-block align-middle h-[0.9em] w-2/3 ${bar}`} /></h1>
          <p className="mt-0.5 text-sm leading-5"><span className={`inline-block align-middle h-3.5 w-1/2 ${bar}`} /></p>
          <p className="text-sm leading-5"><span className={`inline-block align-middle h-3.5 w-1/3 ${bar}`} /></p>
        </div>
        <div className={`${AREA.pair} ${bar}`} />
        <div className={`${AREA.card} md:rounded-lg md:bg-gray-300 md:dark:bg-gray-600`}>
          <div className="w-full aspect-[704/1024] card-corner bg-gray-400/40 dark:bg-gray-500/50" />
          {finishSupported() && <div className="mt-2 h-7 md:h-8 w-full rounded-lg bg-gray-400/40 dark:bg-gray-500/50" />}
        </div>
        <div className={`${AREA.stats} h-32 md:h-10 md:rounded-lg md:bg-gray-300 md:dark:bg-gray-600`} />
        <div className={`${AREA.effect} h-32 ${bar}`} />
      </div>
      <div className={`mt-3 h-10 w-full ${bar}`} />
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden="true" fill="currentColor">
      <path d="M3 1.5v9l7.5-4.5z" />
    </svg>
  );
}

function ZoomGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5 17 17M8.5 6v5M6 8.5h5" />
    </svg>
  );
}

/** The card face over the whole screen, in the finish picked on the page; a tap anywhere or Escape closes it. */
const BAN_LABELS: Record<BanStatus, string> = {
  forbidden: "금지", limited: "제한", semi_limited: "준제한", unlimited: "무제한", unreleased: "미출시",
};
const BAN_TAB_KEY = "card_banlist_format";
const EVENT_LABELS = { release: "출시", release_kr: "한국 발매" } as const;

/** Master Duel's own 금제 icon (0 / 1 / 2 copies; mdpipeline/info_icons.py, served from media); unlimited, like a
 *  release, an empty dashed ring — the game shows nothing for it either (엘리스 10/12). */
function BanIcon({ status, size = "w-6 h-6" }: { status: BanStatus; size?: string }) {
  return status === "unreleased" || status === "unlimited" ? (
    <span className={`${size} shrink-0 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600`} aria-hidden="true" />
  ) : (
    <img src={`${ICONS}/limit/${status}.webp`} alt="" className={`${size} shrink-0`} />
  );
}

/** A card's 연혁 in each game (엘리스 2026-10-12): when it came out and each 금제 change since, the latest first; the
 *  game picked last time opens first. */
function CardHistory({ history }: { history: CardDoc["history"] }) {
  const [picked, setPicked] = useState(() => {
    try {
      return localStorage.getItem(BAN_TAB_KEY) ?? "";
    } catch {
      return "";
    }
  });
  if (!history.length) return null;
  const shown = history.find((h) => h.format === picked) ?? history[0];
  const events = [...shown.events].reverse();   // the latest first
  const current = events.findIndex((e) => !e.event);   // the latest 금제 line; none while it was never limited
  const pick = (format: string) => {
    setPicked(format);
    try {
      localStorage.setItem(BAN_TAB_KEY, format);
    } catch {
      /* private mode: the choice lasts while the page is open */
    }
  };
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-lg font-bold">연혁</h2>
        {history.length > 1 && (
          <div role="tablist" aria-label="연혁 형식" className="flex rounded-lg bg-gray-200 dark:bg-gray-700 p-0.5 text-xs md:text-sm font-semibold">
            {history.map((h) => (
              <button
                key={h.format}
                type="button"
                role="tab"
                aria-selected={h.format === shown.format}
                onClick={() => pick(h.format)}
                className={`px-3 py-1 rounded-md transition ${
                  h.format === shown.format ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {events.length ? (
        <ol className="rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          {/* every line, however long: nothing folded away (엘리스 10/12) */}
          {events.map((e, i) => {
            // the 금제 in force stands out, without a word for it; a release is no 금제 (엘리스 10/12)
            const now = i === current;
            return (
              <li
                key={`${e.day}${e.event}`}
                aria-current={now || undefined}
                className={`flex items-center gap-2.5 px-3 ${now ? "py-3 bg-blue-50 dark:bg-blue-950/40 text-base" : "py-2"}`}
              >
                <BanIcon status={e.status || "unreleased"} size={now ? "w-8 h-8" : "w-6 h-6"} />
                <span className={`w-[5.5rem] shrink-0 tabular-nums ${now ? "text-gray-800 dark:text-gray-100 font-semibold text-sm" : "text-gray-600 dark:text-gray-300"}`}>
                  {day(e.day)}
                </span>
                <span className={now ? "font-bold" : e.event ? "text-gray-600 dark:text-gray-300" : ""}>
                  {e.event ? EVENT_LABELS[e.event] : BAN_LABELS[e.status as BanStatus]}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
          {shown.label}에는 아직 나오지 않았습니다.
        </p>
      )}
    </section>
  );
}

function CardZoom({ src, alt, finish, params, onClose }: {
  src: string; alt: string; finish: "normal" | FinishStyle; params: FinishParams; onClose: () => void;
}) {
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
  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      {finish === "normal" ? (
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain card-corner" />
      ) : (
        <CardFinishCanvas faceUrl={src} style={finish} params={params} alt={alt} className="block aspect-[704/1024] w-[min(100%,704px,calc((100svh_-_2rem)*0.6875))] card-corner" />
      )}
    </div>
  );
}

/** 카드 도감 document: the Korean card face (and its Master Duel alternate arts), names, stats, effect text,
 *  the card's 카드군 (each opens the card list filtered to it) and the decks those 카드군 are linked to. */
export default function CardDetail() {
  const { cardId } = useParams();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [ja, setJa] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [cutin, setCutin] = useState<{ id: number; info: CutinInfo; sound: CutinSound | null } | null>(null);
  const closeCutin = useCallback(() => setCutin(null), []);
  const [finish, setFinish] = useState<"normal" | FinishStyle>("normal");
  const [canFinish] = useState(finishSupported);
  const preloaded = useRef<{ card: number; images: HTMLImageElement[] }>({ card: 0, images: [] });

  useEffect(() => {
    let alive = true;
    setCard(null);
    setError("");
    setJa(false);
    setZoomed(false);
    setFinish("normal");
    getCard(cardId ?? "")
      .then((c) => {
        if (!alive) return;
        setCard(c);
        setPicked(c.face_url);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [cardId]);

  // someone who has played a summon in this visit likely plays this one too: its files are fetched ahead (10/12)
  useEffect(() => {
    const face = card?.faces.find((f) => f.face === picked);
    if (!card || !face?.cutin || !hasPlayed()) return;
    const t = setTimeout(() => prefetchSummon(face.id, face.cutin!, card.cutin_sound), 800);
    return () => clearTimeout(t);
  }, [card, picked]);

  if (error) {
    return (
      <div className="min-h-screen px-4 pt-6 pb-16 text-center">
        <p className="mb-4">{error}</p>
        <Link to="/cards" className="text-blue-600 dark:text-blue-400 underline">카드 목록으로</Link>
      </div>
    );
  }
  if (!card) return <Skeleton />;

  const pendulum = card.pendulum_scale !== null && card.pendulum_scale !== undefined;
  const isLink = card.frame === "link";
  const texts = ja && card.texts.ja ? card.texts.ja : card.texts.ko;
  const pickedFace = card.faces.find((f) => f.face === picked);
  const finishParams: FinishParams = {
    ...card.finish, frame: pickedFace?.overframe ? "overframe" : card.finish.frame, name: pickedFace?.name_mask ?? null,
  };
  // the print picked decides: an N / R card's UR 오버프레임 comes in 로얄, the card itself does not
  // a token comes in neither 샤인 nor 로얄 (엘리스 10/12)
  const finishes = card.frame === "token" ? [] : FINISHES.filter((f) => f.key !== "royal" || ROYAL_RARITIES.has(pickedFace?.rarity ?? card.rarity));
  const shown = finishes.some((f) => f.key === finish) ? finish : "normal";
  const levelName = (card.level_label || "").split(" ")[0];
  // Once the card is on screen its other illustrations are fetched too, so picking one shows it at once rather than
  // after a 150KB download with the old picture still up (엘리스 2026-10-11: "반응이 느리고 가끔 안 눌림").
  const preloadFaces = () => {
    if (preloaded.current.card === card.id) return;
    preloaded.current = {
      card: card.id,
      images: card.faces.filter((f) => f.face !== card.face_url).map((f) => {
        const img = new Image();
        img.src = f.face;
        img.decode().catch(() => {});
        return img;
      }),
    };
  };
  const base = card.frame.replace("_pendulum", "");
  const frameColor = FRAME_COLORS[base] ?? FRAME_COLORS.effect;
  const [panel, panelWide] = base === "synchro" ? [PANEL_ON_WHITE, PANEL_WIDE_ON_WHITE] : [PANEL, PANEL_WIDE];
  const rarity = pickedFace?.rarity || card.rarity;
  const left: ReactNode[] = [], right: ReactNode[] = [];
  if (card.category === "monster") {
    left.push(<Stat icon={card.attribute_key ? `attr/${card.attribute_key}` : null}>{card.attribute || "-"}</Stat>);
    if (card.level_label) {
      left.push(
        <Stat icon={LEVEL_ICONS[levelName] ?? null}>
          {card.level_label}
          {isLink && <LinkMarkers on={card.link_markers} />}
        </Stat>,
      );
    }
    if (pendulum) left.push(<Stat icon="scale">스케일 {card.pendulum_scale}</Stat>);
    right.push(<Stat icon="atk" label="공격력"><span className="font-semibold tabular-nums">{card.atk ?? "-"}</span></Stat>);
    if (!isLink) right.push(<Stat icon="def" label="수비력"><span className="font-semibold tabular-nums">{card.def ?? "-"}</span></Stat>);
  } else {
    left.push(<Stat icon={`attr/${card.category}`}>{card.category === "spell" ? "마법" : "함정"}</Stat>);
    left.push(<Stat icon={KIND_ICONS.has(card.spell_trap_kind) ? `kind/${card.spell_trap_kind}` : null}>{card.type_line}</Stat>);
  }
  const typeLine = card.category === "monster" ? <Stat icon={card.race ? `race/${card.race}` : null}>{card.type_line}</Stat> : null;
  const rows: [string, ReactNode][] = [];
  // The card's 카드군 come first under the box (엘리스 2026-10-11: "카드군도 중요한 정보"); each opens its cards.
  // The row stays when there are none, so it is always in the same place and "none" reads as an answer (44% of cards).
  rows.push(["카드군", card.groups.length ? (
    <div className="flex flex-wrap gap-1">
      {card.groups.map((g) => (
        <Link
          key={g.id}
          to={`/cards?group=${g.id}`}
          className="px-2 py-0.5 rounded-full text-xs md:text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-600 hover:text-white transition"
        >
          {g.name}
        </Link>
      ))}
    </div>
  ) : (
    <span className="text-gray-400 dark:text-gray-500">없음</span>
  )]);
  // The cards supporting this one (itself included), when any other card names it: its own support list.
  if (card.supporters) {
    rows.push(["서포트 카드", (
      <Link to={`/cards?card=${card.id}`} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">
        {card.supporters.toLocaleString()}장 보기 →
      </Link>
    )]);
  }
  // 서포트: the 카드군 (filled, like the row above) and cards (outlined) its text names without being one of them;
  // ⇄ marks a card that names this one back — they support each other (엘리스 2026-10-11).
  if (card.supports.length) {
    rows.splice(1, 0, ["서포트", (
      <div className="flex flex-wrap gap-1">
        {card.supports.map((t) => (
          <Link
            key={`${t.kind}${t.id}`}
            to={t.kind === "group" ? `/cards?group=${t.id}` : `/cards/${t.id}`}
            title={t.kind === "group" ? "카드군" : t.mutual ? "카드 · 서로 서포트" : "카드"}
            className={`px-2 py-0.5 rounded-full text-xs md:text-sm font-semibold transition ${
              t.kind === "group"
                ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-600 hover:text-white"
                : "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-600 hover:text-blue-600"
            }`}
          >
            {t.name}
            {/* a no-break space keeps ⇄ with the last word of the name */}
            {t.mutual && <span aria-label="서로 서포트">{"\u00a0"}⇄</span>}
          </Link>
        ))}
      </div>
    )]);
  }

  return (
    <div className="h-auto min-h-screen w-full max-w-4xl mx-auto px-4 pt-6 pb-4">
      <BackToDex to="/cards" label="카드 도감으로" />
      <div className={BOX} style={{ background: frameColor }}>
        {pendulum && <div aria-hidden="true" className={AREA.lower} style={{ background: FRAME_COLORS.spell }} />}
        <div className={`${AREA.head} ${DARK_NAMES.has(base) ? "text-gray-900" : "text-white"}`}>
          {/* the rarity of the print picked (an alternate art can be rarer), in Master Duel's own badge
              (GUI_Icon_Rarity_Deck0~3 from the game, rebuilt at 4× so it is as sharp as the card — 특이점 10/12; served from
              media: the repo is public) — 엘리스 10/12 */}
          {rarity && (
            <img src={`/media/md_ui/rarity_${rarity.toLowerCase()}_hd.png`} alt={`레어도 ${rarity}`} title={rarity} className="float-right ml-2 mt-1 h-5 md:h-6 w-auto" />
          )}
          {/* today's Master Duel 금제 at the top left, as the rarity is at the top right (엘리스 10/12) */}
          {card.ban && (
            <img src={`${ICONS}/limit/${card.ban}.webp`} alt={BAN_LABELS[card.ban]} title={`마스터 듀얼 ${BAN_LABELS[card.ban]}`} className="float-left mr-2 mt-0.5 w-7 h-7 md:w-8 md:h-8" />
          )}
          <h1 className="text-xl md:text-2xl font-extrabold break-keep">{card.name_ko || card.name}</h1>
          {card.name_ja && (
            <p lang="ja" className="mt-0.5 text-sm leading-5 opacity-90">
              {card.name_ja}
              {card.name_ja_ruby && card.name_ja_ruby !== card.name_ja && <span className="ml-1.5 text-xs opacity-80">{card.name_ja_ruby}</span>}
            </p>
          )}
          {card.name_en && <p lang="en" className="text-sm leading-5 opacity-90">{card.name_en}</p>}
        </div>

        <div className={`${AREA.pair} ${panel}`} />
        <div className={`${AREA.card} ${panelWide}`}>
          {picked ? (
            <div className="relative">
              <button type="button" onClick={() => setZoomed(true)} className="relative block w-full cursor-zoom-in" aria-label="카드 크게 보기">
                {shown === "normal" ? (
                  <img src={picked} alt={`${card.name} 카드`} onLoad={preloadFaces} className="w-full aspect-[704/1024] object-contain card-corner" />
                ) : (
                  <CardFinishCanvas faceUrl={picked} style={shown} params={finishParams} paused={zoomed} alt={`${card.name} 카드 (${shown === "royal" ? "로얄" : "샤인"})`} className="block w-full aspect-[704/1024] card-corner" />
                )}
                <span className="absolute right-1 bottom-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                  <ZoomGlyph />
                </span>
              </button>
              {pickedFace?.cutin ? (
                <button
                  type="button"
                  onPointerEnter={() => prefetchSummon(pickedFace.id, pickedFace.cutin!, card.cutin_sound)}
                  onClick={() => setCutin({ id: pickedFace.id, info: pickedFace.cutin!, sound: primeCutinSound(card.cutin_sound) })}
                  className="absolute left-1 bottom-1 h-7 px-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap shadow-md ring-1 ring-white/70 flex items-center gap-1"
                  aria-label="소환 연출 재생"
                >
                  <PlayGlyph />
                  소환 연출
                </button>
              ) : null}
            </div>
          ) : (
            <img src={card.image_url || "/default_cover.png"} alt={card.name} className="w-full aspect-square object-cover rounded-xl bg-gray-100 dark:bg-gray-800" />
          )}
          {picked && canFinish && finishes.length > 1 && (
            <div role="radiogroup" aria-label="가공" className={`mt-2 grid ${finishes.length === 3 ? "grid-cols-3" : "grid-cols-2"} rounded-lg bg-gray-300 dark:bg-gray-700 p-0.5 text-xs md:text-sm font-semibold`}>
              {finishes.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={shown === f.key}
                  onClick={() => setFinish(f.key)}
                  className={`py-1 rounded-md transition ${
                    shown === f.key ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {card.faces.length > 1 && (
            <div className="mt-2 grid grid-cols-3 gap-1 md:flex md:flex-wrap md:gap-1.5">
              {card.faces.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPicked(f.face)}
                  className={`md:w-12 card-corner overflow-hidden ring-2 ring-offset-1 transition touch-manipulation ${picked === f.face ? "ring-white ring-offset-black" : "ring-transparent ring-offset-transparent"}`}
                  aria-label={i === 0 ? "기본 일러스트" : `다른 일러스트 ${i}`}
                >
                  <img src={f.thumb || f.face} alt="" loading="lazy" className="w-full aspect-[704/1024] object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`${AREA.stats} ${panelWide} px-2 py-2 md:px-3 md:py-1.5 flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4 text-sm md:text-base`}>
          <StatGroup items={left} />
          {right.length > 0 && <StatGroup items={right} />}
        </div>

        <div className={`${AREA.effect} ${panel} p-3`}>
          {(typeLine || card.texts.ja) && (
            <div className={`flex items-center justify-between gap-2 ${typeLine ? "pb-2 mb-2 border-b border-gray-400/60 dark:border-gray-600" : "mb-1"}`}>
              {typeLine}
              {card.texts.ja && (
                <button
                  type="button"
                  onClick={() => setJa(!ja)}
                  className="ml-auto shrink-0 px-2 py-0.5 rounded-md text-xs font-semibold bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  {ja ? "한국어" : "일본어 원문"}
                </button>
              )}
            </div>
          )}
          <TextBlock t={texts} pendulum={pendulum} />
        </div>
      </div>

      <table className="mt-3 w-full border border-gray-300 dark:border-gray-600 text-left text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className={ROW}>
              <th scope="row" className="p-1.5 md:p-2 w-14 md:w-28 align-top text-left break-keep text-xs leading-5 md:text-sm font-semibold bg-gray-200 dark:bg-gray-700">{label}</th>
              <td className="p-1.5 md:p-2 tabular-nums break-keep">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* the release days are in the 연혁, each game's with its 금제 (엘리스 10/12) */}
      <CardHistory key={card.id} history={card.history} />

      {cutin && (
        <CutinOverlay id={cutin.id} info={cutin.info} attribute={card.cutin_sound} sound={cutin.sound} alt={`${card.name} 소환 연출`} onClose={closeCutin} />
      )}
      {zoomed && picked && (
        <CardZoom src={picked} alt={`${card.name} 카드`} finish={shown} params={finishParams} onClose={() => setZoomed(false)} />
      )}

      {card.decks.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold mb-2">이 카드를 쓰는 덱</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {card.decks.map((d) => (
              <Link key={d.id} to={`/database/${d.id}`} className="text-center">
                <img
                  src={d.cover || "/default_cover.png"}
                  alt={d.name}
                  loading="lazy"
                  className="w-full h-20 md:h-auto md:aspect-[4/3] object-cover rounded-lg"
                />
                <p className="mt-1 text-sm">{d.name}</p>
                {d.via === "support" && <p className="text-xs text-gray-500 dark:text-gray-400">서포트</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
