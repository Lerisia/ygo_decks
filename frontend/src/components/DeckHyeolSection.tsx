import { useEffect, useState } from "react";
import { getDeckHyeol, DeckHyeol } from "@/api/deckApi";

// 상대법 — 혈자리 아카이브(듀얼 아카이브, Hort) 요약. 제작자 요청(2026-10-02)으로 잔존계 패 트랩 효과만 카드 그림과 함께 보여 주고
// 패트랩별 사용 위치·순위·타이밍은 mdarchive에서 보도록 연결한다.

// 아픔 / 할만함 / 효과 적음 — ring + badge colour per level
const LEVEL: Record<string, { ring: string; badge: string }> = {
  high: { ring: "ring-red-500", badge: "bg-red-500 text-white" },
  conditional: { ring: "ring-amber-500", badge: "bg-amber-500 text-white" },
  low: { ring: "ring-emerald-500", badge: "bg-emerald-500 text-white" },
};
const levelOf = (level: string) =>
  LEVEL[level === "very_high" ? "high" : level === "medium" ? "conditional" : level === "none" ? "low" : level] ??
  { ring: "ring-gray-300 dark:ring-gray-600", badge: "bg-gray-400 text-white" };

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
          <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </span>
      </button>

      {open && data && (
        <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3">
          {data.overview.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">잔존계 패 트랩 효과</p>
              <ul className="grid grid-cols-5 gap-2 sm:gap-3">
                {data.overview.map((o) => {
                  const lv = levelOf(o.level);
                  return (
                    <li key={o.t} className="flex flex-col items-center text-center min-w-0">
                      <div className={`w-full aspect-square rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 ring-2 ${lv.ring}`}>
                        {o.image && <img loading="lazy" src={o.image} alt={o.name} className="w-full h-full object-cover" />}
                      </div>
                      <span className={`mt-1.5 px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-bold leading-tight ${lv.badge}`}>{o.label}</span>
                      <span className="mt-1 text-[10px] sm:text-xs leading-tight text-gray-700 dark:text-gray-300 break-keep">{o.name}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <a
            href={data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
          >
            패트랩 사용 타이밍 자세히 보기 ↗
          </a>
          <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">
            자료 제공: 듀얼 아카이브 · 혈자리 아카이브 (Hort)
          </p>
        </div>
      )}
    </section>
  );
}
