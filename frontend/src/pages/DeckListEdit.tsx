import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import type { CardListItem } from "@/api/cardDexApi";
import { isAuthenticated } from "@/api/accountApi";
import { createDeckList, getDeckList, updateDeckList } from "@/api/deckListApi";
import Dropdown from "@/components/Dropdown";
import BanlistPicker from "@/components/deckbuilder/BanlistPicker";
import CardInfoSheet, { type CardInfoProps, CardInfoPane } from "@/components/deckbuilder/CardInfoSheet";
import CardSearchPanel from "@/components/deckbuilder/CardSearchPanel";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckPage, { DECK_ICON, DECK_ICON_SIZE, DeckNotFound } from "@/components/deckbuilder/DeckPage";
import ResetLeftLineIcon from "@/components/icons/ResetLeftLineIcon";
import SaveLineIcon from "@/components/icons/SaveLineIcon";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useBanlist } from "@/hooks/useBanlist";
import { useDeckCards } from "@/hooks/useDeckCards";
import type { ScanFound } from "@/hooks/useImageScan";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  type CardLook, type CoverPick, type DeckDraft, type DeckZone, COVERS_MAX, addCard, addCards, blankDeck, clearTabDraft, copiesOf, copyIndex,
  copyRank, coverLook, coverPlace, deckWarnings, fromDoc, isExtraCard, keepTabDraft, keptLook, lookAt, removeCard, savedCovers, setCover,
  setLook, setLookAll, shiftCopy, tabDraft,
} from "@/lib/deckDrafts";
import { banOf, notOut, unreleasedUnder } from "@/lib/banlists";
import { DECK_LISTS_PATH, deckListPath } from "@/lib/deckListPaths";
import { type DeckHistory, EMPTY_HISTORY, record, redo, undo } from "@/lib/deckHistory";
import { cardFrom } from "@/lib/deckMotion";
import { deckSoundOn, playDeckMove, playDeckSound, setDeckSoundOn, unlockDeckSound } from "@/lib/deckSound";

