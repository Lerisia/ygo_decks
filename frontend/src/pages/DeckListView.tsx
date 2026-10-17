import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isAuthenticated } from "@/api/accountApi";
import { type DeckListDoc, deleteDeckList, getDeckList, likeDeckList } from "@/api/deckListApi";
import { Eye, Heart, Pencil, Trash2 } from "lucide-react";
import CoverCards from "@/components/deckbuilder/CoverCards";
import DeckAuthor from "@/components/deckbuilder/DeckAuthor";
import DeckComments from "@/components/deckbuilder/DeckComments";
import DeckPage, { DECK_ICON, DECK_ICON_SIZE, DeckNotFound } from "@/components/deckbuilder/DeckPage";
import DeckZones from "@/components/deckbuilder/DeckZones";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { useBanlist } from "@/hooks/useBanlist";
import { useDeckCards } from "@/hooks/useDeckCards";
import { banlistName, banlistTitle } from "@/lib/banlists";
import { coverLook, deckDayLine, deckWarnings, fromDoc } from "@/lib/deckDrafts";
import { DECK_LISTS_PATH, deckListEditPath } from "@/lib/deckListPaths";

// 추천 with its count beside the heart, in a row (DECK_ICON is a grid, which would stack them)
const LIKE_BUTTON = "shrink-0 inline-flex items-center gap-1 h-8 px-1.5 border-0 rounded-lg bg-transparent text-sm tabular-nums transition-colors";
const FOOT_BUTTON = "shrink-0 h-8 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors";

/** A deck list on the board (/dev/decklists/:code): who posted it, its main and extra decks, each card opening its
 *  page, the 금제 it is checked by and what keeps it from being played under it (덱 구축, 참혈 2026-10-13; from the
 *  server 2026-10-14; its 금제 2026-10-16), the 도감 deck it is filed under, 추천 and the comments (엘리스 2026-10-17:
 *  every deck list is a post on the board). Anyone reads it; 수정·삭제 are the author's. Operators only while the
 *  pages are laid out. */
