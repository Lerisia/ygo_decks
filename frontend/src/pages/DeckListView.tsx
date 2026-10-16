import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { deleteDeckList, getDeckList, type DeckListDoc } from "@/api/deckListApi";
import { Pencil, Trash2 } from "lucide-react";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useBanlist } from "@/hooks/useBanlist";
import { useDeckCards } from "@/hooks/useDeckCards";
import { banlistName, banlistTitle } from "@/lib/banlists";
import { MAIN_MIN, coverLook, deckDayLine, fromDoc, notOutCards, overLimit } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListEditPath } from "@/lib/deckListPaths";

const BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";
// 수정 and 삭제 as small bare icons (참혈 2026-10-16)
const ICON = "shrink-0 grid place-items-center w-8 h-8 p-0 border-0 rounded-lg bg-transparent text-gray-500 dark:text-gray-400 transition";

/** A deck list (/dev/decklists/:code): its main and extra decks, each card opening its page, the 금제 it is checked by
 *  and what keeps it from being played under it (덱 구축, 참혈 2026-10-13; from the server 2026-10-14; its 금제
 *  2026-10-16). Its owner's alone for now. Operators only. */
export default function DeckListView() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const signedIn = isAuthenticated();
  // undefined while asked, null when there is no such deck of this member's
  const [deck, setDeck] = useState<DeckListDoc | null | undefined>(undefined);
  const { cards, order, loading, error } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  const { index: banlists, rule } = useBanlist(deck?.banlist || "md");
  useEffect(() => {
    if (!admin) return;
    if (!signedIn) {
      setDeck(null);
      return;
    }
    let alive = true;
    getDeckList(code).then((d) => alive && setDeck(d), () => alive && setDeck(null));
    return () => {
      alive = false;
    };
  }, [admin, code, signedIn]);
  if (!admin || deck === undefined) return <div className="min-h-screen" />;

  const remove = async () => {
    if (!deck || !window.confirm(`'${deck.name}' 덱을 지울까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteDeckList(deck.code);
      navigate(DECK_LISTS_PATH, { replace: true });
    } catch {
      window.alert("덱을 지우지 못했습니다.");
    }
  };

  const draft = deck ? fromDoc(deck) : null;
  const ids = draft ? [...draft.main, ...draft.extra] : [];
  const over = overLimit(ids, cards, rule);
  const later = notOutCards(ids, cards, rule);
  const short = !!draft && draft.main.length < MAIN_MIN;

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <div className="h-8 flex items-center">
        <Link to={DECK_LISTS_PATH} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 내 덱 리스트</Link>
      </div>
      {deck && draft ? (
        <>
          {/* laid out as the edit page is (참혈 2026-10-16): the 대표 카드 set on the left, the name and description beside
              them, 24px down to the deck's part */}
          <div className="mt-3 mb-6 flex items-start gap-3 lg:gap-4">
            {draft.covers.length > 0 && <CoverCards covers={draft.covers} lookOf={(c) => coverLook(draft, c)} cards={cards} />}
            <div className="min-w-0 flex-1">
              {/* the name with its day beside it, 수정 and 삭제 at the end of the same line (참혈 2026-10-16) */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
                  <h1 className="m-0 text-xl leading-8 font-bold break-keep">{deck.name}</h1>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDayLine(draft)}</span>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <Link to={deckListEditPath(deck.code)} aria-label="수정" title="수정" className={`${ICON} hover:text-blue-600 dark:hover:text-blue-400`}>
                    <Pencil className="w-[18px] h-[18px]" aria-hidden />
                  </Link>
                  <button type="button" onClick={remove} aria-label="삭제" title="삭제" className={`${ICON} hover:text-red-600 dark:hover:text-red-400`}>
                    <Trash2 className="w-[18px] h-[18px]" aria-hidden />
                  </button>
                </div>
              </div>
              {deck.description && (
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line break-keep">{deck.description}</p>
              )}
            </div>
          </div>
          {/* the edit page's line: 「금제 | MD • 최신」 on the left, what keeps the deck from being played on the right in
              yellow (참혈 2026-10-16) */}
          <div className="mt-2 h-8 flex items-center gap-2 sm:gap-3 text-xs">
            <span className="min-w-0 shrink truncate tabular-nums text-gray-500 dark:text-gray-400">
              금제<span className="mx-1.5 text-gray-300 dark:text-gray-600" aria-hidden>|</span>
              <span className="font-semibold text-gray-700 dark:text-gray-200" title={banlistTitle(draft.banlist, banlists)}>
                {banlistName(draft.banlist, banlists)}
              </span>
            </span>
            <span
              className="min-w-0 flex-1 flex flex-wrap sm:flex-nowrap items-center content-center justify-end gap-x-2 leading-[14px] font-semibold text-amber-600 dark:text-amber-400"
            >
              {/* a phone leaves 메인 덱 out */}
              {short && <span className="whitespace-nowrap"><span className="hidden sm:inline">메인 덱 </span>{MAIN_MIN}장 이상 필요</span>}
              {over.length > 0 && <span className="whitespace-nowrap" title={over.map((o) => o.line).join("\n")}>금제 초과 {over.length}종</span>}
              {later.length > 0 && <span className="whitespace-nowrap" title={later.map((o) => o.line).join("\n")}>미출시 {later.length}종</span>}
            </span>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-2">
            <DeckZones deck={draft} cards={cards} order={order} loading={loading} rule={rule} />
          </div>
        </>
      ) : (
        <div className="py-16 flex flex-col items-center gap-4">
          <p className="text-gray-600 dark:text-gray-300">{signedIn ? "덱을 찾을 수 없습니다." : "로그인하면 저장한 덱을 볼 수 있습니다."}</p>
          <Link to={DECK_LISTS_PATH} className={BUTTON}>목록으로</Link>
        </div>
      )}
    </div>
  );
}
