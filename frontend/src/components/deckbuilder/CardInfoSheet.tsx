import { Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getCard, type CardDoc, type CardListItem } from "@/api/cardDexApi";
import { FaceThumbs, FinishToggle, faceParams, finishesFor } from "@/components/CardLookPicker";
import { finishSupported } from "@/lib/cardFinish";
import { type CardLook, lookThumb } from "@/lib/deckDrafts";
import { lazyChunk } from "@/lib/lazyChunk";

const CardFinishCanvas = lazyChunk(() => import("@/components/CardFinishCanvas"));

const BAN_LABEL = { forbidden: "금지", limited: "제한", semi_limited: "준제한" } as const;
const BUTTON = "flex-1 h-10 px-2 rounded-lg font-semibold text-sm break-keep transition disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed";
const SMALL = "h-7 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 break-keep transition hover:bg-gray-50 dark:hover:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-gray-800";

export type CardInfoProps = {
  card: CardListItem;
  /** How many copies of its name the deck holds. */
  inDeck: number;
  /** How it is shown: the copy's look (a copy in the deck), or the look the next copy put in takes (참혈 2026-10-16). */
  look: CardLook;
  onLook: (look: CardLook) => void;
  /** A copy in the deck: how many copies of the card its zone holds, all of them put in this look at once. */
  copies?: number;
  sameLook?: boolean;
  onLookAll?: () => void;
  /** The card's prints, once known (the deck draws its copies in them). */
  onFaces?: (faces: CardDoc["faces"]) => void;
  onAdd?: () => void;
  onRemove?: () => void;
  canRemove: boolean;
};

/** A card shown while a deck is built (참혈 2026-10-16: held or right-clicked, on a phone in a sheet from below, from
 *  lg in the search's place): the card as the look picked draws it, its prints and 일반 / 샤인 / 로얄 under it as on
 *  the card page, its text in Korean, and a copy in or out without leaving the deck. pane: stacked for the
 *  search's narrow column. */
