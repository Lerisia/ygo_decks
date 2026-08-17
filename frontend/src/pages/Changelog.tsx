import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listChangelog, type ChangelogEntry } from "@/api/changelogApi";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Changelog() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listChangelog()
      .then(setEntries)
      .catch((e) => setError(e.message || "로드 실패"));
  }, []);

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 max-w-2xl mx-auto text-gray-900 dark:text-white">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">업데이트 내역</h1>
        <Link to="/" className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
          ← 홈으로
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {entries === null && !error ? (
        <p className="text-center text-gray-500 py-8">로딩 중...</p>
      ) : entries && entries.length === 0 ? (
        <p className="text-center text-gray-500 py-8">아직 업데이트 내역이 없습니다.</p>
      ) : (
        <div className="space-y-5">
          {entries?.map((e) => (
            <article
              key={e.id}
              className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-xl shadow-sm p-4 md:p-5"
            >
              <header className="mb-2">
                <h2 className="text-lg md:text-xl font-semibold">{e.title}</h2>
                <time className="text-xs md:text-sm text-gray-500">
                  {formatDate(e.published_at)}
                </time>
              </header>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
