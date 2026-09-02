import { useEffect, useState } from "react";
import CardSearchModal, { type CardSearchResult } from "@/components/CardSearchModal";
import {
  addDeckCard, getDeck, removeDeckCard, uploadDeck,
  type DeckSubmission, type Entrant,
} from "@/api/tournamentApi";

const btn = "px-3 py-1.5 text-sm rounded-lg font-semibold transition disabled:opacity-50";
const blueBtn = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const grayBtn = `${btn} bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`;

type Props = {
  tournamentId: number;
  myEntrant: Entrant | undefined;
  isHost: boolean;
  entrants: Entrant[];
  recruiting: boolean;
};

export default function DeckTab({ tournamentId, myEntrant, isHost, entrants, recruiting }: Props) {
  const [viewEntrantId, setViewEntrantId] = useState<number | null>(myEntrant?.id ?? null);
  const [deck, setDeck] = useState<DeckSubmission | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const isOwnView = viewEntrantId !== null && viewEntrantId === myEntrant?.id;
  const canEdit = isOwnView && recruiting && !!myEntrant;

  const load = async (entrantId: number | null) => {
    setError(""); setNotFound(false);
    if (entrantId === null) { setDeck(null); return; }
    try {
      setDeck(await getDeck(tournamentId, entrantId === myEntrant?.id ? undefined : entrantId));
    } catch (e) {
      setDeck(null);
      if (e instanceof Error && e.message.includes("제출된 덱이 없습니다")) setNotFound(true);
      else setError(e instanceof Error ? e.message : "덱을 불러오지 못했습니다.");
    }
  };

  useEffect(() => { load(viewEntrantId); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [viewEntrantId, tournamentId]);

  const act = async (fn: () => Promise<DeckSubmission | { ok: boolean }>) => {
    setBusy(true); setError("");
    try {
      const res = await fn();
      if ("cards" in res) setDeck(res); else await load(viewEntrantId);
      setNotFound(false);
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
    finally { setBusy(false); }
  };

  if (!myEntrant && !isHost) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">참가자만 덱을 제출할 수 있습니다.</p>;
  }

  const viewable = entrants.filter((e) => e.status === "registered" || e.status === "checked_in");

  return (
    <div>
      {isHost && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-500 dark:text-gray-400">열람 대상</label>
          <select
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100"
            value={viewEntrantId ?? ""}
            onChange={(e) => setViewEntrantId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">선택</option>
            {viewable.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.id === myEntrant?.id ? " (나)" : ""}</option>
            ))}
          </select>
        </div>
      )}

      {canEdit && (
        <div className="mb-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <p className="text-sm font-semibold mb-1">덱 스크린샷 제출</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            마스터듀얼 덱 화면 스크린샷을 올리면 카드가 자동으로 인식됩니다. 잘못 인식되거나 빠진 카드는 아래에서 직접 검색해 넣어 주세요.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`${blueBtn} cursor-pointer`}>
              {busy ? "스캔 중..." : deck ? "다시 업로드" : "스크린샷 업로드"}
              <input
                type="file" accept="image/*" className="hidden" disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 10 * 1024 * 1024) { setError("이미지는 10MB 이하여야 합니다."); e.target.value = ""; return; }
                  act(() => uploadDeck(tournamentId, f));
                  e.target.value = "";
                }}
              />
            </label>
            <button className={grayBtn} disabled={busy} onClick={() => setSearchOpen(true)}>카드 직접 추가</button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {viewEntrantId === null ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">참가자를 선택하세요.</p>
      ) : notFound ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{isOwnView ? "아직 제출한 덱이 없습니다." : "이 참가자는 아직 덱을 제출하지 않았습니다."}</p>
      ) : deck ? (
        <div>
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-gray-600 dark:text-gray-300">
              총 {deck.cards.reduce((n, c) => n + c.quantity, 0)}장 · {deck.cards.length}종
              {deck.locked && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">잠금</span>}
            </span>
            {deck.unmatched_count > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400">인식 실패 {deck.unmatched_count}장 — 직접 추가해 주세요</span>
            )}
          </div>
          {deck.cards.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">인식된 카드가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {deck.cards.map((c) => {
                const low = c.confidence !== null && c.confidence < 0.7;
                return (
                  <div key={c.id} className={`relative rounded-lg border p-1.5 bg-white dark:bg-gray-800 ${low ? "border-amber-400" : "border-gray-200 dark:border-gray-700"}`}>
                    {c.card.image_url ? (
                      <img src={c.card.image_url} alt={c.card.name} className="w-full aspect-[0.7] object-cover rounded" />
                    ) : (
                      <div className="w-full aspect-[0.7] rounded bg-gray-200 dark:bg-gray-700" />
                    )}
                    <div className="mt-1 text-[11px] leading-tight text-center truncate" title={c.card.name}>{c.card.name}</div>
                    <div className="flex items-center justify-center gap-1 mt-1 text-xs">
                      {canEdit && (
                        <button className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" disabled={busy || c.quantity <= 1}
                          onClick={() => act(() => addDeckCard(tournamentId, c.card.id, c.quantity - 1))}>−</button>
                      )}
                      <span className="font-semibold">×{c.quantity}</span>
                      {canEdit && (
                        <button className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" disabled={busy || c.quantity >= 3}
                          onClick={() => act(() => addDeckCard(tournamentId, c.card.id, c.quantity + 1))}>+</button>
                      )}
                    </div>
                    {(low || c.source === "manual") && (
                      <span className={`absolute top-1 left-1 text-[10px] px-1 rounded ${c.source === "manual" ? "bg-blue-600 text-white" : "bg-amber-400 text-black"}`}>
                        {c.source === "manual" ? "수동" : "확인 필요"}
                      </span>
                    )}
                    {canEdit && (
                      <button className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs" disabled={busy}
                        onClick={() => act(() => removeDeckCard(tournamentId, c.id))} aria-label="삭제">×</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">불러오는 중...</p>
      )}

      <CardSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={() => {}}
        onPickCard={(card: CardSearchResult) => act(() => addDeckCard(tournamentId, card.id, 1))}
        copyTargetLabel="덱"
      />
    </div>
  );
}
