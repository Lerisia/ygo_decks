import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { isAuthenticated, isAdmin } from "@/api/accountApi";
import SimpleMDE from "react-simplemde-editor";
import "easymde/dist/easymde.min.css";
import * as Showdown from "showdown";

interface Deck {
  id: number;
  name: string;
  cover_image: string | null;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  wiki_content: string | null;
}

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
  const [isAdminUser, setIsAdminUser] = useState(false);

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
    
    isAdmin().then(setIsAdminUser);
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
    <div className="h-auto min-h-screen w-full mx-auto max-w-4xl">
      {/* 
        1) 모바일(기본)에서는 테이블이 먼저, 이어서 본문.
        2) PC(큰 화면)에서는 테이블이 float-right로 뜨며,
           본문 텍스트가 테이블을 비껴가도록.
      */}
      
      {/* 우측(PC) / 상단(모바일) 테이블 섹션 */}
      <div className="w-full lg:w-[320px] overflow-x-auto mb-4 lg:float-right lg:ml-4">
        <table className="w-full border border-gray-300 text-left">
          <tbody>
            <tr className="border-b">
              <td
                className="p-3 font-extrabold text-center text-2xl bg-gray-200"
                colSpan={2}
              >
                {deck.name}
              </td>
            </tr>
            {deck.cover_image && (
              <tr className="border-b">
                <td className="p-2 text-center" colSpan={2}>
                  <img
                    src={deck.cover_image}
                    alt={deck.name}
                    className="w-full max-w-sm mx-auto rounded-lg shadow-md"
                  />
                </td>
              </tr>
            )}
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-32">덱 파워</td>
              <td className="p-2">
                {deck.strength !== "해당 없음" ? deck.strength : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-32">난이도</td>
              <td className="p-2">
                {deck.difficulty !== "해당 없음" ? deck.difficulty : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-32">덱 타입</td>
              <td className="p-2">
                {deck.deck_type !== "해당 없음" ? deck.deck_type : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-32">아트 스타일</td>
              <td className="p-2">
                {deck.art_style !== "해당 없음" ? deck.art_style : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-32">소환법</td>
              <td className="p-2">
                {deck.summoning_methods.filter((m) => m !== "해당 없음").length > 0
                  ? deck.summoning_methods
                      .filter((m) => m !== "해당 없음")
                      .join(", ")
                  : "정보 없음"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-2 font-semibold bg-gray-200 w-24">태그</td>
              <td className="p-2">
                {[...deck.performance_tags, ...deck.aesthetic_tags].filter(
                  (t) => t !== "해당 없음"
                ).length > 0
                  ? [...deck.performance_tags, ...deck.aesthetic_tags]
                      .filter((t) => t !== "해당 없음")
                      .join(", ")
                  : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      {/* 본문 섹션 */}
      <div className="text-left rounded-lg">
        {editing ? (
          <>
            {/* react-simplemde-editor로 마크다운 작성 */}
            <SimpleMDE
              value={wikiContent}
              onChange={val => setWikiContent(val)}
              // ✅ (2) options={mdeOptions}로 전달 (memoized)
              options={mdeOptions}
            />

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
                <div
                  className="text-left markdown-content"
                  dangerouslySetInnerHTML={{
                    __html: converter.makeHtml(deck.wiki_content),
                  }}
                />
                <p className="text-center text-gray-800 mt-4">
                  틀린 내용이나 추가할 내용이 있나요?
                </p>
              </>
            ) : (
              <>
                <p className="text-center text-gray-800">
                  아직 이 덱에 대한 설명이 없습니다.
                </p>
              </>
            )}

            {/* 기여(관리자/로그인) 섹션 */}
            <div className="mt-6 flex justify-center">
              {isAdminUser ? (
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
          </>
        )}
      </div>

      <div className="clear-both" />
    </div>
  );
}
