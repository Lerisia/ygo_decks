import { useEffect, useRef, useState } from "react";
import type { CardListItem } from "@/api/cardDexApi";
import { faceParams } from "@/components/CardLookPicker";
import { finishSupported } from "@/lib/cardFinish";
import { type CardLook, lookThumb } from "@/lib/deckDrafts";
import { type TileLook, addTile, tilesLost } from "@/lib/finishTiles";

const FINISH_LABEL = { shine: "샤인", royal: "로얄" } as const;

/** A copy in 샤인 or 로얄 where the shaders can't draw it (no WebGL 2, the context lost, a print with no face yet): a
 *  still sheen over it and a small gem in the corner (card-sheen in index.css, 참혈 2026-10-16). */
function StillFinish({ finish }: { finish: "shine" | "royal" }) {
  return (
    <>
      <span className={`card-sheen card-sheen-${finish} absolute inset-0 card-corner pointer-events-none`} aria-hidden />
      <span className={`card-gem card-gem-${finish} absolute bottom-[3%] left-[5%] pointer-events-none`} title={FINISH_LABEL[finish]} aria-label={FINISH_LABEL[finish]} />
    </>
  );
}

/** What the finish shaders draw a copy with — its print's small face, the card's values and the print's (as the card
 *  page: faceParams) — or null: 일반, or not known (a card asked for before the server sent these, a print not drawn). */
function copyFinish(card: CardListItem, look: CardLook | null | undefined): TileLook | null {
  if (!look || (look.finish !== "shine" && look.finish !== "royal") || !card.finish) return null;
  const face = look.face === card.id ? card.face_thumb_url : card.alts?.find((a) => a.id === look.face)?.thumb;
  if (!face) return null;
  return { face, style: look.finish, params: faceParams(card as { finish: NonNullable<CardListItem["finish"]> }, card.prints?.find((p) => p.id === look.face)) };
}

/** A copy's small face in its own print and finish (참혈 2026-10-16): in 샤인 / 로얄 the card page's shaders move on
 *  it at the same pace, all copies drawn through one shared context (lib/finishTiles); the plain face shows until
 *  they have drawn it, and the still marks where they can't. className sizes the picture; tone (fading) goes on
 *  whichever is showing. */
export default function CopyFace({ card, look, className, tone = "" }: {
  card: CardListItem; look: CardLook | null | undefined; className: string; tone?: string;
}) {
  const finish = look?.finish === "shine" || look?.finish === "royal" ? look.finish : null;
  const want = copyFinish(card, look);
  const [failed, setFailed] = useState(tilesLost);
  const [shown, setShown] = useState(false);
  const live = !!want && !failed && finishSupported();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tile = useRef<ReturnType<typeof addTile> | null>(null);
  const wantKey = want && `${want.face} ${want.style} ${want.params.frame} ${want.params.name ?? ""} ${want.params.attribute} ${want.params.level}`;

  useEffect(() => {
    if (!live) return;
    const t = addTile(canvasRef.current!, want!, { onShown: setShown, onLost: () => setFailed(true) });
    tile.current = t;
    return () => {
      t.remove();
      tile.current = null;
      setShown(false);
    };
  }, [live]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (want) tile.current?.update(want);
  }, [wantKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <img
        loading="lazy"
        decoding="async"
        src={lookThumb(card, look)}
        alt={card.name}
        className={`${className} ${tone} ${live && shown ? "invisible" : ""}`}
      />
      {live && (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${card.name} (${FINISH_LABEL[want!.style]})`}
          aria-hidden={shown ? undefined : true}
          className={`absolute inset-0 w-full h-full card-corner pointer-events-none ${tone}`}
        />
      )}
      {finish && !live && <StillFinish finish={finish} />}
    </>
  );
}
