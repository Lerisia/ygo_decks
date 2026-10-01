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

/** Consecutive parts of one series (the API keeps them together) become one entry. */
type Entry = { key: string; notes: DeckNote[] };
const groupSeries = (notes: DeckNote[]): Entry[] => {
  const out: Entry[] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (n.series && last && last.notes[0].series === n.series) last.notes.push(n);
    else out.push({ key: n.series ? `s:${n.series}` : `n:${n.id}`, notes: [n] });
  }
  return out;
};

function NoteMeta({ n, extra }: { n: DeckNote; extra?: string }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
      <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${SOURCE_STYLE[n.source] ?? SOURCE_STYLE.other}`}>{n.source_label}</span>
      {n.game !== "md" && <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[11px]">{n.game_label}</span>}
      {n.author && <span>{n.author}</span>}
      {formatDate(n.published_at) && <span>{formatDate(n.published_at)}</span>}
      {extra && <span>{extra}</span>}
    </p>
  );
}

function SeriesCard({ notes }: { notes: DeckNote[] }) {
  const head = notes[0];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5">
      <p className="font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">{head.series}</p>
      {head.summary && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{head.summary}</p>}
      <NoteMeta n={head} extra={`전 ${notes.length}편`} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {notes.map((n, i) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-600 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition"
          >
            <span className="font-semibold">{n.part ?? i + 1}편</span>
            {n.part_label && <span className="text-gray-500 dark:text-gray-400">{n.part_label}</span>}
            <span className="text-gray-400">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function DeckNotesSection({ deckId }: { deckId: number }) {
  const [notes, setNotes] = useState<DeckNote[] | null>(null);
  const [open, setOpen] = useState(false); // 특이점 요청(2026-09-13): 기본 접힘

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
  const entries = groupSeries(notes);

  return (
    <section className="mb-5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition"
      >
        <span className="text-base font-bold text-gray-900 dark:text-gray-100">📝 강의노트</span>
        <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {entries.length}개 · 외부 링크
          <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>
      {open && (
      <ul className="mt-2 space-y-2">
        {entries.map(({ key, notes: group }) => {
          const n = group[0];
          if (group.length > 1) return <li key={key}><SeriesCard notes={group} /></li>;
          return (
          <li key={key}>
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
                  <NoteMeta n={n} />
                </div>
                <span className="shrink-0 text-gray-400 text-sm">↗</span>
              </div>
            </a>
          </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
