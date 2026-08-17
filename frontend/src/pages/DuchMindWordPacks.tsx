import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listPacks, createPack, deletePack,
  type WordPackSummary,
} from "@/api/duchmindPackApi";

// Sharing is via CSV export/import only — no public pack listing.

export default function DuchMindWordPacks() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<WordPackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const d = await listPacks();
      setPacks(d.packs);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const p = await createPack(newName.trim(), newDesc, false);
      setShowCreate(false);
      setNewName(""); setNewDesc("");
      navigate(`/duchmind-wordpacks/${p.id}`);
    } catch (e: any) { setError(e.message); }
    finally { setCreating(false); }
  };

  const handleDelete = async (p: WordPackSummary) => {
    if (!confirm(`"${p.name}"을 삭제할까요?`)) return;
    try { await deletePack(p.id); await refresh(); }
    catch (e: any) { setError(e.message); }
  };

  const groups = {
    // System-owned packs (owner=null) — includes the tier defaults 초급 /
    // 중급 / 고급. The old filter was `is_default` which only matched the
    // single default pack and hid the others.
    default: packs.filter((p) => p.owner_id == null),
    mine: packs.filter((p) => p.is_mine),
  };

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
      >
        ← 뒤로
      </button>
      <h1 className="text-2xl font-bold mb-2">듀치마인드 단어장</h1>
      <p className="text-sm text-gray-500 mb-5">
        나만의 단어장을 만들어 방에서 사용하거나 공유할 수 있습니다.
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
        >
          + 새 단어장
        </button>
      </div>

      {loading ? (
        <p className="text-center text-gray-500">로딩 중...</p>
      ) : (
        <div className="space-y-5">
          <PackSection title="기본 단어장" packs={groups.default} onClick={(p) => navigate(`/duchmind-wordpacks/${p.id}`)} />
          <PackSection title="내 단어장" packs={groups.mine} onClick={(p) => navigate(`/duchmind-wordpacks/${p.id}`)} onDelete={handleDelete} />
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 rounded-xl p-5 max-w-md w-full space-y-3">
            <h3 className="font-bold text-lg">새 단어장 만들기</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">이름</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                required
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">설명 (선택)</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <p className="text-xs text-gray-500">
              만든 단어장은 본인만 보입니다. 다른 사람과 공유하려면 단어장 상세 페이지에서 "내보내기"로 카드명 텍스트를 복사해서 전달하세요.
            </p>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg font-semibold text-sm">취소</button>
              <button type="submit" disabled={creating} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">
                {creating ? "만드는 중..." : "만들기"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PackSection({ title, packs, onClick, onDelete }: {
  title: string;
  packs: WordPackSummary[];
  onClick: (p: WordPackSummary) => void;
  onDelete?: (p: WordPackSummary) => void;
}) {
  if (packs.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 mb-2">{title}</h2>
      <div className="space-y-2">
        {packs.map((p) => (
          <div
            key={p.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => onClick(p)}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2 flex-wrap">
                <span className="truncate">{p.name}</span>
                {p.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">기본</span>}
              </div>
              {p.description && <div className="text-xs text-gray-500 truncate">{p.description}</div>}
              <div className="text-xs text-gray-400 mt-0.5">
                단어 {p.entry_count}개{p.owner_name ? ` · @${p.owner_name}` : ""}
              </div>
            </div>
            {onDelete && p.is_mine && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(p); }}
                className="text-xs text-red-500 hover:underline"
              >
                삭제
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
