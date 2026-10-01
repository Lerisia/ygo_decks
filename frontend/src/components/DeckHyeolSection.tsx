import { useEffect, useState } from "react";
import { getDeckHyeol, DeckHyeol, HyeolCard } from "@/api/deckApi";

// 혈자리 아카이브(듀얼 아카이브, Hort) 요약 — 특이점 요청(2026-10-02), 자료 사용 허락받음.
const SEV: Record<string, { label: string; badge: string; ring: string }> = {
  R: { label: "1순위", badge: "bg-red-500 text-white", ring: "ring-red-400" },
  Y: { label: "2순위", badge: "bg-amber-500 text-white", ring: "ring-amber-400" },
  G: { label: "3순위", badge: "bg-emerald-500 text-white", ring: "ring-emerald-400" },
  N: { label: "미정", badge: "bg-gray-400 text-white", ring: "ring-gray-300" },
};

const levelStyle = (level: string) =>
  level === "very_high" || level === "high"
    ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800"
    : level === "conditional" || level === "medium"
    ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800"
    : level === "low" || level === "none"
    ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
    : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600";

const formatDate = (s: string) => (s ? `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}` : "");

function CardRow({ c, onOpen }: { c: HyeolCard; onOpen: () => void }) {
  const sev = SEV[c.sev] ?? SEV.N;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:border-transparent focus:outline-none"
    >
      <span className={`relative shrink-0 w-11 h-11 rounded overflow-hidden bg-gray-200 dark:bg-gray-700 ring-2 ${sev.ring}`}>
        {c.image && <img src={c.image} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`shrink-0 px-1 rounded text-[10px] font-bold leading-4 ${sev.badge}`}>{sev.label}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</span>
        </span>
        {(c.timing || c.text) && (
          <span className="block text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{c.timing || c.text}</span>
        )}
      </span>
    </button>
  );
}

function CardDetail({ c, trap, onClose }: { c: HyeolCard; trap: string; onClose: () => void }) {
  const sev = SEV[c.sev] ?? SEV.N;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3">
          {c.image && <img src={c.image} alt={c.name} className="w-24 h-24 object-cover rounded-md shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">{trap}</p>
            <p className="font-bold text-gray-900 dark:text-gray-100 leading-snug">{c.name}</p>
            <span className={`inline-block mt-1 px-1.5 rounded text-[11px] font-bold ${sev.badge}`}>{sev.label}</span>
            {c.timing && <p className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-200">타이밍: {c.timing}</p>}
          </div>
        </div>
        {c.text && <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{c.text}</p>}
        {c.desc && (
          <p className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line">{c.desc}</p>
        )}
        <button type="button" onClick={onClose} className="mt-4 w-full py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600">
          닫기
        </button>
      </div>
    </div>
  );
}

export default function DeckHyeolSection({ deckId }: { deckId: number }) {
  const [data, setData] = useState<DeckHyeol | null>(null);
  const [open, setOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ c: HyeolCard; trap: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getDeckHyeol(deckId).then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [deckId]);

  const note = data?.overview.find((o) => o.t === noteFor);

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
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-4">
          {data.overview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">드로우·서치 견제</p>
              <div className="flex flex-wrap gap-1.5">
                {data.overview.map((o) => (
                  <button
                    key={o.t}
                    type="button"
                    onClick={() => setNoteFor((v) => (v === o.t ? null : o.t))}
                    className={`px-2 py-1 rounded-full border text-xs font-semibold focus:outline-none hover:border-transparent ${levelStyle(o.level)} ${noteFor === o.t ? "ring-2 ring-blue-400" : ""}`}
                  >
                    {o.short} · {o.label}
                  </button>
                ))}
              </div>
              {note?.note && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300">{note.name}: {note.note}</p>}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">어디에 박나</p>
              <span className="flex gap-1">
                {(["R", "Y", "G"] as const).map((k) => (
                  <span key={k} className={`px-1.5 rounded text-[10px] font-bold ${SEV[k].badge}`}>{SEV[k].label}</span>
                ))}
              </span>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.sections.map((s) => (
                <li key={s.id} className="py-2 sm:flex sm:gap-3">
                  <p className="sm:w-24 shrink-0 pt-1 text-sm font-bold text-gray-900 dark:text-gray-100" title={s.hint}>{s.short}</p>
                  <div className="min-w-0 flex-1">
                    {s.note && <p className="px-1 mb-1 text-xs text-gray-600 dark:text-gray-300">{s.note}</p>}
                    {s.cards.map((c, i) => (
                      <CardRow key={`${c.cid}-${i}`} c={c} onOpen={() => setDetail({ c, trap: s.name })} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="pt-2 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400">
            자료: 듀얼 아카이브 · 혈자리 아카이브 (Hort){data.updated_at && ` · ${formatDate(data.updated_at)} 갱신`} ·{" "}
            <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
              자세히 보기·의견 남기기 ↗
            </a>
          </p>
        </div>
      )}
      {detail && <CardDetail c={detail.c} trap={detail.trap} onClose={() => setDetail(null)} />}
    </section>
  );
}
