import { useEffect, useState } from "react";
import { getDeckNotes, DeckNote } from "@/api/deckApi";

const SOURCE_STYLE: Record<string, string> = {
  postype: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  dcinside: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  notion: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  gdocs: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  blog: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  twitter: "bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

const formatDate = (iso: string | null) => (iso ? `${iso.slice(0, 4)}.${iso.slice(5, 7)}` : null);

export default function DeckNotesSection({ deckId }: { deckId: number }) {
  const [notes, setNotes] = useState<DeckNote[] | null>(null);

  useEffect(() => {
    let alive = true;
    getDeckNotes(deckId)
      .then((res) => alive && setNotes(res.notes))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [deckId]);

  if (!notes || notes.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">📝 강의노트</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{notes.length}개 · 외부 링크</span>
      </div>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id}>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                    {n.title}
                    {n.is_paid && (
                      <span className="ml-1.5 align-middle inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-bold">
                        유료{n.price ? ` · ${n.price}` : ""}
                      </span>
                    )}
                  </p>
                  {n.summary && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{n.summary}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${SOURCE_STYLE[n.source] ?? SOURCE_STYLE.other}`}>{n.source_label}</span>
                    {n.game !== "md" && <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[11px]">{n.game_label}</span>}
                    {n.author && <span>{n.author}</span>}
                    {formatDate(n.published_at) && <span>{formatDate(n.published_at)}</span>}
                  </p>
                </div>
                <span className="shrink-0 text-gray-400 text-sm">↗</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
