import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import type { CardListItem } from "@/api/cardDexApi";
import { isAuthenticated } from "@/api/accountApi";
import { createDeckList, getDeckList, updateDeckList } from "@/api/deckListApi";
import BanlistPicker from "@/components/deckbuilder/BanlistPicker";
import CardInfoSheet, { type CardInfoProps, CardInfoPane } from "@/components/deckbuilder/CardInfoSheet";
import CardSearchPanel from "@/components/deckbuilder/CardSearchPanel";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckPage, { DECK_ICON, DECK_ICON_SIZE, DeckNotFound } from "@/components/deckbuilder/DeckPage";
import SaveLineIcon from "@/components/icons/SaveLineIcon";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useBanlist } from "@/hooks/useBanlist";
import { useDeckCards } from "@/hooks/useDeckCards";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  type CardLook, type CoverPick, type DeckDraft, type DeckZone, COVERS_MAX, addCard, blankDeck, clearTabDraft, copiesOf, copyIndex, copyRank,
  coverLook, coverPlace, deckWarnings, fromDoc, isExtraCard, keepTabDraft, keptLook, lookAt, removeCard, savedCovers, setCover, setLook, setLookAll,
  shiftCopy, tabDraft,
} from "@/lib/deckDrafts";
import { banOf, notOut } from "@/lib/banlists";
import { DECK_LISTS_PATH, deckListPath } from "@/lib/deckListPaths";
import { type DeckHistory, EMPTY_HISTORY, record, redo, undo } from "@/lib/deckHistory";

