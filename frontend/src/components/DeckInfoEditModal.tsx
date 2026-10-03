import { useEffect, useState } from "react";
import { getDeckEditInfo, saveDeckEditInfo, DeckEditInfo, DeckEditValues, DeckStats } from "@/api/deckApi";
import { chipClass } from "@/components/ThemeSearchChip";
import { UNKNOWN_STAT } from "@/utils/deckStats";

// 운영자 전용: 덱 문서에서 덱 정보(파워·난이도·타입·아트·소환법·태그·엔진)와 스탯을 고친다 (특이점 2026-10-03).

const STATS: { key: keyof DeckStats; label: string }[] = [
  { key: "consistency", label: "안정성" },
  { key: "breakthrough", label: "돌파력" },
  { key: "interruption", label: "견제력" },
  { key: "recovery", label: "복구력" },
  { key: "deck_space", label: "덱 스페이스" },
];
const STAT_VALUES = Array.from({ length: UNKNOWN_STAT + 1 }, (_, i) => i);

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

interface Props {
  deckId: number;
  deckName: string;
  onClose: () => void;
  onSaved: (deck: unknown) => void;
}

export default function DeckInfoEditModal({ deckId, deckName, onClose, onSaved }: Props) {
  const [info, setInfo] = useState<DeckEditInfo | null>(null);
  const [form, setForm] = useState<DeckEditValues | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDeckEditInfo(deckId)
      .then((d) => {
        setInfo(d);
        setForm(d.values);
      })
      .catch((e) => setLoadError(e.message));
  }, [deckId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const dirty = !!info && !!form && JSON.stringify(info.values) !== JSON.stringify(form);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await saveDeckEditInfo(deckId, form);
      onSaved(res.deck);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      setSaving(false);
    }
  };

  const set = <K extends keyof DeckEditValues>(key: K, value: DeckEditValues[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const single = (key: "strength" | "difficulty" | "deck_type" | "art_style", label: string) =>
    info &&
    form && (
      <Field label={label}>
        {info.options[key].map((o) => (
          <button key={o.value} type="button" className={chipClass(form[key] === o.value)} onClick={() => set(key, o.value)}>
            {o.label}
          </button>
        ))}
      </Field>
    );

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${deckName} 덱 정보 수정`}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-left">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <p className="flex-1 min-w-0 font-bold text-gray-900 dark:text-gray-100 truncate">{deckName} · 덱 정보 수정</p>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="닫기"
            className="w-8 h-8 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {loadError ? (
            <p className="py-10 text-center text-sm text-red-500">{loadError}</p>
          ) : !info || !form ? (
            <div className="space-y-4 animate-pulse">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i}>
                  <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700 mb-2" />
                  <div className="flex gap-2">
                    {[0, 1, 2, 3].map((j) => (
                      <div key={j} className="h-8 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {single("strength", "덱 파워")}
              {single("difficulty", "난이도")}
              {single("deck_type", "덱 타입")}
              {single("art_style", "아트 스타일")}
              <Field label="소환법">
                {info.options.summoning_methods.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={chipClass(form.summoning_methods.includes(o.value))}
                    onClick={() => set("summoning_methods", toggle(form.summoning_methods, o.value))}
                  >
                    {o.label}
                  </button>
                ))}
              </Field>
              <Field label="태그 (성능적)">
                {info.options.performance_tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={chipClass(form.performance_tags.includes(t))}
                    onClick={() => set("performance_tags", toggle(form.performance_tags, t))}
                  >
                    {t}
                  </button>
                ))}
              </Field>
              <Field label="태그 (비성능적)">
                {info.options.aesthetic_tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={chipClass(form.aesthetic_tags.includes(t))}
                    onClick={() => set("aesthetic_tags", toggle(form.aesthetic_tags, t))}
                  >
                    {t}
                  </button>
                ))}
              </Field>
              <Field label="엔진">
                <button type="button" className={chipClass(form.is_engine)} onClick={() => set("is_engine", !form.is_engine)}>
                  Engine — 다양한 덱에 섞어 사용
                </button>
              </Field>
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">스탯 (11 = 그래프에 ?)</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {STATS.map(({ key, label }) => (
                    <label key={key} className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
                      {label}
                      <select
                        value={form.stats[key] ?? ""}
                        onChange={(e) =>
                          set("stats", { ...form.stats, [key]: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
                      >
                        <option value="">-</option>
                        {STAT_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {v === UNKNOWN_STAT ? "11 (?)" : v}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          {saveError && <p className="flex-1 text-sm text-red-500">{saveError}</p>}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
