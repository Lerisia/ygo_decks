import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DuchMindBrowsePanel from "@/components/DuchMindBrowsePanel";
import {
  getPack, updatePack, deletePack, addCardToPack, removeWordFromPack,
  removeCardFromPack,
  importPack, exportPack, searchCardsForPack,
  type WordPackSummary, type WordPackEntry, type CardSearchHit,
} from "@/api/duchmindPackApi";

export default function DuchMindWordPackDetail() {
  const { packId } = useParams<{ packId: string }>();
  const navigate = useNavigate();
  const id = Number(packId);
  const [pack, setPack] = useState<WordPackSummary | null>(null);
  const [entries, setEntries] = useState<WordPackEntry[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number; not_found: string[] } | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => { refresh(); }, [id]);

  const refresh = async () => {
    setError("");
    try {
      const d = await getPack(id);
      setPack(d.pack);
      setEntries(d.entries);
      setEditName(d.pack.name);
      setEditDesc(d.pack.description);
    } catch (e: any) { setError(e.message); }
  };

  // Server tells us authoritatively via can_edit (owner, or staff for any
  // system pack incl. 초급/중급/고급). Fall back to the old heuristic.
  const canEdit = !!pack && (pack.can_edit ?? (pack.is_mine || pack.is_default));

  // Card search
  useEffect(() => {
    if (!searchQ.trim() || !canEdit) { setSearchResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const d = await searchCardsForPack(id, searchQ);
        setSearchResults(d.results);
      } catch (e: any) { setError(e.message); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQ, id, canEdit]);

  const handleAdd = async (cardPk: number) => {
    try {
      await addCardToPack(id, cardPk);
      setSearchResults((prev) => prev.filter((r) => r.id !== cardPk));
      await refresh();
    } catch (e: any) { setError(e.message); }
  };

  const handleRemove = async (w: WordPackEntry) => {
    if (!confirm(`"${w.name}"을(를) 단어장에서 제거할까요?`)) return;
    try {
      await removeWordFromPack(id, w.id);
      setEntries((prev) => prev.filter((x) => x.id !== w.id));
    } catch (e: any) { setError(e.message); }
  };

  const handleImport = async () => {
    if (!bulkText.trim()) return;
    setBulkSaving(true); setError("");
    try {
      const r = await importPack(id, bulkText);
      setBulkResult(r);
      setBulkText("");
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBulkSaving(false); }
  };

  const handleExport = async () => {
    setError("");
    try {
      const r = await exportPack(id);
      setExportText(r.csv);
      setCopied(false);
    } catch (e: any) { setError(e.message); }
  };

  const handleCopy = async () => {
    if (!exportText) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleSaveSettings = async () => {
    setEditing(true); setError("");
    try {
      const updated = await updatePack(id, { name: editName, description: editDesc });
      setPack(updated);
    } catch (e: any) { setError(e.message); }
    finally { setEditing(false); }
  };

  const handleDelete = async () => {
    if (!pack) return;
    if (!confirm(`"${pack.name}"을 영구 삭제할까요?`)) return;
    try {
      await deletePack(id);
      navigate("/duchmind-wordpacks");
    } catch (e: any) { setError(e.message); }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((w) => (w.name || "").toLowerCase().includes(q));
  }, [entries, filter]);

  if (!pack) {
    return (
      <div className="min-h-screen px-0 sm:px-4 py-6 max-w-4xl mx-auto">
        <p className="text-center text-gray-500">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-4xl mx-auto">
      <button onClick={() => navigate("/duchmind-wordpacks")} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2">
        ← 단어장 목록
      </button>
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2 flex-wrap">
        {pack.name}
        {pack.is_default && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">기본</span>}
      </h1>
      <p className="text-sm text-gray-500 mb-5">
        {pack.description || "(설명 없음)"} · 단어 {entries.length}개{pack.owner_name ? ` · @${pack.owner_name}` : ""}
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Settings (owner only) */}
      {pack.is_mine && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
          <h2 className="font-semibold mb-2">단어장 설정</h2>
          <div className="space-y-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={80}
              placeholder="이름"
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
            />
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={200}
              placeholder="설명"
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveSettings} disabled={editing} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {editing ? "저장 중..." : "저장"}
              </button>
              <button onClick={handleDelete} className="ml-auto text-sm text-red-500 hover:underline">단어장 삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Import / Export */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
        <div className="flex justify-between items-start gap-2">
          <h2 className="font-semibold mb-2">가져오기 / 내보내기 (스크리블 CSV)</h2>
          <button onClick={handleExport} className="text-xs px-3 py-1 border rounded bg-white dark:bg-gray-800">내보내기</button>
        </div>
        {exportText !== null && (
          <div className="mb-3">
            <textarea
              readOnly
              value={exportText}
              rows={4}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 dark:bg-gray-900 text-xs font-mono"
            />
            <button onClick={handleCopy} className="mt-1 text-xs text-blue-600 hover:underline">
              {copied ? "복사됨!" : "📋 클립보드에 복사"}
            </button>
          </div>
        )}
        {canEdit && (
          <>
            <p className="text-xs text-gray-500 mb-1">쉼표 또는 줄바꿈으로 카드 한국어 이름 구분.</p>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="블랙 매지션,푸른 눈의 백룡,엘섀도르 미도라시..."
              rows={4}
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-xs font-mono"
            />
            <div className="flex justify-end mt-2">
              <button onClick={handleImport} disabled={bulkSaving || !bulkText.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-semibold disabled:opacity-50">
                {bulkSaving ? "추가 중..." : "일괄 추가"}
              </button>
            </div>
            {bulkResult && (
              <div className="mt-2 text-xs text-gray-700 dark:text-gray-300 space-y-1">
                <p>추가됨: {bulkResult.added} · 이미 있음: {bulkResult.skipped}</p>
                {bulkResult.not_found.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-red-500">DB에서 못 찾은 이름 ({bulkResult.not_found.length}개)</summary>
                    <p className="mt-1 text-red-500 break-words font-mono">{bulkResult.not_found.join(", ")}</p>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Card search */}
      {canEdit && (
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
      )}

      {/* Browse all cards — same panel the admin tier editor uses. Only
          surfaces for editable yugioh packs (the browse-cards endpoint is
          yugioh-only). */}
      {canEdit && pack && (pack.series ?? "yugioh") === "yugioh" && (
        <DuchMindBrowsePanel
          packId={id}
          onAdd={(cardPk) => addCardToPack(id, cardPk)}
          onRemove={(cardPk) => removeCardFromPack(id, cardPk)}
          onChanged={refresh}
        />
      )}

      {/* Word list */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="font-semibold">단어 ({entries.length})</h2>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 필터"
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
                className="flex items-center gap-2 p-2 border rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              >
                {w.image_url && <img src={w.image_url} alt="" className="w-10 h-10 object-cover rounded" />}
                <span className="flex-1 text-sm truncate">{w.name}</span>
                {canEdit && (
                  <button onClick={() => handleRemove(w)} className="text-xs text-red-500 hover:underline">제거</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
