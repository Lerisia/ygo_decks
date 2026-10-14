import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { CardListItem } from "@/api/cardDexApi";
import { isAuthenticated } from "@/api/accountApi";
import { createDeckList, getDeckList, updateDeckList } from "@/api/deckListApi";
import CardInfoSheet from "@/components/deckbuilder/CardInfoSheet";
import CardSearchPanel from "@/components/deckbuilder/CardSearchPanel";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useDeckCards } from "@/hooks/useDeckCards";
import {
  type DeckDraft, type DeckZone, addCard, blankDeck, clearTabDraft, copiesOf, deckIssues, fromDoc, isExtraCard, keepTabDraft, removeCard, tabDraft,
} from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListPath } from "@/lib/deckListPaths";

const BUTTON = "shrink-0 inline-flex items-center justify-center h-9 px-4 rounded-lg font-semibold text-sm transition";
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`;
const SECONDARY = `${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`;
const FIELD = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Making a deck list (/decklists/new) or changing one (/decklists/:code/edit) (덱 구축, 참혈 2026-10-13): its name and
 *  description on top, then the deck, cards going in from the search and coming out when pressed, shown when held or
 *  right-clicked. Members save it to their account (2026-10-14); a guest builds as freely but saves nothing — the
 *  deck waits in the tab while they go to sign in (엘리스: "비로그인이면 사진을 캡처해서 가지는 정도"). Operators only
 *  while it is laid out. */
export default function DeckListEdit() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const location = useLocation();
  const { code } = useParams();   // none on /decklists/new
  const signedIn = isAuthenticated();
  // undefined until read, null when there is no such deck (or not this member's)
  const [deck, setDeck] = useState<DeckDraft | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [showing, setShowing] = useState<CardListItem | null>(null);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  const { cards, order, loading, error, remember } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);

  useEffect(() => {
    if (!admin) return;
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
  const closeSheet = useCallback(() => setShowing(null), []);

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
    const body = { name: deck.name.trim(), description: deck.description.trim(), main: deck.main, extra: deck.extra };
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
  const issues = deck && !loading ? deckIssues(deck, cards) : [];

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
              {signedIn ? "" : "로그인하면 덱을 저장할 수 있습니다. "}
              덱의 카드를 누르면 1장씩 빠지고, 길게 누르거나 오른쪽 클릭하면 카드를 볼 수 있습니다.
            </p>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {/* what keeps the deck from being played today, as Master Duel's editor says it (2026-10-14) */}
          {issues.length > 0 && (
            <ul className="mt-3 text-xs text-amber-700 dark:text-amber-400 break-keep space-y-0.5">
              {issues.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          {/* From lg the search stands beside the zones, as tall as the two of them (참혈 2026-10-14): it fills its cell
              without making it taller, so the zones alone decide the row's height. */}
          <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch lg:gap-4">
            <DeckZones deck={deck} cards={cards} order={order} loading={loading} onRemove={remove} onShow={setShowing} />
            <div className="lg:relative">
              <CardSearchPanel deck={deck} cards={cards} onPick={pick} onShow={setShowing} notice={notice} ready={!loading} />
            </div>
          </div>
          {showing && (
            <CardInfoSheet
              card={showing}
              inDeck={copiesOf(deck, showing.name, cards)}
              onAdd={() => pick(showing)}
              onRemove={() => remove(isExtraCard(showing) ? "extra" : "main", showing.id)}
              onClose={closeSheet}
            />
          )}
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
