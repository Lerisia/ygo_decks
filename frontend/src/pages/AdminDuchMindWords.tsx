import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DuchMindBrowsePanel from "@/components/DuchMindBrowsePanel";
import {
  listDmWords, searchDmCards, addDmWord, bulkAddDmWords,
  toggleDmWord, deleteDmWord, listAdminDmPacks,
  removeDmWordByCard,
  type DuchMindWord, type CardSearchHit, type AdminDmPack,
} from "@/api/duchmindAdminApi";

export default function AdminDuchMindWords() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<AdminDmPack[]>([]);
  const [packId, setPackId] = useState<number | undefined>(undefined);
  const [words, setWords] = useState<DuchMindWord[]>([]);
  const [filter, setFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number; not_found: string[] } | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [error, setError] = useState("");

  // Load pack list once; pick the default pack as the initial target.
  useEffect(() => {
    listAdminDmPacks()
      .then((d) => {
        setPacks(d.packs);
        const def = d.packs.find((p) => p.is_default) || d.packs[0];
        setPackId(def?.id);
      })
      .catch((e: any) => setError(e.message));
  }, []);

  // Reload words whenever the selected pack changes.
  useEffect(() => {
    if (packId == null) return;
    setBulkResult(null);
    setSearchQ(""); setSearchResults([]);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);

  const refresh = async () => {
    try {
      const d = await listDmWords(packId);
      setWords(d.words);
    } catch (e: any) { setError(e.message); }
  };

  // Debounced search (scoped to the selected pack — excludes its members)
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const d = await searchDmCards(searchQ, packId);
        setSearchResults(d.results);
      } catch (e: any) { setError(e.message); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(id);
  }, [searchQ, packId]);

  const handleAdd = async (cardPk: number) => {
    try {
      await addDmWord(cardPk, packId);
      setSearchResults((prev) => prev.filter((r) => r.id !== cardPk));
      await refresh();
    } catch (e: any) { setError(e.message); }
  };

  const handleBulkAdd = async () => {
    const names = bulkText.split(/[,\n\t]+/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setBulkSaving(true);
    setError("");
    try {
      const r = await bulkAddDmWords(names, packId);
      setBulkResult(r);
      setBulkText("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBulkSaving(false);
    }
  };

  const handleToggle = async (w: DuchMindWord) => {
    try {
      await toggleDmWord(w.id, !w.enabled);
      setWords((prev) => prev.map((x) => x.id === w.id ? { ...x, enabled: !x.enabled } : x));
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (w: DuchMindWord) => {
    if (!confirm(`"${w.name}"을(를) 단어장에서 제거할까요?`)) return;
    try {
      await deleteDmWord(w.id);
      setWords((prev) => prev.filter((x) => x.id !== w.id));
    } catch (e: any) { setError(e.message); }
  };


  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) => (w.name || "").toLowerCase().includes(q));
  }, [words, filter]);

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 관리
      </button>
      <h1 className="text-2xl font-bold mb-2">듀치마인드 단어장</h1>
      <p className="text-sm text-gray-500 mb-3">관리자 전용 — 게임에 사용될 카드 풀을 관리합니다.</p>

      {/* Pack picker — switch between the system tiers (초급/중급/고급…). */}
      <div className="flex items-center gap-2 mb-6">
        <label className="text-sm font-semibold shrink-0">단어장:</label>
        <select
          value={packId ?? ""}
          onChange={(e) => setPackId(e.target.value ? Number(e.target.value) : undefined)}
          className="px-3 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.is_default ? " (기본)" : ""} — {p.entry_count}장
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-500">현재 {words.length}장</span>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Bulk add */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
        <h2 className="font-semibold mb-2">한국어 카드명 일괄 추가</h2>
        <p className="text-xs text-gray-500 mb-2">쉼표·줄바꿈으로 구분. DB의 한국어 이름과 정확히 일치해야 추가됩니다.</p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="블랙 매지션, 푸른 눈의 백룡, 엘섀도르 미도라시..."
          rows={5}
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm font-mono"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleBulkAdd}
            disabled={bulkSaving || !bulkText.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {bulkSaving ? "추가 중..." : "일괄 추가"}
          </button>
        </div>
        {bulkResult && (
          <div className="mt-3 text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <p>추가됨: {bulkResult.added} · 이미 있음: {bulkResult.skipped}</p>
            {bulkResult.not_found.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-red-500">DB에서 못 찾은 이름 ({bulkResult.not_found.length}개)</summary>
                <p className="mt-1 text-red-500 break-words font-mono">{bulkResult.not_found.join(", ")}</p>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Single card search & add */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
        <h2 className="font-semibold mb-2">카드 검색해서 추가</h2>
        <input
          type="text"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="카드 이름으로 검색"
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
        />
        {searching && <p className="text-xs text-gray-500">검색 중...</p>}
        {searchResults.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-auto">
            {searchResults.map((c) => (
              <button
                key={c.id}
                onClick={() => handleAdd(c.id)}
                className="flex items-center gap-2 p-2 border rounded-lg bg-gray-50 dark:bg-gray-900 hover:border-blue-500 text-left"
              >
                {c.image_url && <img src={c.image_url} alt="" className="w-12 h-12 object-cover rounded" />}
                <span className="text-xs flex-1 truncate">+ {c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Browse all cards — paginated illustration grid, click to toggle.
          Extracted into a shared <DuchMindBrowsePanel> component so the
          user pack editor can reuse the same UX. */}
      {packId != null && (
        <DuchMindBrowsePanel
          packId={packId}
          onAdd={(cardPk) => addDmWord(cardPk, packId)}
          onRemove={(cardPk) => removeDmWordByCard(cardPk, packId)}
          onChanged={refresh}
        />
      )}

      {/* Word list */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="font-semibold shrink-0">등록된 단어 ({words.length})</h2>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 단어 필터"
            className="flex-1 max-w-xs px-3 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-sm"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">표시할 단어가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filtered.map((w) => (
              <div
                key={w.id}
                className={`flex items-center gap-2 p-2 border rounded-lg ${
                  w.enabled
                    ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                    : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 opacity-60"
                }`}
              >
                {w.image_url && <img src={w.image_url} alt="" className="w-10 h-10 object-cover rounded" />}
                <span className="flex-1 text-sm truncate">{w.name}</span>
                <button
                  onClick={() => handleToggle(w)}
                  className={`text-xs px-2 py-1 rounded border ${
                    w.enabled
                      ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {w.enabled ? "활성" : "비활성"}
                </button>
                <button
                  onClick={() => handleDelete(w)}
                  className="text-xs text-red-500 hover:underline"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
