import { useEffect, useState } from "react";
import { browseDmCards, type BrowseCard } from "@/api/duchmindAdminApi";

interface Props {
  /** Pack to operate on. Must be one the user can edit (system pack as
   *  admin, or user-owned pack as owner). The browse-cards endpoint
   *  authorizes per-pack so a mismatched packId just returns 403. */
  packId: number;
  /** Called when a card is tapped to add it to the pack. */
  onAdd: (cardPk: number) => Promise<unknown>;
  /** Called when an already-in-pack card is tapped to remove it. */
  onRemove: (cardPk: number) => Promise<unknown>;
  /** Fires after any successful add/remove so the parent can refresh its
   *  word list / counts without re-implementing the round-trip itself. */
  onChanged?: () => void;
}

/** Collapsible "browse all cards & toggle" grid. Extracted from the admin
 *  word-maintenance page so the user pack editor (DuchMindWordPackDetail)
 *  can reuse the same UX — same look, same pagination, same mobile-grid
 *  density. Add/remove behavior is parameterized so each caller plugs in
 *  whatever endpoint matches its auth scope (admin word API vs user pack
 *  API). */
export default function DuchMindBrowsePanel({ packId, onAdd, onRemove, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BrowseCard[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBrowse = async (p: number, query: string) => {
    setLoading(true);
    setError("");
    try {
      const d = await browseDmCards({ packId, page: p, q: query });
      setItems(d.items);
      setPage(d.page);
      setTotalPages(d.total_pages);
      setTotal(d.total);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // (Re)load page 1 when the panel opens, the pack changes, or the query
  // changes — debounced 250ms so typing doesn't hammer the API.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => loadBrowse(1, q), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, packId, q]);

  const toggleCard = async (c: BrowseCard) => {
    try {
      if (c.in_pack) await onRemove(c.id);
      else await onAdd(c.id);
      setItems((prev) => prev.map((x) => x.id === c.id ? { ...x, in_pack: !x.in_pack } : x));
      onChanged?.();
    } catch (e: any) {
      setError(e.message || String(e));
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between font-semibold"
      >
        <span>전체 카드 둘러보기 {open && `(${total.toLocaleString()}장)`}</span>
        <span className="text-xs text-gray-500">{open ? "▲ 닫기" : "▼ 열기"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 이름으로 필터 (비우면 전체)"
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
          />
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          {loading && <p className="text-xs text-gray-500 mb-2">불러오는 중...</p>}
          {/* Mobile defaults to a 3-column grid so cards stay tap-sized;
              desktop spreads to 5–6 columns for density. */}
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
            {items.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleCard(c)}
                title={c.name}
                className={`relative rounded-lg overflow-hidden border-2 transition ${
                  c.in_pack
                    ? "border-green-500 ring-2 ring-green-300 dark:ring-green-700"
                    : "border-gray-300 dark:border-gray-600 hover:border-blue-500"
                }`}
              >
                {c.image_url
                  ? <img src={c.image_url} alt={c.name} className="block w-full aspect-square object-cover" />
                  : <div className="w-full aspect-square bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">{c.name}</div>}
                {c.in_pack && (
                  <span className="absolute top-0.5 right-0.5 bg-green-500 text-white text-[10px] font-bold rounded px-1 leading-tight">✓</span>
                )}
                <span className="block text-[10px] leading-tight truncate px-1 py-0.5 bg-white/90 dark:bg-gray-900/90">{c.name}</span>
              </button>
            ))}
          </div>
          {items.length === 0 && !loading && (
            <p className="text-sm text-gray-500 py-4 text-center">결과 없음</p>
          )}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mt-4 flex-wrap">
            <button
              onClick={() => loadBrowse(page - 1, q)}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 rounded border text-sm disabled:opacity-40"
            >← 이전</button>
            {/* Direct page jump. Enter or blur commits the value. */}
            <span className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={totalPages}
                defaultValue={page}
                key={page}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(v) && v >= 1 && v <= totalPages && v !== page) {
                      loadBrowse(v, q);
                    }
                  }
                }}
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= totalPages && v !== page) {
                    loadBrowse(v, q);
                  }
                }}
                className="w-14 sm:w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center text-sm"
              />
              <span>/ {totalPages}</span>
            </span>
            <button
              onClick={() => loadBrowse(page + 1, q)}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 rounded border text-sm disabled:opacity-40"
            >다음 →</button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 text-center">초록 테두리 = 단어장에 포함됨. 클릭으로 추가/제거.</p>
        </div>
      )}
    </div>
  );
}
