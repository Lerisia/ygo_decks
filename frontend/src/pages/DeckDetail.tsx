import { Suspense, useState, useEffect, useMemo } from "react";
import { lazyChunk } from "@/lib/lazyChunk";
import { Link, useParams } from "react-router-dom";
import { isAuthenticated, canEditDeckBook } from "@/api/accountApi";
import { LazyStatRadar } from "@/components/charts/LazyStatRadar";
import * as Showdown from "showdown";
import DeckNotesSection from "@/components/DeckNotesSection";
import EngineBadge from "@/components/EngineBadge";
import UpdateBadge from "@/components/UpdateBadge";
import DeckHyeolSection from "@/components/DeckHyeolSection";
import BackToDex from "@/components/BackToDex";
import DeckInfoEditModal from "@/components/DeckInfoEditModal";
import StatInfoButton from "@/components/StatInfoButton";

const SimpleMDE = lazyChunk(() => import("@/components/MarkdownEditor"));

interface DeckStats {
  consistency: number;
  breakthrough: number;
  interruption: number;
  recovery: number;
  deck_space: number;
}

interface Deck {
  id: number;
  name: string;
  cover_image: string | null;
  cover_image_detail?: string | null;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  wiki_content: string | null;
  is_engine?: boolean;
  is_upcoming?: boolean;
  play_video_url?: string | null;
  video_count?: number;
  has_hyeol?: boolean;
  /** How many 테마 카드 and 서포트 the card book lists for the deck. */
  card_book?: { member: number; support: number; by_card?: boolean };
  stats?: DeckStats;
}

// 덱 설명 타일 — 설명이 없을 때의 안내도 같은 타일에 담는다
const DESC_TILE =
  "rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-gradient-to-b from-white to-gray-50/50 dark:from-gray-800/50 dark:to-gray-800/30 shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-4 py-4 sm:px-6 sm:py-5";

// 덱 설명 제보(기여하기 → 구글 폼) — 특이점 2026-10-03: 일반 이용자에게는 숨김. 다시 쓰게 되면 true로 바꾸면 된다.
// 운영진의 "설명 수정하기"는 이 값과 상관없이 보인다.
const SHOW_DESCRIPTION_REPORT = false;
// 이 덱의 카드 보기 (덱 문서 → 카드 도감): hidden until the decks' 카드군 links are audited (엘리스 2026-10-12)
const SHOW_CARD_BOOK = false;

// Showdown 설정 - 테이블, 자동 링크, 할 일 목록 등을 지원
const converter = new Showdown.Converter({
  tables: true,
  simplifiedAutoLink: true,
  strikethrough: true,
  tasklists: true,
  simpleLineBreaks: true
});