function CardInfoBody({ card, inDeck, look, onLook, copies = 0, sameLook, onLookAll, onFaces, onAdd, onRemove, canRemove, pane }: CardInfoProps & { pane: boolean }) {
  const [doc, setDoc] = useState<CardDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [canFinish] = useState(finishSupported);
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setFailed(false);
    getCard(card.id)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        onFaces?.(d.faces);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);
  const t = doc?.texts.ko ?? doc?.texts.ja ?? null;
  const face = doc?.faces.find((f) => f.id === look.face) ?? doc?.faces[0];
  const finishes = doc && canFinish ? finishesFor(doc, face) : [];
  const shown = finishes.some((f) => f.key === look.finish) ? look.finish : "normal";
  // the small face at once, the full one once it comes
  const src = face?.face || doc?.face_url || lookThumb(card, look);
  const alt = `${card.name} 카드`;
  const picture = (
    <span className="relative block w-full">
      {shown === "normal" || !doc ? (
        <img src={src} alt={alt} className="block w-full aspect-[704/1024] object-contain card-corner" />
      ) : (
        <Suspense fallback={<img src={src} alt={alt} className="block w-full aspect-[704/1024] object-contain card-corner" />}>
          <CardFinishCanvas faceUrl={src} style={shown} params={faceParams(doc, face)} alt={`${alt} (${shown === "royal" ? "로얄" : "샤인"})`} className="block w-full aspect-[704/1024] card-corner" />
        </Suspense>
      )}
    </span>
  );
  // the prints and finishes under the picture, kept their room while the card comes
  const picker = !doc ? (
    !failed && <span className="mt-2 block h-7 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
  ) : (
    <>
      {finishes.length > 1 && (
        <FinishToggle finishes={finishes} value={shown} onChange={(finish) => onLook({ face: face?.id ?? card.id, finish })} className="mt-2 text-xs" />
      )}
      {doc.faces.length > 1 && (
        <FaceThumbs
          faces={doc.faces}
          value={face?.id}
          // a finish the print picked doesn't come in (로얄 on an R print) goes back to 일반
          onPick={(f) => onLook({ face: f.id, finish: finishesFor(doc, f).some((x) => x.key === shown) ? shown : "normal" })}
          className={`mt-2 grid gap-1.5 ${pane ? "grid-cols-4" : "grid-cols-3"}`}
          ring="ring-blue-500 ring-offset-white dark:ring-offset-gray-800"
        />
      )}
      {onLookAll && copies > 1 && (
        <button type="button" onClick={onLookAll} disabled={sameLook} className={`mt-2 w-full ${SMALL}`} title={`덱에 든 이 카드 ${copies}장을 모두 이 모습으로`}>
          {sameLook ? `${copies}장 모두 같은 모습` : `이 카드 ${copies}장 모두`}
        </button>
      )}
    </>
  );
  const rarity = face?.rarity ?? card.rarity;
  const title = (
    <>
      <h2 className="m-0 text-base font-bold break-keep">{card.name}</h2>
      <p className="mt-1 mb-0 text-xs text-gray-500 dark:text-gray-400">
        {rarity && <span className="mr-2">{rarity}</span>}
        {card.ban && <span className="font-semibold text-red-600 dark:text-red-400">{BAN_LABEL[card.ban]}</span>}
        {inDeck > 0 && <span className="ml-2 tabular-nums">덱에 {inDeck}장</span>}
      </p>
    </>
  );
  const text = (
    <div className="mt-2 text-sm leading-relaxed whitespace-pre-line break-keep text-gray-800 dark:text-gray-200">
      {t ? (
        <>
          {t.materials && <p className="mb-1 text-gray-600 dark:text-gray-300">{t.materials}</p>}
          {t.pendulum_effect && <p className="mb-2"><span className="text-xs font-semibold text-gray-500">펜듈럼 효과</span><br />{t.pendulum_effect}</p>}
          <p className="m-0">{t.effect || t.flavor}</p>
        </>
      ) : failed ? (
        <p className="m-0 text-gray-500">카드 효과를 불러오지 못했습니다.</p>
      ) : (
        <span className="block h-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      )}
    </div>
  );
  const buttons = (
    <div className={`flex gap-2 ${pane ? "mt-3" : "mt-4"}`}>
      {onRemove && <button type="button" onClick={onRemove} disabled={!canRemove} className={`${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`}>1장 빼기</button>}
      {onAdd && <button type="button" onClick={onAdd} className={`${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`}>1장 넣기</button>}
      <Link to={`/cards/${card.id}`} className={`${BUTTON} inline-flex items-center justify-center border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100`}>카드 문서</Link>
    </div>
  );

  if (pane) {
    return (
      <>
        <div className="mx-auto w-[11.5rem]">
          {picture}
          {picker}
        </div>
        <div className="mt-3">{title}</div>
        {buttons}
        {text}
      </>
    );
  }
  return (
    <>
      <div className="flex gap-4">
        <div className="w-32 sm:w-40 shrink-0 self-start">
          {picture}
          {picker}
        </div>
        <div className="min-w-0 flex-1">
          {title}
          {text}
        </div>
      </div>
      {buttons}
    </>
  );
}

/** Below lg: the card in a sheet from below, over the deck; a tap outside or Esc closes it. */
export default function CardInfoSheet({ onClose, ...props }: CardInfoProps & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-label={props.card.name}>
      <div className="w-full sm:max-w-lg max-h-[85svh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 p-4" onClick={(e) => e.stopPropagation()}>
        <CardInfoBody {...props} pane={false} />
      </div>
    </div>
  );
}

/** From lg: the card in the search's own column (참혈 2026-10-16), ← 뒤로 (or Esc) going back to the search as it was. */
export function CardInfoPane({ onClose, ...props }: CardInfoProps & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section aria-label={props.card.name} className="h-full flex flex-col">
      <div className="shrink-0 h-9 flex items-center">
        <button
          type="button"
          onClick={onClose}
          className="h-8 pl-1.5 pr-2.5 -ml-1.5 inline-flex items-center gap-1 rounded-lg border-0 bg-transparent text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="검색으로 돌아가기 (Esc)"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          뒤로
        </button>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain -mr-3 pr-3">
        <CardInfoBody {...props} pane />
      </div>
    </section>
  );
}
