import { useCallback, useEffect, useRef, useState } from "react";

/** Shared card-name search modal used by both multiplayer DuchMind and
 *  Solo Duchmind. Keeping it in one component guarantees the two stay
 *  identical (UI + search algorithm) — per project rule, the card search
 *  must always behave the same in multi and solo. */

export type CardSearchResult = { id: number; name: string; image_url: string | null };

interface CardSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the picked card's name. The modal closes itself after. */
  onPick: (name: string) => void;
  /** Optional richer callback with the full card (id/name/image) — used by
   *  flows that need the card id (e.g. tournament deck submission). */
  onPickCard?: (card: CardSearchResult) => void;
  /** Pokemon-series rooms hit a different endpoint. Default "yugioh". */
  series?: "yugioh" | "pokemon";
  /** Where a tapped card's name lands — used in the header hint + tooltip.
   *  e.g. "채팅창" (multiplayer) or "정답창" (solo). */
  copyTargetLabel: string;
}

/** One-shot retry for card images that occasionally come back broken
 *  (transient media-cache miss). Adds a cache-buster and re-assigns src
 *  once; subsequent errors fall through to the broken-image icon. */
function onImgErrorRetry(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.retried) return;
  img.dataset.retried = "1";
  const src = img.src || "";
  if (!src) return;
  img.src = src + (src.includes("?") ? "&" : "?") + "_retry=" + Date.now();
}

export default function CardSearchModal({
  open, onClose, onPick, onPickCard, series = "yugioh", copyTargetLabel,
}: CardSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // True once a search has actually been run for the current query — gates
  // the "결과 없음" message so it doesn't flash while the user is still
  // typing (search only fires on Enter / the 검색 button now).
  const [hasSearched, setHasSearched] = useState(false);
  // Incremental render — start with PAGE results, reveal +PAGE more each
  // time the user scrolls near the bottom. Keeps the initial render cheap
  // while still letting large archetypes (HERO etc.) be fully browsed.
  const PAGE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const noun = series === "pokemon" ? "포켓몬" : "카드";

  const runSearch = useCallback(async (qRaw: string) => {
    const q = qRaw.trim();
    if (!q) { setResults([]); setLoading(false); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const token = localStorage.getItem("access_token") || "";
      const url = series === "pokemon"
        ? `/api/multiplayer/duchmind/pokemon-search/?q=${encodeURIComponent(q)}`
        : `/api/search/?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ac.signal,
      });
      if (!res.ok) throw new Error("search failed");
      const d = await res.json();
      if (!ac.signal.aborted) {
        setResults(d.results || []);
        setVisibleCount(PAGE);  // reset incremental window for the new result set
        setHasSearched(true);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") { setResults([]); setHasSearched(true); }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [series]);

  // Reset state each time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setHasSearched(false);
    }
  }, [open]);
  // Search only fires on Enter / the 검색 button (no live debounce) — the
  // user always knows what they're looking for, so mid-typing lookups
  // just waste requests and re-renders.

  // Lock page scroll while the modal is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 w-[88vw] sm:w-full max-w-sm sm:max-w-md max-h-[70vh] sm:max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="font-bold text-base shrink-0">🔍 {noun} 검색</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              * {noun} 클릭 시 {copyTargetLabel}으로 복사
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 text-lg px-2 shrink-0"
            aria-label="닫기"
          >✕</button>
        </div>
        <div className="flex gap-1.5 mb-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHasSearched(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch(query);
                inputRef.current?.blur();
              }
            }}
            placeholder={`${noun} 이름 입력 후 Enter`}
            autoFocus
            className="flex-1 min-w-0 px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-base sm:text-sm"
          />
          <button
            type="button"
            onClick={() => { runSearch(query); inputRef.current?.blur(); }}
            disabled={!query.trim() || loading}
            className="shrink-0 px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-semibold disabled:bg-gray-400"
          >검색</button>
        </div>
        <div
          className="flex-1 overflow-y-auto overscroll-contain -mx-1 px-1"
          onScroll={(e) => {
            // Reveal the next page when the user nears the bottom.
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
              setVisibleCount((c) => Math.min(c + PAGE, results.length));
            }
          }}
        >
          {loading && (
            <p className="text-xs text-gray-400 text-center py-3">검색 중...</p>
          )}
          {!loading && !hasSearched && results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">{noun} 이름을 입력하고 검색하세요.</p>
          )}
          {!loading && hasSearched && results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">결과 없음</p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {results.slice(0, visibleCount).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onPick(c.name); onPickCard?.(c); onClose(); }}
                className="text-center hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded p-1 transition"
                title={`이 이름을 ${copyTargetLabel}에 입력`}
              >
                {c.image_url ? (
                  <img
                    src={c.image_url}
                    alt={c.name}
                    className="w-full aspect-square object-contain rounded bg-gray-100 dark:bg-gray-900"
                    loading="lazy"
                    onError={onImgErrorRetry}
                  />
                ) : (
                  <div className="w-full aspect-square rounded bg-gray-100 dark:bg-gray-900" />
                )}
                <p className="text-[10px] sm:text-xs mt-0.5 break-words leading-tight">{c.name}</p>
              </button>
            ))}
          </div>
          {visibleCount < results.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => Math.min(c + PAGE, results.length))}
              className="w-full text-xs text-blue-600 dark:text-blue-400 py-2 hover:underline"
            >
              더 보기 ({visibleCount} / {results.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