export default function DeckDetail() {
  const { deckId } = useParams<{ deckId: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [wikiContent, setWikiContent] = useState("");
  const isLoggedIn = useMemo(() => isAuthenticated(), []);
  // staff or an editor
  const [canEdit, setCanEdit] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [descOpen, setDescOpen] = useState(true); // 특이점 요청(2026-10-03): 강의노트·상대법처럼 접을 수 있되 기본은 펼침

  const mdeOptions = useMemo(() => {
    return {
      spellChecker: false,
      minHeight: "300px",
    };
  }, []);

  useEffect(() => {
    fetch(`/api/deck/${deckId}/`)
      .then((res) => res.json())
      .then((data) => {
        setDeck(data);
        setWikiContent(data.wiki_content || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
    
    canEditDeckBook().then(setCanEdit);
  }, [deckId]);

  const handleSave = async () => {
    const response = await fetch(`/api/deck/${deckId}/update_wiki/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      },
      body: JSON.stringify({ wiki_content: wikiContent }),
    });

    if (response.ok) {
      setDeck((prev) => (prev ? { ...prev, wiki_content: wikiContent } : null));
      setEditing(false);
    } else {
      alert("Failed to update deck content.");
    }
  };

  if (loading) return <p className="text-center">Loading...</p>;
  if (!deck) return <p className="text-center">Deck not found</p>;

  return (
    <div className="h-auto min-h-screen w-full mx-auto max-w-4xl px-4 pt-6">
      <BackToDex to="/database" label="덱 도감으로" />
      {/* 
        1) 모바일(기본)에서는 테이블이 먼저, 이어서 본문.
        2) PC(큰 화면)에서는 테이블이 float-right로 뜨며,
           본문 텍스트가 테이블을 비껴가도록.
      */}
      
      {/* 우측(PC) / 상단(모바일) 테이블 섹션 */}
      <div className="w-full lg:w-[320px] overflow-x-auto mb-4 lg:float-right lg:ml-4">
        <table className="w-full border border-gray-300 dark:border-gray-600 text-left">
          <tbody>
            <tr className="border-b">
              <td
                className="p-3 font-extrabold text-center text-2xl bg-gray-200 dark:bg-gray-700"
                colSpan={2}
              >
                {deck.name}
                {deck.is_engine && (
                  <div className="mt-1 text-xs font-normal text-gray-600 dark:text-gray-300 flex items-center justify-center gap-1.5">
                    <EngineBadge className="w-5 h-5 text-[11px]" />
                    <span><span className="font-semibold">Engine</span> — 다양한 덱에 섞어 사용할 수 있는 덱</span>
                  </div>
                )}
                {deck.is_upcoming && (
                  <div className="mt-1 text-xs font-normal text-gray-600 dark:text-gray-300 flex items-center justify-center gap-1.5">
                    <UpdateBadge className="w-5 h-5 text-[11px]" />
                    <span><span className="font-semibold">New</span> — 신규 업데이트 덱</span>
                  </div>
                )}
              </td>
            </tr>
            {deck.cover_image && (
              <tr className="border-b">
                <td className="p-2 text-center" colSpan={2}>
                  <img
                    src={deck.cover_image_detail || deck.cover_image}
                    alt={deck.name}
                    className="w-full max-w-sm mx-auto rounded-lg shadow-md"
                  />
                </td>
              </tr>
            )}
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-32">덱 파워</td>
              <td className="p-2">
                {deck.strength !== "해당 없음" ? deck.strength : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-32">난이도</td>
              <td className="p-2">
                {deck.difficulty !== "해당 없음" ? deck.difficulty : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-32">덱 타입</td>
              <td className="p-2">
                {deck.deck_type !== "해당 없음" ? deck.deck_type : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-32">아트 스타일</td>
              <td className="p-2">
                {deck.art_style !== "해당 없음" ? deck.art_style : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-32">소환법</td>
              <td className="p-2">
                {deck.summoning_methods.filter((m) => m !== "해당 없음").length > 0
                  ? deck.summoning_methods
                      .filter((m) => m !== "해당 없음")
                      .join(", ")
                  : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-24">태그</td>
              <td className="p-2">
                {[...deck.performance_tags, ...deck.aesthetic_tags].length > 0 ? (
                  [...deck.performance_tags, ...deck.aesthetic_tags].join(", ")
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">해당 없음</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <LazyStatRadar stats={deck.stats} height={300} className="mt-4">
          <StatInfoButton className="absolute top-0 right-0 z-20" />
        </LazyStatRadar>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditingInfo(true)}
            className="w-full mt-2 py-2 rounded-lg border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 text-sm font-semibold hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
          >
            ✏️ 덱 정보·스탯 수정
          </button>
        )}
      </div>
      {editingInfo && (
        <DeckInfoEditModal
          deckId={deck.id}
          deckName={deck.name}
          coverUrl={deck.cover_image}
          onClose={() => setEditingInfo(false)}
          onSaved={(updated) => {
            setDeck(updated as unknown as Deck);
            setEditingInfo(false);
            // the deck list stays mounted behind this page; let it pick up the new power/tags
            window.dispatchEvent(new Event("deck-info-changed"));
          }}
        />
      )}
      
      {/* 본문 섹션 */}
      <div className="text-left rounded-lg">
        {/* 이 덱의 카드 보기 is off until the decks' 카드군 links are sorted out (엘리스 2026-10-12); flip SHOW_CARD_BOOK to bring it back */}
        {SHOW_CARD_BOOK && (
        <div className="overflow-hidden mb-4">
          {/* 플레이 영상 보러 가기 is off for now (특이점 2026-10-12); DeckVideosModal and the API stay for its return. */}
          {/* The deck's cards in the card book: its 테마 카드, then the cards supporting them (특이점 2026-10-12) */}
          {deck.card_book && deck.card_book.member + deck.card_book.support > 0 ? (
            <Link
              to={`/cards?deck=${deck.id}`}
              className="flex items-center justify-center gap-2 w-full max-w-sm mx-auto py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:text-gray-900 dark:hover:text-gray-100 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <span aria-hidden="true">🃏</span>
              이 덱의 카드 보기
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 tabular-nums">
                {/* a deck built on a card alone has one list, not a 카드군's 테마 / 서포트 (엘리스 10/12) */}
                {deck.card_book.by_card ? `카드 ${deck.card_book.member}` : `테마 ${deck.card_book.member} · 서포트 ${deck.card_book.support}`}
              </span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="카드 도감 연결 준비 중"
              className="flex items-center justify-center gap-2 w-full max-w-sm mx-auto py-2.5 bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg font-semibold cursor-not-allowed"
            >
              <span aria-hidden="true">🃏</span>
              이 덱의 카드 보기 (준비 중)
            </button>
          )}
        </div>
        )}
        <DeckNotesSection deckId={deck.id} />
        {deck.has_hyeol && <DeckHyeolSection deckId={deck.id} />}
        <section className="mb-5 overflow-hidden">
        <button
          type="button"
          onClick={() => setDescOpen((v) => !v)}
          aria-expanded={descOpen}
          className="w-full flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition"
        >
          <span className="text-base font-bold text-gray-900 dark:text-gray-100">📖 덱 설명</span>
          <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className={`inline-block transition-transform ${descOpen ? "rotate-180" : ""}`}>▾</span>
          </span>
        </button>
        {descOpen && (
        <div className="mt-2">
        {editing ? (
          <>
            {/* react-simplemde-editor로 마크다운 작성 */}
            <Suspense fallback={<div className="h-72 rounded border border-gray-300 dark:border-gray-600" />}>
              <SimpleMDE
                value={wikiContent}
                onChange={val => setWikiContent(val)}
                // ✅ (2) options={mdeOptions}로 전달 (memoized)
                options={mdeOptions}
              />
            </Suspense>

            <div className="flex gap-4 mt-4">
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-green-500 text-white rounded-lg"
              >
                저장하기
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg"
              >
                취소
              </button>
            </div>
          </>
        ) : (
          <>
            {deck.wiki_content ? (
              <>
                {/* 저장된 마크다운을 HTML로 변환 + 렌더링 */}
                <div className={DESC_TILE}>
                  <div
                    className="text-left markdown-content leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: converter.makeHtml(deck.wiki_content),
                    }}
                  />
                </div>
                {SHOW_DESCRIPTION_REPORT && (
                  <p className="text-center text-gray-800 dark:text-gray-200 mt-4">
                    틀린 내용이나 추가할 내용이 있나요?
                  </p>
                )}
              </>
            ) : (
              <>
                <div className={DESC_TILE}>
                  <p className="text-center text-gray-500 dark:text-gray-400">아직 이 덱에 대한 설명이 없습니다.</p>
                </div>
              </>
            )}

            {/* 기여(관리자/로그인) 섹션 */}
            {(canEdit || SHOW_DESCRIPTION_REPORT) && (
            <div className="mt-6 flex justify-center">
              {canEdit ? (
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg"
                >
                  설명 수정하기
                </button>
              ) : isLoggedIn ? (
                <button
                  onClick={() =>
                    (window.location.href = "https://forms.gle/RH8SFgbFgg4o4Bn46")
                  }
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg"
                >
                  기여하기
                </button>
              ) : (
                <p className="text-red-500">
                  덱 설명을 제보하려면 로그인해야 합니다.
                </p>
              )}
            </div>
            )}
          </>
        )}
        </div>
        )}
        </section>
      </div>

      <div className="clear-both" />
    </div>
  );
}
