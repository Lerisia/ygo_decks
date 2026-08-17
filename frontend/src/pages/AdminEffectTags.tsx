import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listEffectTags,
  updateEffectTag,
  type EffectTagRow,
  type EffectTagListResponse,
} from "@/api/effectTagAdminApi";

/** Admin page for reviewing/correcting card effect tags. Each card row has
 *  a checkbox per tag — clicking patches the row and marks it
 *  manually_reviewed, which the bulk re-classifier respects. */

const PAGE_SIZE = 30;

export default function AdminEffectTags() {
  const navigate = useNavigate();
  const [data, setData] = useState<EffectTagListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Filters
  const [tagFilter, setTagFilter] = useState<string>("");
  const [missingTagFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [reviewed, setReviewed] = useState<"yes" | "no" | "any">("any");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const d = await listEffectTags({
        tag: tagFilter || undefined,
        missing_tag: missingTagFilter || undefined,
        q: q || undefined,
        reviewed,
        page,
      });
      setData(d);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setLoading(false); }
  }, [tagFilter, missingTagFilter, q, reviewed, page]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 whenever filters change (but don't double-trigger load)
  useEffect(() => { setPage(1); }, [tagFilter, missingTagFilter, q, reviewed]);

  const handleToggle = async (row: EffectTagRow, field: string) => {
    const next = !row.tags[field];
    try {
      const updated = await updateEffectTag(row.card_pk, { [field]: next });
      setData((prev) => prev && {
        ...prev,
        results: prev.results.map((r) => r.card_pk === row.card_pk ? updated : r),
      });
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  };

  const handleMarkReviewed = async (row: EffectTagRow, reviewedFlag: boolean) => {
    try {
      const updated = await updateEffectTag(row.card_pk, { manually_reviewed: reviewedFlag } as any);
      setData((prev) => prev && {
        ...prev,
        results: prev.results.map((r) => r.card_pk === row.card_pk ? updated : r),
      });
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 max-w-7xl mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >← 관리 메인</button>

      <h1 className="text-2xl font-bold mb-1">카드 효과 태그 검수</h1>
      <p className="text-sm text-gray-500 mb-4">
        LLM 분류 결과를 검수하고 수정합니다. 체크박스 클릭 시 즉시 저장 + 검수됨 마크.
      </p>

      {data && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
          <span className="font-semibold">전체 진행:</span>{" "}
          {data.total_reviewed} / {data.total_with_tags} 검수 완료 ({data.total_with_tags > 0 ? Math.round(100 * data.total_reviewed / data.total_with_tags) : 0}%)
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-7 gap-1 text-xs">
            {data.tag_fields.map((f) => (
              <span key={f} className="px-1.5 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                {data.tag_labels[f]}: <b>{data.per_tag_count[f] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 검색"
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          />
          {data && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">태그 필터 없음</option>
              {data.tag_fields.map((f) => (
                <option key={f} value={f}>{data.tag_labels[f]}=참 (만)</option>
              ))}
            </select>
          )}
          <select
            value={reviewed}
            onChange={(e) => setReviewed(e.target.value as any)}
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="any">검수 여부 무관</option>
            <option value="no">미검수만</option>
            <option value="yes">검수 완료만</option>
          </select>
        </div>
      </div>

      {err && (
        <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {err}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">불러오는 중...</p>}

      {data && data.results.length === 0 && !loading && (
        <p className="text-sm text-gray-500 py-8 text-center">결과 없음</p>
      )}

      {/* Card rows */}
      {data && data.results.length > 0 && (
        <div className="space-y-2">
          {data.results.map((row) => (
            <div
              key={row.card_pk}
              className={`p-3 rounded-lg border ${
                row.manually_reviewed
                  ? "border-green-300 dark:border-green-700 bg-green-50/40 dark:bg-green-900/10"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
              }`}
            >
              <div className="flex gap-3">
                {row.image_url && (
                  <img
                    src={row.image_url}
                    alt={row.korean_name}
                    className="w-16 h-16 object-contain shrink-0 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold truncate">{row.korean_name}</span>
                    <span className="text-xs text-gray-500">[{row.frame_type}]</span>
                    {row.manually_reviewed && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-semibold">검수됨</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                    {row.description}
                  </p>
                </div>
              </div>

              {/* Tag toggles */}
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1 text-sm">
                {data.tag_fields.map((f) => {
                  const on = !!row.tags[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleToggle(row, f)}
                      className={`px-2 py-1 rounded text-xs font-semibold border transition text-left ${
                        on
                          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
                          : "bg-gray-50 dark:bg-gray-900 text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {on ? "✓ " : ""}{data.tag_labels[f]}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex justify-end">
                {!row.manually_reviewed ? (
                  <button
                    type="button"
                    onClick={() => handleMarkReviewed(row, true)}
                    className="text-xs px-2 py-1 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 font-semibold"
                  >그대로 OK (검수 완료)</button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleMarkReviewed(row, false)}
                    className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >검수 취소</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-4 flex justify-center items-center gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
          >← 이전</button>
          <span className="text-gray-500">{page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
          >다음 →</button>
        </div>
      )}
    </div>
  );
}
