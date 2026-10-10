import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type CardDoc, type CardTexts, getCard } from "@/api/cardDexApi";

const LABEL = "p-2 font-semibold bg-gray-200 dark:bg-gray-700 w-28 align-top";
const MARKERS = ["top_left", "top", "top_right", "left", "", "right", "bottom_left", "bottom", "bottom_right"];
const ARROWS: Record<string, string> = {
  top_left: "↖", top: "↑", top_right: "↗", left: "←", right: "→", bottom_left: "↙", bottom: "↓", bottom_right: "↘",
};

const day = (d: string | null) => (d ? d.replace(/-/g, ".") : "");

function LinkMarkers({ on }: { on: string[] }) {
  return (
    <div className="inline-grid grid-cols-3 gap-0.5" aria-label={`링크 마커 ${on.length}개`}>
      {MARKERS.map((m, i) =>
        m ? (
          <span
            key={m}
            className={`w-6 h-6 flex items-center justify-center rounded text-xs ${
              on.includes(m) ? "bg-red-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
            }`}
          >
            {ARROWS[m]}
          </span>
        ) : (
          <span key={i} className="w-6 h-6" />
        ),
      )}
    </div>
  );
}

function TextBlock({ t, pendulum }: { t: CardTexts; pendulum: boolean }) {
  if (!t) return <p className="text-gray-500 dark:text-gray-400">효과문이 없습니다.</p>;
  return (
    <div className="flex flex-col gap-3 whitespace-pre-line leading-relaxed">
      {t.pendulum_effect && (
        <div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">펜듈럼 효과</p>
          <p>{t.pendulum_effect}</p>
        </div>
      )}
      {(t.materials || t.effect) && (
        <div>
          {pendulum && t.pendulum_effect && <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">몬스터 효과</p>}
          {t.materials && <p className="font-medium">{t.materials}</p>}
          {t.effect && <p>{t.effect}</p>}
        </div>
      )}
      {t.flavor && <p className="italic text-gray-600 dark:text-gray-300">{t.flavor}</p>}
    </div>
  );
}

function Skeleton() {
  const bar = "rounded bg-gray-200 dark:bg-gray-700 animate-pulse";
  return (
    <div className="h-auto min-h-screen w-full max-w-4xl mx-auto px-4 py-4">
      <div className="md:flex md:gap-6">
        <div className="md:w-80 shrink-0">
          <div className={`w-full aspect-[704/1024] ${bar} rounded-xl`} />
        </div>
        <div className="flex-1 mt-4 md:mt-0 flex flex-col gap-2">
          <div className={`h-8 w-2/3 ${bar}`} />
          <div className={`h-4 w-1/2 ${bar}`} />
          <div className={`h-4 w-1/3 ${bar}`} />
          <div className={`mt-2 h-48 w-full ${bar}`} />
        </div>
      </div>
      <div className={`mt-6 h-6 w-20 ${bar}`} />
      <div className={`mt-3 h-24 w-full ${bar}`} />
    </div>
  );
}

/** 카드 도감 document: picture (the Korean card face, or the illustration and other Master Duel arts), names, stats, effect text,
 *  the card's 카드군 (each opens the card list filtered to it) and the decks those 카드군 are linked to. */
export default function CardDetail() {
  const { cardId } = useParams();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [error, setError] = useState("");
  const [art, setArt] = useState<string | null>(null);
  const [showFace, setShowFace] = useState(true);
  const [ja, setJa] = useState(false);

  useEffect(() => {
    let alive = true;
    setCard(null);
    setError("");
    setShowFace(true);
    setJa(false);
    getCard(cardId ?? "")
      .then((c) => {
        if (!alive) return;
        setCard(c);
        setArt(c.image_url || c.thumb_url);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [cardId]);

  if (error) {
    return (
      <div className="min-h-screen px-4 py-16 text-center">
        <p className="mb-4">{error}</p>
        <Link to="/cards" className="text-blue-600 dark:text-blue-400 underline">카드 목록으로</Link>
      </div>
    );
  }
  if (!card) return <Skeleton />;

  const pendulum = card.pendulum_scale !== null && card.pendulum_scale !== undefined;
  const isLink = card.frame === "link";
  const texts = ja && card.texts.ja ? card.texts.ja : card.texts.ko;
  const dates = [["OCG", card.dates.ocg], ["한국", card.dates.kr], ["TCG", card.dates.tcg]].filter(([, d]) => d);
  const arts = [card.image_url, ...card.alt_arts].filter((u): u is string => !!u);

  return (
    <div className="h-auto min-h-screen w-full max-w-4xl mx-auto px-4 py-4">
      <div className="md:flex md:gap-6">
        <div className="md:w-80 shrink-0">
          {showFace && card.face_url ? (
            <img src={card.face_url} alt={`${card.name} 카드`} className="w-full aspect-[704/1024] object-contain" />
          ) : (
            <img src={art || "/default_cover.png"} alt={card.name} className="w-full aspect-square object-cover rounded-xl bg-gray-100 dark:bg-gray-800" />
          )}
          {card.face_url && (
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-gray-200 dark:bg-gray-700 p-1 text-sm font-semibold">
              {([["카드", true], ["일러스트", false]] as const).map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setShowFace(value)}
                  className={`py-1.5 rounded-md transition ${
                    showFace === value ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!(showFace && card.face_url) && arts.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {arts.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setArt(u)}
                  className={`w-12 h-12 rounded-md overflow-hidden ring-2 transition ${art === u ? "ring-blue-600" : "ring-transparent"}`}
                  aria-label={i === 0 ? "기본 일러스트" : `다른 일러스트 ${i}`}
                >
                  <img src={u} alt="" loading="lazy" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 mt-4 md:mt-0">
          <h1 className="text-2xl font-extrabold break-keep">{card.name_ko || card.name}</h1>
          {card.name_ja && <p className="mt-1 text-gray-700 dark:text-gray-200">{card.name_ja}</p>}
          {card.name_ja_ruby && card.name_ja_ruby !== card.name_ja && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.name_ja_ruby}</p>
          )}
          {card.name_en && <p className="text-sm text-gray-500 dark:text-gray-400">{card.name_en}</p>}

          <table className="mt-3 w-full border border-gray-300 dark:border-gray-600 text-left text-sm">
            <tbody>
              <tr className="border-b border-gray-300 dark:border-gray-600">
                <td className={LABEL}>종류</td>
                <td className="p-2">{card.type_line}</td>
              </tr>
              {card.category === "monster" && (
                <>
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <td className={LABEL}>속성</td>
                    <td className="p-2">{card.attribute || "-"}</td>
                  </tr>
                  {card.level_label && (
                    <tr className="border-b border-gray-300 dark:border-gray-600">
                      <td className={LABEL}>{card.level_label.split(" ")[0]}</td>
                      <td className="p-2">{card.level_label.split(" ")[1]}</td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <td className={LABEL}>{isLink ? "공격력" : "공격력 / 수비력"}</td>
                    <td className="p-2 tabular-nums">{isLink ? card.atk ?? "-" : `${card.atk ?? "-"} / ${card.def ?? "-"}`}</td>
                  </tr>
                  {pendulum && (
                    <tr className="border-b border-gray-300 dark:border-gray-600">
                      <td className={LABEL}>펜듈럼 스케일</td>
                      <td className="p-2">{card.pendulum_scale}</td>
                    </tr>
                  )}
                  {isLink && (
                    <tr className="border-b border-gray-300 dark:border-gray-600">
                      <td className={LABEL}>링크 마커</td>
                      <td className="p-2"><LinkMarkers on={card.link_markers} /></td>
                    </tr>
                  )}
                </>
              )}
              {card.rarity && (
                <tr className="border-b border-gray-300 dark:border-gray-600">
                  <td className={LABEL}>마듀 레어도</td>
                  <td className="p-2">{card.rarity}</td>
                </tr>
              )}
              {dates.length > 0 && (
                <tr>
                  <td className={LABEL}>출시일</td>
                  <td className="p-2 tabular-nums">
                    {dates.map(([label, d]) => <div key={label}>{label} {day(d)}</div>)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">효과</h2>
          {card.texts.ja && (
            <button
              type="button"
              onClick={() => setJa(!ja)}
              className="px-3 py-1 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              {ja ? "한국어" : "일본어 원문"}
            </button>
          )}
        </div>
        <div className="rounded-lg border border-gray-300 dark:border-gray-600 p-3">
          <TextBlock t={texts} pendulum={pendulum} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold mb-2">카드군</h2>
        {card.groups.length ? (
          <div className="flex flex-wrap gap-2">
            {card.groups.map((g) => (
              <Link
                key={g.id}
                to={`/cards?group=${g.id}`}
                className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-600 hover:text-white transition"
              >
                {g.name}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">속한 카드군이 없습니다.</p>
        )}
      </section>

      {card.decks.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold mb-2">이 카드를 쓰는 덱</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {card.decks.map((d) => (
              <Link key={d.id} to={`/database/${d.id}`} className="text-center">
                <img
                  src={d.cover || "/default_cover.png"}
                  alt={d.name}
                  loading="lazy"
                  className="w-full h-20 md:h-auto md:aspect-[4/3] object-cover rounded-lg"
                />
                <p className="mt-1 text-sm">{d.name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