const GUEST_NOTE = "로그인하면 덱을 올릴 수 있습니다.";
// who may see the deck (엘리스 2026-10-17): everyone on the board, or its author alone
const SCOPES = [
  { value: "public", label: "공개", title: "게시판에 올라가 누구나 봅니다" },
  { value: "private", label: "비공개", title: "나만 봅니다" },
] as const;
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
  // the game's deck editor sounds (엘리스 2026-10-18), off and on at the title's line, remembered
  const [sound, setSound] = useState(deckSoundOn);
  // a picture of a deck list asked for (the empty deck's big button, the board's 사진으로 올리기 = ?photo=1): the search
  // opens its picture search and asks for the file at once (엘리스 2026-10-18)
  const [picture, setPicture] = useState(0);
  const askPicture = () => setPicture((n) => n + 1);
  const photoAsked = useRef(false);
  useEffect(() => {
    if (photoAsked.current || !deck || code !== undefined || !new URLSearchParams(location.search).has("photo")) return;
    photoAsked.current = true;
    askPicture();
  }, [deck, code, location.search]);
  // the deck as saved (a new one: empty), which 초기화 brings back (참혈 2026-10-16)
  const saved = useRef<DeckDraft | null>(null);
  const historyKeys = useRef({ undo: () => {}, redo: () => {} });
  const { cards, order, loading, error, remember, rememberAlts } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  // the 금제 the deck is checked by (참혈 2026-10-16): its marks, how many may go in, and what it is told
  const { index: banlists, rule } = useBanlist(deck?.banlist ?? "md");

  useEffect(() => {
    if (!admin) return;
    setHistory(EMPTY_HISTORY);
    if (code === undefined) {
      saved.current = blankDeck();
      setDeck(tabDraft() ?? structuredClone(saved.current));
      return;
    }
    if (!signedIn) {
      setDeck(null);
      return;
    }
    let alive = true;
    getDeckList(code).then((d) => {
      if (!alive) return;
      saved.current = fromDoc(d);
      setDeck(structuredClone(saved.current));
    }, () => alive && setDeck(null));
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
  const closeSheet = useCallback(() => {
    setShowing((was) => {
      if (was) playDeckSound("close", 0.6);
      return null;
    });
  }, []);
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
  // from: the tile pressed, for the card to fly from it (none: it grows in its place)
  const pick = (card: CardListItem, look?: CardLook | null, from?: Element) => {
    if (!deck) return;
    remember(card);
    const r = addCard(deck, card, cards, look);
    if ("error" in r) return say(r.error);
    cardFrom(from ?? null);
    change(r.deck);
    playDeckMove();
  };
  // 전체 투입: every card the picture held, as one change (one undo); those left out said (참혈 2026-10-17)
  const pickAll = (picks: ScanFound[]) => {
    if (!deck) return;
    picks.forEach(({ card }) => remember(card));
    const r = addCards(deck, picks, cards);
    if (r.added) {
      change(r.deck);
      playDeckMove();
    }
    if (r.left) say(`${r.left}장은 넣지 못했습니다 · ${r.why}`);
  };
  // the copy at `at` out; a copy shown follows its place, as a 대표 카드 does
  const remove = (zone: DeckZone, at: number) => {
    if (!deck || deck[zone][at] === undefined) return;
    const id = deck[zone][at];
    const next = removeCard(deck, zone, at);
    change(next);
    playDeckMove();
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
  // ← 뒤로 leaves without saving, as 취소 did (참혈 2026-10-16)
  const leave = () => {
    playDeckSound("cancel", 0.6);
    if (code === undefined) clearTabDraft();
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(code === undefined ? DECK_LISTS_PATH : deckListPath(code));
  };
  const changed = !!deck && !!saved.current && JSON.stringify(deck) !== JSON.stringify(saved.current);
  // 초기화: every change since it was saved (or, new, since it was empty) goes, undo included (참혈 2026-10-16)
  const reset = () => {
    if (!changed || !saved.current) return;
    if (!window.confirm(code === undefined ? "만든 내용을 모두 지울까요?" : "수정한 내용을 지우고 저장된 상태로 되돌릴까요?")) return;
    playDeckSound("cancel", 0.6);
    if (code === undefined) clearTabDraft();
    setDeck(structuredClone(saved.current));
    setHistory(EMPTY_HISTORY);
    setCoverSlot(null);
    setShowing(null);
    setNextLook(null);
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
      ...savedCovers(deck), is_private: deck.isPrivate,
    };
    setSaving(true);
    playDeckSound("decide", 0.7);
    try {
      const saved = code === undefined ? await createDeckList(body) : await updateDeckList(code, body);
      playDeckSound("verify", 0.6);
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
    const judged = { ban: banOf(card, rule), notOut: notOut(cards.get(card.id) ?? card, rule), unreleased: unreleasedUnder(card, rule) };
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
  const showFromDeck = (card: CardListItem, zone: DeckZone, at: number) => {
    if (!deck) return;
    playDeckSound("open", 0.6);
    setShowing({ card, zone, copy: copyRank(deck[zone], at) });
  };
  const showFromSearch = (card: CardListItem) => {
    playDeckSound("open", 0.6);
    setShowing({ card });
    setNextLook(null);
  };
  const toggleSound = () => {
    const on = !sound;
    setDeckSoundOn(on);
    setSound(on);
    if (on) playDeckSound("decide", 0.7);
  };

  const saveLabel = signedIn ? "저장" : "로그인하고 저장";
  const named = !!deck?.name.trim();

  return (
    // any press opens the sound within it, so the sounds that follow play on a phone too
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6" onPointerDownCapture={() => unlockDeckSound()}>
      {deck ? (
        <>
          <DeckPage
            back={
              <button type="button" onClick={leave} className="p-0 border-0 bg-transparent text-sm text-blue-600 dark:text-blue-400 hover:underline">
                ← 뒤로
              </button>
            }
            top={<h1 className="m-0 shrink-0 text-xl leading-8 font-bold">{code === undefined ? "덱 리스트 만들기" : "덱 리스트 수정"}</h1>}
            // 초기화 (Remix reset-left-line) and 저장 (save-line) as bare gray icons on the title's line (참혈 2026-10-16), a
            // guest's note before them
            topEnd={
              <div className="min-w-0 flex items-center gap-2">
                {!signedIn && <p className="m-0 min-w-0 text-right text-[11px] sm:text-xs leading-4 text-gray-500 dark:text-gray-400 break-keep">{GUEST_NOTE}</p>}
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleSound}
                    aria-pressed={sound}
                    aria-label={sound ? "효과음 끄기" : "효과음 켜기"}
                    title={sound ? "효과음 끄기" : "효과음 켜기"}
                    className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100`}
                  >
                    {sound ? <Volume2 className={DECK_ICON_SIZE} aria-hidden /> : <VolumeX className={DECK_ICON_SIZE} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={!changed}
                    aria-label="초기화"
                    title={changed ? (code === undefined ? "초기화: 만든 내용을 모두 지웁니다" : "초기화: 저장된 상태로 되돌립니다") : "바뀐 내용이 없습니다"}
                    className={`${DECK_ICON} text-gray-500 dark:text-gray-400 enabled:hover:text-gray-800 dark:enabled:hover:text-gray-100 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed`}
                  >
                    <ResetLeftLineIcon className={DECK_ICON_SIZE} />
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!named || saving}
                    aria-label={saveLabel}
                    title={named ? saveLabel : "덱 이름을 넣으면 올릴 수 있습니다"}
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
              <>
                <textarea
                  aria-label="덱 설명"
                  placeholder="덱 설명 (선택)"
                  rows={2}
                  maxLength={2000}
                  value={deck.description}
                  onChange={(e) => setDeck({ ...deck, description: e.target.value })}
                  className={`${FIELD} px-3 py-2 text-base md:text-sm flex-1 min-h-[3.5rem] resize-y`}
                />
                {/* 공개 or 비공개 under the description, at the line's end (엘리스 2026-10-17) */}
                <div className="mt-2 h-6 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="ml-auto shrink-0">
                    <Dropdown
                      value={deck.isPrivate ? "private" : "public"}
                      options={[...SCOPES]}
                      onChange={(v) => setDeck({ ...deck, isPrivate: v === "private" })}
                      label="공개 범위"
                      className="h-6 px-2 rounded-md text-xs"
                      listClassName="text-xs"
                    />
                  </span>
                </div>
              </>
            }
            banlist={<BanlistPicker value={deck.banlist} index={banlists} onChange={(banlist) => setDeck({ ...deck, banlist })} />}
            warnings={deckWarnings(deck, cards, rule)}
            error={error}
          >
            {/* From lg the search stands beside the zones, as tall as the two of them (참혈 2026-10-14): it fills its cell
                without making it taller, so the zones decide the row's height — but never below three rows of results
                (참혈 2026-10-16; the 카드군/서포트 suggestions, when shown, push them down and the rest scroll). */}
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch lg:gap-4">
              <DeckZones
                deck={deck}
                cards={cards}
                order={order}
                loading={loading}
                rule={rule}
                onRemove={coverSlot === null ? remove : putCover}
                onShow={showFromDeck}
                onDrop={coverSlot === null ? (c) => pick(c) : undefined}
                onPicture={coverSlot === null ? askPicture : undefined}
                picking={coverSlot !== null}
                marks={marks}
              />
              <div className="lg:relative lg:min-h-[645px]">
                <CardSearchPanel
                  deck={deck}
                  cards={cards}
                  rule={rule}
                  onPick={(c, from) => pick(c, undefined, from)}
                  onPickAll={pickAll}
                  onShow={showFromSearch}
                  onDropOut={coverSlot === null ? remove : undefined}
                  picture={picture}
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
