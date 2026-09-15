import { useState } from "react";
import type { TrackerPendingMatch } from "@/api/trackerPendingApi";
import { getRankLabel } from "@/utils/rankUtils";

type Props = {
  items: TrackerPendingMatch[];
  activeId: number | null;
  onFill: (item: TrackerPendingMatch, oppDeckId?: number) => void;
  onDiscard: (id: number) => void;
};

const fmtTime = (iso: string | null) => (iso ? iso.replace("T", " ").slice(5, 16) : "");

// Games the PC tracker captured; clicking one fills the register form below.
export default function TrackerPendingPanel({ items, activeId, onFill, onDiscard }: Props) {
  const [openCards, setOpenCards] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="mb-4 max-w-2xl w-full mx-auto bg-blue-50 dark:bg-blue-900/20 border-y sm:border border-blue-200 dark:border-blue-800 sm:rounded-xl px-3 py-2 sm:px-4 sm:py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">트래커에서 들어온 게임 {items.length}개</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">누르면 아래 등록 폼에 채워집니다</span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((p) => {
          const isRate = p.game_mode === 19;
          const active = p.id === activeId;
          const badge = (text: string, cls = "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200") => (
            <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{text}</span>
          );
          return (
            <li
              key={p.id}
              className={`rounded-lg border px-3 py-2 bg-white dark:bg-gray-800 ${active ? "border-blue-500" : "border-gray-200 dark:border-gray-700"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-sm">
                  {p.my_name || "나"} vs {p.opp_name || "?"}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {fmtTime(p.ended_at)} · {isRate ? "레이팅" : "랭크"} · {p.turn}턴
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {badge(p.result === "win" ? "승리" : p.result === "lose" ? "패배" : p.result, p.result === "win" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200")}
                {badge(p.coin_win ? "코인 승" : "코인 패")}
                {badge(p.first ? "선공" : "후공")}
                {!isRate && p.rank_code && badge(`${getRankLabel(p.rank_code)}${p.wins != null ? ` · ${p.wins}승` : ""}`)}
                {isRate && p.rating_after != null && badge(`레이팅 ${p.rating_before ?? "?"} → ${p.rating_after}`)}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                내 덱: <b>{p.suggested_deck?.name ?? "판독 실패"}</b>
                {" · "}상대 덱:{" "}
                {p.opp_candidates.length > 0 ? (
                  p.opp_candidates.slice(0, 2).map((c, i) => (
                    <button
                      key={c.deck_id}
                      type="button"
                      onClick={() => onFill(p, c.deck_id)}
                      title={`이 후보로 폼에 채우기${c.share != null ? ` (일치도 ${Math.round(c.share * 100)}%)` : ""}`}
                      className={`mr-1 px-1.5 py-0.5 rounded border text-xs ${
                        i === 0
                          ? "border-blue-400 bg-blue-50 dark:bg-blue-900/40 font-semibold"
                          : "border-gray-300 dark:border-gray-600"
                      }`}
                    >
                      {c.name}
                      {c.is_engine ? " (엔진)" : ""}
                      {c.share != null ? ` ${Math.round(c.share * 100)}%` : ""}
                    </button>
                  ))
                ) : (
                  <b>모름/기타</b>
                )}
                {p.opp_card_names.length > 0 && (
                  <button type="button" className="ml-2 underline" onClick={() => setOpenCards(openCards === p.id ? null : p.id)}>
                    상대가 보여준 카드 {p.opp_card_names.length}장
                  </button>
                )}
              </div>
              {openCards === p.id && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.opp_card_names.map((c) => (
                    <span key={c.id} className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs">
                      {c.name}
                      {c.count > 1 ? ` ×${c.count}` : ""}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => onFill(p)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {active ? "폼에 채워짐" : "폼에 채우기"}
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(p.id)}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  버리기
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