export default function DeckListView() {
  const admin = useAdminOnly();
  const navigate = useNavigate();
  const location = useLocation();
  const { code = "" } = useParams();
  const signedIn = isAuthenticated();
  // undefined while asked, null when there is no such deck
  const [deck, setDeck] = useState<DeckListDoc | null | undefined>(undefined);
  const [liking, setLiking] = useState(false);
  const { cards, order, loading, error } = useDeckCards(deck ? [...deck.main, ...deck.extra] : null);
  const { index: banlists, rule } = useBanlist(deck?.banlist || "md");
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    getDeckList(code).then((d) => alive && setDeck(d), () => alive && setDeck(null));
    return () => {
      alive = false;
    };
  }, [admin, code]);
  if (!admin || deck === undefined) return <div className="min-h-screen" />;

  const remove = async () => {
    if (!deck || !window.confirm(`'${deck.name}' 덱 리스트를 지울까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteDeckList(deck.code);
      navigate(DECK_LISTS_PATH, { replace: true });
    } catch {
      window.alert("덱 리스트를 지우지 못했습니다.");
    }
  };
  // 추천 on or off; a guest goes to sign in and comes back here
  const like = async () => {
    if (!deck || liking) return;
    if (!signedIn) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setLiking(true);
    try {
      const r = await likeDeckList(deck.code);
      setDeck({ ...deck, liked: r.liked, like_count: r.like_count });
    } catch (e) {
      window.alert((e as Error).message || "추천하지 못했습니다.");
    } finally {
      setLiking(false);
    }
  };

  const draft = deck ? fromDoc(deck) : null;
  const liked = !!deck?.liked;

  return (
    <div className="min-h-screen w-full max-w-6xl mx-auto px-4 py-6">
      {deck && draft ? (
        // laid out as the editor, through the same parts (참혈 2026-10-16)
        <DeckPage
          back={<Link to={DECK_LISTS_PATH} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 덱리 게시판</Link>}
          cover={draft.covers.length > 0 && <CoverCards covers={draft.covers} lookOf={(c) => coverLook(draft, c)} cards={cards} />}
          name={
            // its day beside it (참혈 2026-10-16)
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h1 className="m-0 text-xl leading-8 font-bold break-keep">{deck.name}</h1>
              <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{deckDayLine(draft)}</span>
            </div>
          }
          // 추천 for everyone but the author; 수정·삭제 the author's (삭제 an operator's too)
          actions={
            <>
              {!deck.mine && (
                <button
                  type="button"
                  onClick={like}
                  disabled={liking}
                  aria-pressed={liked}
                  aria-label={liked ? "추천 취소" : "추천"}
                  title={liked ? "추천 취소" : "추천"}
                  className={`${LIKE_BUTTON} ${liked ? "text-red-500" : "text-gray-500 dark:text-gray-400 hover:text-red-500"}`}
                >
                  <Heart className={DECK_ICON_SIZE} fill={liked ? "currentColor" : "none"} aria-hidden />
                  {deck.like_count ?? 0}
                </button>
              )}
              {deck.mine && (
                <Link to={deckListEditPath(deck.code)} aria-label="수정" title="수정" className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400`}>
                  <Pencil className={DECK_ICON_SIZE} aria-hidden />
                </Link>
              )}
              {(deck.mine || admin) && (
                <button type="button" onClick={remove} aria-label="삭제" title="삭제" className={`${DECK_ICON} text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400`}>
                  <Trash2 className={DECK_ICON_SIZE} aria-hidden />
                </button>
              )}
            </>
          }
          // who posted it, with how many liked it (the author's own view) and opened it, over the description
          description={
            <>
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                {deck.author && <DeckAuthor author={deck.author} size={24} className="text-sm text-gray-800 dark:text-gray-100" />}
                {deck.mine && (
                  <span className="inline-flex items-center gap-1 tabular-nums"><Heart className="w-3.5 h-3.5" aria-hidden />{deck.like_count ?? 0}</span>
                )}
                <span className="inline-flex items-center gap-1 tabular-nums" title="조회"><Eye className="w-3.5 h-3.5" aria-hidden />{deck.view_count ?? 0}</span>
              </div>
              {deck.description && <p className="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line break-keep">{deck.description}</p>}
            </>
          }
          // 「마스터 듀얼 • 최신」 alone as the editor has it, its day in the title (참혈 2026-10-16)
          banlist={
            <span className="min-w-0 truncate font-semibold text-gray-700 dark:text-gray-200" title={banlistTitle(draft.banlist, banlists)}>
              {banlistName(draft.banlist, banlists)}
            </span>
          }
          warnings={deckWarnings(draft, cards, rule)}
          error={error}
        >
          <DeckZones deck={draft} cards={cards} order={order} loading={loading} rule={rule} />
          {/* under the deck: the 도감 deck it is filed under and 덱 코드 on the left, the exports on the right (참혈 2026-10-17; the
              export buttons alone for now) — on a phone the exports drop to a second line, still at the right */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="shrink-0 flex items-center gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              <span className="shrink-0">분류</span>
              {deck.deck ? (
                <Link to={`/database/${deck.deck.id}`} className="max-w-[10rem] truncate font-semibold text-gray-800 dark:text-gray-100 hover:underline">{deck.deck.name}</Link>
              ) : (
                <span>없음</span>
              )}
              <button type="button" className={FOOT_BUTTON}>덱 코드</button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className={FOOT_BUTTON}>이미지로 내보내기</button>
              <button type="button" className={FOOT_BUTTON}>목록으로 내보내기</button>
            </div>
          </div>
          <DeckComments
            code={deck.code}
            comments={deck.comments ?? []}
            admin={admin}
            signedIn={signedIn}
            next={location.pathname}
            onChange={(comments) => setDeck({ ...deck, comments, comment_count: comments.length })}
          />
        </DeckPage>
      ) : (
        <DeckNotFound signedIn={signedIn} message="덱 리스트를 찾을 수 없습니다." />
      )}
    </div>
  );
}
