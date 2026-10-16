import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { isAuthenticated } from "@/api/accountApi";
import { createDeckList, getDeckList, updateDeckList } from "@/api/deckListApi";
import CardInfoSheet, { type CardInfoProps, CardInfoPane } from "@/components/deckbuilder/CardInfoSheet";
import CardSearchPanel from "@/components/deckbuilder/CardSearchPanel";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useDeckCards } from "@/hooks/useDeckCards";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  type CardLook, type CoverPick, type DeckDraft, type DeckZone, COVERS_MAX, MAIN_MIN, addCard, blankDeck, clearTabDraft, copiesOf, copyIndex,
  copyRank, coverLook, coverPlace, fromDoc, isExtraCard, keepTabDraft, keptLook, lookAt, overLimit, removeCard, savedCovers, setCover, setLook,
  setLookAll, shiftCopy, tabDraft,
} from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListPath } from "@/lib/deckListPaths";
import { type DeckHistory, EMPTY_HISTORY, record, redo, undo } from "@/lib/deckHistory";

const BUTTON = "shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-lg font-semibold text-sm transition";
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`;
const SECONDARY = `${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`;
const FIELD = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Making a deck list (/dev/decklists/new) or changing one (/dev/decklists/:code/edit) (덱 구축, 참혈 2026-10-13): its name and
 *  description on top, then the deck, cards going in from the search and coming out when pressed, shown when held or
 *  right-clicked. Members save it to their account (2026-10-14); a guest builds as freely but saves nothing — the
 *  deck waits in the tab while they go to sign in (엘리스: "비로그인이면 사진을 캡처해서 가지는 정도"). Operators only
 *  while it is laid out. Under the name and description one line, its right end telling what keeps the deck from
 *  being played (참혈 2026-10-16). Beside them, up to three 대표 카드 (참혈 2026-10-16): from lg a slot pressed is set
 *  from the deck — the deck's cards pressed go there instead of out — then the next, until the third is set; the
 *  slot pressed again, or 「눌러서 종료」, stops. Below lg the square pressed sets them from the first on, and pressed
 *  again stops. Each copy keeps its own print and finish (참혈 2026-10-16), picked where the card is shown: a copy in
 *  the deck for itself, a card in the search for the next copy 1장 넣기 puts in. */
export default function DeckListEdit() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const location = useLocation();
  const { code } = useParams();   // none on /dev/decklists/new
  const signedIn = isAuthenticated();
  // undefined until read, null when there is no such deck (or not this member's)
  const [deck, setDeck] = useState<DeckDraft | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // the card shown: a copy in the deck (its zone and which copy of the card), or a card from the search
  const [showing, setShowing] = useState<{ card: CardListItem; zone?: DeckZone; copy?: number } | null>(null);
  // the look the next copy of a card shown from the search goes in with
  const [nextLook, setNextLook] = useState<{ id: number; look: CardLook } | null>(null);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [coverSlot, setCoverSlot] = useState<number | null>(null);   // the 대표 카드 slot being set
  // undo / redo of the deck's cards and 대표 카드 (참혈 2026-10-16); Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y outside the boxes
  const [history, setHistory] = useState<DeckHistory>(EMPTY_HISTORY);
  const historyKeys = useRef({ undo: () => {}, redo: () => {} });
  const { cards, order, loading, error, remember, rememberAlts } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);

  useEffect(() => {
    if (!admin) return;
    setHistory(EMPTY_HISTORY);
    if (code === undefined) {
      setDeck(tabDraft() ?? blankDeck());
      return;
    }
    if (!signedIn) {
      setDeck(null);
      return;
    }
    let alive = true;
    getDeckList(code).then((d) => alive && setDeck(fromDoc(d)), () => alive && setDeck(null));
    return () => {
      alive = false;
    };
  }, [admin, code, signedIn]);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;   // a box undoes its own typing
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) historyKeys.current.undo();
      else if ((key === "z" && e.shiftKey) || key === "y") historyKeys.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const closeSheet = useCallback(() => setShowing(null), []);
  // Esc stops setting the 대표 카드 (a card shown takes its own Esc first)
  useEffect(() => {
    if (coverSlot === null || showing) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setCoverSlot(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [coverSlot, showing]);

  if (!admin || deck === undefined) return <div className="min-h-screen" />;

  const say = (text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  };
  // a change to the deck's cards or 대표 카드 can be undone
  const change = (next: DeckDraft) => {
    if (!deck) return;
    setHistory((h) => record(h, deck));
    setDeck(next);
  };
  const step = (move: typeof undo) => {
    if (!deck) return;
    const r = move(history, deck);
    if (!r) return;
    setHistory(r[0]);
    setDeck({ ...deck, ...r[1] });
  };
  historyKeys.current = { undo: () => step(undo), redo: () => step(redo) };
  const pick = (card: CardListItem, look?: CardLook | null) => {
    if (!deck) return;
    remember(card);
    const r = addCard(deck, card, cards, look);
    if ("error" in r) say(r.error);
    else change(r.deck);
  };
  // the copy at `at` out; a copy shown follows its place, as a 대표 카드 does
  const remove = (zone: DeckZone, at: number) => {
    if (!deck || deck[zone][at] === undefined) return;
    const id = deck[zone][at];
    const next = removeCard(deck, zone, at);
    change(next);
    if (showing?.zone === zone && showing.card.id === id && showing.copy !== undefined) {
      const moved = shiftCopy({ id, copy: showing.copy }, id, copyRank(deck[zone], at), next[zone].filter((x) => x === id).length);
      setShowing(moved ? { ...showing, copy: moved.copy } : { card: showing.card });
    }
  };
  // the copy pressed goes in the slot, then the next slot, and done after the third; the copy already there pressed
  // again empties it (참혈 2026-10-16: no 비우기 button)
  const putCover = (zone: DeckZone, at: number) => {
    if (!deck || coverSlot === null) return;
    const pickNow: CoverPick = { id: deck[zone][at], copy: copyRank(deck[zone], at) };
    const was = deck.covers[coverSlot];
    const here = was && coverPlace(deck, was);
    if (here && here.zone === zone && here.at === at) {
      change(setCover(deck, coverSlot, null));
      return;
    }
    change(setCover(deck, coverSlot, pickNow));
    setCoverSlot(coverSlot + 1 < COVERS_MAX ? coverSlot + 1 : null);
  };
  const cancel = () => {
    if (code === undefined) clearTabDraft();
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(code === undefined ? DECK_LISTS_PATH : deckListPath(code));
  };
  const save = async () => {
    if (!deck) return;
    if (!signedIn) {
      keepTabDraft(deck);
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    const body = { name: deck.name.trim(), description: deck.description.trim(), main: deck.main, extra: deck.extra, looks: deck.looks, ...savedCovers(deck) };
    setSaving(true);
    try {
      const saved = code === undefined ? await createDeckList(body) : await updateDeckList(code, body);
      if (code === undefined) clearTabDraft();
      navigate(deckListPath(saved.code), { replace: true });
    } catch (e) {
      say((e as Error).message || "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  // while 대표 카드 are set, each one's number on the copy picked
  const marks = coverSlot === null || !deck ? undefined : (() => {
    const m = { main: new Map<number, number>(), extra: new Map<number, number>() };
    deck.covers.forEach((c, i) => {
      const place = c && coverPlace(deck, c);
      if (place) m[place.zone].set(place.at, i + 1);
    });
    return m;
  })();
  // what keeps the deck from being played, on the line under the name (참혈 2026-10-16)
  const over = deck ? overLimit([...deck.main, ...deck.extra], cards) : [];
  const short = !!deck && deck.main.length < MAIN_MIN;
  // the card shown: a copy in the deck while it is still there (an undo may take it), else as from the search
  const shownZone = showing ? (showing.zone ?? (isExtraCard(showing.card) ? "extra" : "main")) : "main";
  const shownAt = showing?.zone && showing.copy !== undefined && deck ? copyIndex(deck[showing.zone], showing.card.id, showing.copy) : -1;
  const info: CardInfoProps | null = showing && deck ? (() => {
    const { card } = showing;
    const ids = deck[shownZone];
    const copies = ids.filter((x) => x === card.id).length;
    if (shownAt >= 0) {
      const look = lookAt(deck, shownZone, shownAt);
      const same = keptLook(card.id, look);
      return {
        card, inDeck: copiesOf(deck, card.name, cards), look, copies,
        sameLook: ids.every((x, i) => x !== card.id || JSON.stringify(deck.looks[shownZone][i]) === JSON.stringify(same)),
        onLook: (l: CardLook) => change(setLook(deck, shownZone, shownAt, l)),
        onLookAll: () => change(setLookAll(deck, shownZone, card.id, look)),
        onAdd: () => pick(card, look),
        onRemove: () => remove(shownZone, shownAt),
        canRemove: true,
        onFaces: (faces) => rememberAlts(card.id, faces),
      };
    }
    const look = nextLook?.id === card.id ? nextLook.look : { face: card.id, finish: "normal" as const };
    return {
      card, inDeck: copiesOf(deck, card.name, cards), look,
      onLook: (l: CardLook) => setNextLook({ id: card.id, look: l }),
      onAdd: () => pick(card, look),
      // from the search: its last copy put in comes out
      onRemove: () => remove(shownZone, ids.lastIndexOf(card.id)),
      canRemove: copies > 0,
      onFaces: (faces) => rememberAlts(card.id, faces),
    };
  })() : null;
  const showFromDeck = (card: CardListItem, zone: DeckZone, at: number) => deck && setShowing({ card, zone, copy: copyRank(deck[zone], at) });
  const showFromSearch = (card: CardListItem) => {
    setShowing({ card });
    setNextLook(null);
  };

  return (
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
      {deck ? (
        <>
          <div className="h-9 flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold truncate">{code === undefined ? "덱 리스트 만들기" : "덱 리스트 수정"}</h1>
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className={SECONDARY}>취소</button>
              <button type="button" onClick={save} disabled={!deck.name.trim() || saving} className={PRIMARY}>
                {signedIn ? "저장" : "로그인하고 저장"}
              </button>
            </div>
          </div>
          {/* the 대표 카드 on the left, bigger from lg; the name and description take what is left, the description as tall
              as the cards (참혈 2026-10-16) */}
          <div className="mt-3 flex items-stretch gap-3 lg:gap-4">
            <CoverCards
              covers={deck.covers}
              lookOf={(c) => coverLook(deck, c)}
              cards={cards}
              active={coverSlot}
              wide={wide}
              onSlot={(i) => setCoverSlot(coverSlot === i ? null : i)}
              onArea={() => setCoverSlot(coverSlot === null ? 0 : null)}
              onDone={() => setCoverSlot(null)}
            />
            <div className="min-w-0 flex-1 flex flex-col gap-2">
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
                className={`${FIELD} flex-1 min-h-[3.5rem] resize-y`}
              />
            </div>
          </div>
          {/* one line of a fixed height: that a guest saves by signing in on the left, what keeps the deck from being
              played on the right in yellow (참혈 2026-10-16) */}
          <p className="mt-2 mb-0 h-5 flex items-center justify-between gap-3 text-xs whitespace-nowrap overflow-hidden">
            <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{!signedIn && "로그인하면 덱을 저장할 수 있습니다."}</span>
            <span className="shrink-0 flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400" aria-live="polite">
              {/* a phone leaves 메인 덱 out, so a guest's line still fits beside it */}
              {short && <span><span className="hidden sm:inline">메인 덱 </span>{MAIN_MIN}장 이상 필요</span>}
              {over.length > 0 && <span title={over.map((o) => o.line).join("\n")}>금제 초과 {over.length}종</span>}
            </span>
          </p>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {/* From lg the search stands beside the zones, as tall as the two of them (참혈 2026-10-14): it fills its cell
              without making it taller, so the zones alone decide the row's height. */}
          <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch lg:gap-4">
            <DeckZones
              deck={deck}
              cards={cards}
              order={order}
              loading={loading}
              onRemove={coverSlot === null ? remove : putCover}
              onShow={showFromDeck}
              picking={coverSlot !== null}
              marks={marks}
            />
            <div className="lg:relative">
              <CardSearchPanel
                deck={deck}
                cards={cards}
                onPick={(c) => pick(c)}
                onShow={showFromSearch}
                // from lg the card shown takes the search's place, ← 뒤로 bringing the search back as it was (참혈 2026-10-16)
                overlay={wide && info ? <CardInfoPane {...info} onClose={closeSheet} /> : null}
                notice={notice}
                ready={!loading}
                history={{ canUndo: history.past.length > 0, canRedo: history.future.length > 0, onUndo: () => step(undo), onRedo: () => step(redo) }}
              />
            </div>
          </div>
          {!wide && info && <CardInfoSheet {...info} onClose={closeSheet} />}
        </>
      ) : (
        <div className="py-16 flex flex-col items-center gap-4">
          <p className="text-gray-600 dark:text-gray-300">{signedIn ? "덱을 찾을 수 없습니다." : "로그인하면 저장한 덱을 볼 수 있습니다."}</p>
          <Link to={DECK_LISTS_PATH} className={`${BUTTON} bg-blue-600 hover:bg-blue-700 text-white`}>목록으로</Link>
        </div>
      )}
    </div>
  );
}
