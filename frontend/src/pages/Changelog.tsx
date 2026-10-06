import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listChangelog, deleteChangelog, type ChangelogEntry } from "@/api/changelogApi";
import { isAuthenticated, isAdmin } from "@/api/accountApi";
import ChangelogEditor from "@/components/ChangelogEditor";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Changelog() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState("");
  const [admin, setAdmin] = useState(false);
  // "new" = writing a new notice, a number = editing that entry
  const [editing, setEditing] = useState<"new" | number | null>(null);

  const load = useCallback((withAuth: boolean) => {
    listChangelog(withAuth)
      .then(setEntries)
      .catch((e) => setError(e.message || "로드 실패"));
  }, []);

  useEffect(() => {
    load(false);
    if (!isAuthenticated()) return;
    isAdmin()
      .then((a) => {
        setAdmin(a);
        if (a) load(true); // staff also see scheduled notices
      })
      .catch(() => {});
  }, [load]);

  const onSaved = () => {
    setEditing(null);
    load(true);
  };

  const remove = async (e: ChangelogEntry) => {
    if (!window.confirm(`'${e.title}' 공지를 삭제할까요?`)) return;
    try {
      await deleteChangelog(e.id);
      load(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    }
  };

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 max-w-2xl mx-auto text-gray-900 dark:text-white">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">공지사항</h1>
        <div className="flex items-center gap-3">
          {admin && editing !== "new" && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              ✏️ 공지 작성
            </button>
          )}
          <Link to="/" className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
            ← 홈으로
          </Link>
        </div>
      </div>

      {editing === "new" && (
        <div className="mb-5">
          <ChangelogEditor onCancel={() => setEditing(null)} onSaved={onSaved} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {entries === null && !error ? (
        <p className="text-center text-gray-500 py-8">로딩 중...</p>
      ) : entries && entries.length === 0 ? (
        <p className="text-center text-gray-500 py-8">아직 공지가 없습니다.</p>
      ) : (
        <div className="space-y-5">
          {entries?.map((e) =>
            editing === e.id ? (
              <ChangelogEditor key={e.id} entry={e} onCancel={() => setEditing(null)} onSaved={onSaved} />
            ) : (
              <article
                key={e.id}
                className={`bg-blue-50 dark:bg-blue-900/20 border rounded-xl shadow-sm p-4 md:p-5 ${
                  e.scheduled ? "border-amber-300 dark:border-amber-700/70 border-dashed" : "border-blue-100 dark:border-blue-800/40"
                }`}
              >
                <header className="mb-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg md:text-xl font-semibold">{e.title}</h2>
                    <time className="text-xs md:text-sm text-gray-500">
                      {formatDate(e.published_at)}
                    </time>
                    {e.scheduled && (
                      <span className="ml-2 inline-block whitespace-nowrap px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-semibold">
                        예약 · {formatTime(e.published_at)} 공개
                      </span>
                    )}
                  </div>
                  {admin && (
                    <div className="shrink-0 flex gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditing(e.id)}
                        className="px-2 py-1 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/30"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(e)}
                        className="px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </header>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown>
                </div>
              </article>
            ),
          )}
        </div>
      )}
    </div>
  );
}