const GUEST_NOTE = "로그인하면 덱을 저장할 수 있습니다.";
const FIELD = "w-full border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Making a deck list (/dev/decklists/new) or changing one (/dev/decklists/:code/edit) (덱 구축, 참혈 2026-10-13), laid out
 *  as the deck's page through the same parts (DeckPage, 참혈 2026-10-16), 취소 and 저장 as icons where the page has 수정
 *  and 삭제: its name and description on top, then the deck, cards going in from the search and coming out when
 *  pressed, shown when held or right-clicked. Members save it to their account (2026-10-14); a guest builds as freely but saves nothing — the
 *  deck waits in the tab while they go to sign in (엘리스: "비로그인이면 사진을 캡처해서 가지는 정도"). Operators only
 *  while it is laid out. Under the name and description one line: on its left the 금제 the deck is checked by
 *  (참혈 2026-10-16: 마스터 듀얼 / OCG / TCG / 커스텀 and the list), on its right what keeps the deck from being played under
 *  it (참혈 2026-10-16). Beside them, up to three 대표 카드 (참혈 2026-10-16): from lg a slot pressed is set
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
  // the 금제 the deck is checked by (참혈 2026-10-16): its marks, how many may go in, and what it is told
  const { index: banlists, rule } = useBanlist(deck?.banlist ?? "md");

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
    const r = addCard(deck, card, cards, look, rule);
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
    const body = {
      name: deck.name.trim(), description: deck.description.trim(), main: deck.main, extra: deck.extra, looks: deck.looks, banlist: deck.banlist,
      ...savedCovers(deck),
    };
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
  // the card shown: a copy in the deck while it is still there (an undo may take it), else as from the search
  const shownZone = showing ? (showing.zone ?? (isExtraCard(showing.card) ? "extra" : "main")) : "main";
  const shownAt = showing?.zone && showing.copy !== undefined && deck ? copyIndex(deck[showing.zone], showing.card.id, showing.copy) : -1;
  const info: CardInfoProps | null = showing && deck ? (() => {
    const { card } = showing;
    const ids = deck[shownZone];
    // on the deck's 금제; a card from the search knows its release days once the deck holds it
    const judged = { ban: banOf(card, rule), notOut: notOut(cards.get(card.id) ?? card, rule) };
    const copies = ids.filter((x) => x === card.id).length;
    if (shownAt >= 0) {
      const look = lookAt(deck, shownZone, shownAt);
      const same = keptLook(card.id, look);
      return {
        card, ...judged, inDeck: copiesOf(deck, card.name, cards), look, copies,
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
      card, ...judged, inDeck: copiesOf(deck, card.name, cards), look,
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

  const saveLabel = signedIn ? "저장" : "로그인하고 저장";
  const named = !!deck?.name.trim();

  return (
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
      {deck ? (
        <>
          <DeckPage
            top={<h1 className="m-0 shrink-0 text-xl leading-8 font-bold">{code === undefined ? "덱 리스트 만들기" : "덱 리스트 수정"}</h1>}
            // 취소 and 저장 (Remix save-line, gray as 취소) as bare icons on the title's line (참혈 2026-10-16), a guest's note before them
            topEnd={
              <div className="min-w-0 flex items-center gap-2">
                {!signedIn && <p className="m-0 min-w-0 text-right text-[11px] sm:text-xs leading-4 text-gray-500 dark:text-gray-400 break-keep">{GUEST_NOTE}</p>}
                <div className="shrink-0 flex items-center gap-1">
                  <button type="button" onClick={cancel} aria-label="취소" title="취소" className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100`}>
                    <X className={DECK_ICON_SIZE} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!named || saving}
                    aria-label={saveLabel}
                    title={named ? saveLabel : "덱 이름을 넣으면 저장할 수 있습니다"}
                    className={`${DECK_ICON} text-gray-500 dark:text-gray-400 enabled:hover:text-gray-800 dark:enabled:hover:text-gray-100 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed`}
                  >
                    {saving ? <Loader2 className={`${DECK_ICON_SIZE} animate-spin`} aria-hidden /> : <SaveLineIcon className={DECK_ICON_SIZE} />}
                  </button>
                </div>
              </div>
            }
            // the 대표 카드 on the left, bigger from lg; the description as tall as them (참혈 2026-10-16)
            cover={
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
            }
            // a box like the description's, in its size and weight (참혈 2026-10-16)
            name={
              <input
                aria-label="덱 이름"
                placeholder="덱 이름"
                maxLength={40}
                value={deck.name}
                onChange={(e) => setDeck({ ...deck, name: e.target.value })}
                className={`${FIELD} block px-3 py-2 text-base md:text-sm`}
              />
            }
            description={
              <textarea
                aria-label="덱 설명"
                placeholder="덱 설명 (선택)"
                rows={2}
                maxLength={500}
                value={deck.description}
                onChange={(e) => setDeck({ ...deck, description: e.target.value })}
                className={`${FIELD} px-3 py-2 text-base md:text-sm flex-1 min-h-[3.5rem] resize-y`}
              />
            }
            banlist={<BanlistPicker value={deck.banlist} index={banlists} onChange={(banlist) => setDeck({ ...deck, banlist })} />}
            warnings={deckWarnings(deck, cards, rule)}
            error={error}
          >
            {/* From lg the search stands beside the zones, as tall as the two of them (참혈 2026-10-14): it fills its cell
                without making it taller, so the zones decide the row's height — but never below three rows of results
                with the 카드군/서포트 suggestions shown (참혈 2026-10-16). */}
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch lg:gap-4">
              <DeckZones
                deck={deck}
                cards={cards}
                order={order}
                loading={loading}
                rule={rule}
                onRemove={coverSlot === null ? remove : putCover}
                onShow={showFromDeck}
                picking={coverSlot !== null}
                marks={marks}
              />
              <div className="lg:relative lg:min-h-[850px]">
                <CardSearchPanel
                  deck={deck}
                  cards={cards}
                  rule={rule}
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
          </DeckPage>
          {!wide && info && <CardInfoSheet {...info} onClose={closeSheet} />}
        </>
      ) : (
        <DeckNotFound signedIn={signedIn} />
      )}
    </div>
  );
}
