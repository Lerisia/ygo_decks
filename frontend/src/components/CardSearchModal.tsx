import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PickerModal, { type PickerStatus } from "./PickerModal";

/** Shared card-name search modal used by both multiplayer DuchMind and
 *  Solo Duchmind. Keeping it in one component guarantees the two stay
 *  identical (UI + search algorithm) — per project rule, the card search
 *  must always behave the same in multi and solo. It draws through the
 *  site-wide PickerModal (grid / list). */

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

export default function CardSearchModal({
  open, onClose, onPick, onPickCard, series = "yugioh", copyTargetLabel,
}: CardSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // True once a search has actually been run for the current query — gates
  // the "결과 없음" message so it doesn't flash while the user is still
  // typing (search only fires on Enter / the 검색 button).
  const [hasSearched, setHasSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
        setHasSearched(true);
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") { setResults([]); setHasSearched(true); }
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

  // Stable between renders: the game screens around this re-render often, and a new array would send the
  // picker back to its first page while someone is scrolling.
  const items = useMemo(() => results.map((c) => ({ key: c.id, name: c.name, image: c.image_url })), [results]);
  const status: PickerStatus = loading ? "loading" : results.length ? "ready" : hasSearched ? "empty" : "idle";

  return (
    <PickerModal
      open={open}
      onClose={onClose}
      title={`🔍 ${noun} 검색`}
      hint={`* ${noun} 클릭 시 ${copyTargetLabel}으로 복사`}
      placeholder={`${noun} 이름 입력 후 Enter`}
      query={query}
      onQueryChange={(q) => { setQuery(q); setHasSearched(false); }}
      onSubmit={runSearch}
      items={items}
      status={status}
      idleText={`${noun} 이름을 입력하고 검색하세요.`}
      onPick={(it) => {
        const card = results.find((c) => c.id === it.key);
        onPick(it.name);
        if (card) onPickCard?.(card);
      }}
      viewKey={`card-${series}`}
    />
  );
}
