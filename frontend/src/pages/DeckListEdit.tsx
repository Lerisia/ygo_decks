import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import CardSearchPanel from "@/components/deckbuilder/CardSearchPanel";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useDeckCards } from "@/hooks/useDeckCards";
import { type DeckDraft, type DeckZone, addCard, blankDeck, getDeck, removeCard, saveDeck } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListPath } from "@/lib/deckListPaths";

const BUTTON = "shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-lg font-semibold text-sm transition";
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`;
const SECONDARY = `${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`;
const FIELD = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Making a deck list (/decklists/new) or changing one (/decklists/:code/edit) (덱 구축, 참혈 2026-10-13): its name and
 *  description on top, then the deck, cards going in from the search and coming out when pressed. Saving keeps it
 *  in this browser for now (lib/deckDrafts). Operators only. */
export default function DeckListEdit() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const { code } = useParams();   // none on /decklists/new
  // undefined until read, null when there is no such deck
  const [deck, setDeck] = useState<DeckDraft | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const { cards, order, loading, error, remember } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);

  useEffect(() => {
    if (admin) setDeck(code === undefined ? blankDeck() : getDeck(code));
  }, [admin, code]);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  if (!admin || deck === undefined) return <div className="min-h-screen" />;

  const say = (text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  };
  const pick = (card: CardListItem) => {
    if (!deck) return;
    remember(card);
    const r = addCard(deck, card, cards);
    if ("error" in r) say(r.error);
    else setDeck(r.deck);
  };
  const remove = (zone: DeckZone, id: number) => deck && setDeck(removeCard(deck, zone, id));
  const cancel = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(code === undefined ? DECK_LISTS_PATH : deckListPath(code));
  };
  const save = () => {
    if (!deck) return;
    try {
      navigate(deckListPath(saveDeck({ ...deck, name: deck.name.trim(), description: deck.description.trim() }).code), { replace: true });
    } catch {
      say("이 브라우저에 저장하지 못했습니다.");
    }
  };

  return (
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
      {deck ? (
        <>
          <div className="h-9 flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold truncate">{code === undefined ? "덱 리스트 만들기" : "덱 리스트 수정"}</h1>
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className={SECONDARY}>취소</button>
              <button type="button" onClick={save} disabled={!deck.name.trim()} className={PRIMARY}>저장</button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <input
              aria-label="덱 이름"
              placeholder="덱 이름"
              maxLength={40}
              value={deck.name}
              onChange={(e) => setDeck({ ...deck, name: e.target.value })}
              className={FIELD}
            />
            <textarea
              aria-label="덱 설명"
              placeholder="덱 설명 (선택)"
              rows={2}
              maxLength={500}
              value={deck.description}
              onChange={(e) => setDeck({ ...deck, description: e.target.value })}
              className={`${FIELD} resize-y`}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">
              이 브라우저에만 임시 저장됩니다. 덱의 카드를 누르면 1장씩 빠집니다.
            </p>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {/* From lg the search stands beside the zones, as tall as the two of them (참혈 2026-10-14): it fills its cell
              without making it taller, so the zones alone decide the row's height. */}
          <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch lg:gap-4">
            <DeckZones deck={deck} cards={cards} order={order} loading={loading} onRemove={remove} />
            <div className="lg:relative">
              <CardSearchPanel deck={deck} cards={cards} onPick={pick} notice={notice} ready={!loading} />
            </div>
          </div>
        </>
      ) : (
        <div className="py-16 flex flex-col items-center gap-4">
          <p className="text-gray-600 dark:text-gray-300">덱을 찾을 수 없습니다.</p>
          <Link to={DECK_LISTS_PATH} className={`${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`}>목록으로</Link>
        </div>
      )}
    </div>
  );
}
