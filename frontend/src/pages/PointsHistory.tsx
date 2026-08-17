import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPointsHistory, type PointTransaction, type PointHistoryPage } from "@/api/accountApi";

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function PointsHistory() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PointHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getPointsHistory(page, PAGE_SIZE)
      .then((r) => {
        if (cancelled) return;
        if (!r) {
          setError("불러올 수 없습니다.");
          return;
        }
        setData(r);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/mypage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 마이페이지
      </button>

      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-3 sm:p-5">
        <h1 className="text-xl font-bold mb-3">📊 포인트 내역</h1>

        {loading && (
          <p className="text-center text-sm text-gray-500 py-8">불러오는 중…</p>
        )}
        {error && !loading && (
          <p className="text-center text-sm text-red-500 py-8">{error}</p>
        )}
        {!loading && !error && data && data.results.length === 0 && (
          <p className="text-center text-sm text-gray-500 py-8">아직 내역이 없습니다.</p>
        )}
        {!loading && !error && data && data.results.length > 0 && (
          <>
            <div className="text-xs text-gray-500 mb-2">총 {data.count.toLocaleString()}건</div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.results.map((tx: PointTransaction) => (
                <li key={tx.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      <span className="text-gray-700 dark:text-gray-200">{tx.display_label}</span>
                      {tx.note && (
                        <span className="text-gray-500 dark:text-gray-400 ml-2">— {tx.note}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{formatDate(tx.created_at)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-base font-bold tabular-nums ${tx.amount >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-500"}`}>
                      {tx.amount >= 0 ? "+" : ""}{tx.amount.toLocaleString()}P
                    </div>
                    <div className="text-[10px] text-gray-400 tabular-nums">
                      잔액 {tx.balance_after.toLocaleString()}P
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40"
                >
                  이전
                </button>
                <span className="text-sm text-gray-500">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data.has_next}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
