import { useEffect, useState } from "react";
import { getDeckHyeol, DeckHyeol } from "@/api/deckApi";

// 상대법 — 혈자리 아카이브(듀얼 아카이브, Hort) 요약. 제작자 요청(2026-10-02)으로 간단한 정보만 보여 주고
// 2·3순위·타이밍·이유 같은 자세한 내용은 mdarchive에서 보도록 연결한다.

const levelStyle = (level: string) =>
  level === "very_high" || level === "high"
    ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800"
    : level === "conditional" || level === "medium"
    ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800"
    : level === "low" || level === "none"
    ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
    : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600";

export default function DeckHyeolSection({ deckId }: { deckId: number }) {
  const [data, setData] = useState<DeckHyeol | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getDeckHyeol(deckId).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [deckId]);

  return (
    <section className="mb-5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition"
      >
        <span className="text-base font-bold text-gray-900 dark:text-gray-100">🎯 상대법</span>
        <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {data ? `패트랩 ${data.sections.length}종` : ""}
          <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>

      {open && data && (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3">
          {data.overview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">드로우·서치 견제</p>
              <div className="flex flex-wrap gap-1.5">
                {data.overview.map((o) => (
                  <span key={o.t} className={`px-2 py-1 rounded-full border text-xs font-semibold ${levelStyle(o.level)}`}>
                    {o.short} · {o.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.sections.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">패트랩 1순위</p>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.sections.map((s) => (
                  <li key={s.id} className="py-1.5 flex gap-3 text-sm">
                    <span className="w-36 shrink-0 font-semibold text-gray-900 dark:text-gray-100">{s.short}</span>
                    <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-300">{s.cards.map((c) => c.name).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <a
            href={data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
          >
            혈자리 아카이브에서 순위·타이밍·이유 자세히 보기 ↗
          </a>
          <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">
            자료 제공: 듀얼 아카이브 · 혈자리 아카이브 (Hort) — 의견과 제보는 혈자리 아카이브에 남겨 주세요.
          </p>
        </div>
      )}
    </section>
  );
}
