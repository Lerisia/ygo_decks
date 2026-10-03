import { useEffect, useRef, useState } from "react";
import {
  getDeckEditInfo,
  saveDeckEditInfo,
  getNewDeckInfo,
  createDeck,
  replaceDeckCover,
  DeckEditInfo,
  DeckEditValues,
  DeckStats,
  SavedDeck,
} from "@/api/deckApi";
import { chipClass } from "@/components/ThemeSearchChip";
import { UNKNOWN_STAT } from "@/utils/deckStats";

// 운영자 전용 (특이점 2026-10-03): 덱 문서에서 덱 정보·스탯을 고치고, deckId 없이 열면 도감에 새 덱을 추가한다.
// 이름·별칭·대표 이미지·짧은 설명도 같은 창에서 다룬다.

const STATS: { key: keyof DeckStats; label: string }[] = [
  { key: "consistency", label: "안정성" },
  { key: "breakthrough", label: "돌파력" },
  { key: "interruption", label: "견제력" },
  { key: "recovery", label: "복구력" },
  { key: "deck_space", label: "덱 스페이스" },
];
const STAT_VALUES = Array.from({ length: UNKNOWN_STAT + 1 }, (_, i) => i);

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** ISO time → value for <input type="datetime-local"> in the viewer's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const splitAliases = (text: string) => text.split(",").map((a) => a.trim()).filter(Boolean);

interface Props {
  /** Omit to add a new deck. */
  deckId?: number;
  deckName?: string;
  coverUrl?: string | null;
  onClose: () => void;
  onSaved: (deck: SavedDeck) => void;
}

export default function DeckInfoEditModal({ deckId, deckName, coverUrl, onClose, onSaved }: Props) {
  const creating = deckId === undefined;
  const [info, setInfo] = useState<DeckEditInfo | null>(null);
  const [form, setForm] = useState<DeckEditValues | null>(null);
  const [aliasText, setAliasText] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (creating ? getNewDeckInfo() : getDeckEditInfo(deckId))
      .then((d) => {
        setInfo(d);
        setForm(d.values);
        setAliasText(d.values.aliases.join(", "));
      })
      .catch((e) => setLoadError(e.message));
  }, [creating, deckId]);

  useEffect(() => {
    if (!cover) return setPreview(null);
    const url = URL.createObjectURL(cover);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const formChanged = !!info && !!form && JSON.stringify(info.values) !== JSON.stringify(form);
  const dirty = formChanged || !!cover;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaveError("");
    try {
      if (creating) {
        onSaved((await createDeck(form, cover)).deck);
        return;
      }
      let saved = formChanged ? (await saveDeckEditInfo(deckId, form)).deck : null;
      if (cover) saved = (await replaceDeckCover(deckId, cover)).deck;
      if (saved) onSaved(saved);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      setSaving(false);
    }
  };

  const set = <K extends keyof DeckEditValues>(key: K, value: DeckEditValues[K]) => {
    setSaveError("");
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

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
      aria-label={creating ? "새 덱 추가" : `${deckName} 덱 정보 수정`}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-left">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <p className="flex-1 min-w-0 font-bold text-gray-900 dark:text-gray-100 truncate">
            {creating ? "➕ 새 덱 추가" : `${deckName} · 덱 정보 수정`}
          </p>
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
              <div className="flex gap-3">
                <div className="shrink-0 w-24 sm:w-28">
                  <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[11px] text-gray-400">
                    {preview || coverUrl ? (
                      <img src={preview ?? coverUrl ?? ""} alt="" className="w-full h-full object-cover" />
                    ) : (
                      "대표 이미지"
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => setCover(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mt-1.5 w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {preview || coverUrl ? "이미지 바꾸기" : "이미지 고르기"}
                  </button>
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    덱 이름
                    <input
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      maxLength={50}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 font-normal text-gray-900 dark:text-gray-100"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    별칭 <span className="font-normal text-xs text-gray-500 dark:text-gray-400">쉼표로 구분 · 검색에 쓰임</span>
                    <input
                      value={aliasText}
                      onChange={(e) => {
                        setAliasText(e.target.value);
                        set("aliases", splitAliases(e.target.value));
                      }}
                      placeholder="예: 뱀눈, 사안"
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 font-normal text-gray-900 dark:text-gray-100"
                    />
                  </label>
                </div>
              </div>
              <p className="-mt-2 text-xs text-gray-500 dark:text-gray-400">
                대표 이미지는 마스터 듀얼에 있는 카드 일러스트로, 정사각형에 가까운 그림 · 10MB 이하
              </p>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                짧은 설명 <span className="font-normal text-xs text-gray-500 dark:text-gray-400">표 옆에 나오는 2~3문장</span>
                <textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-normal text-gray-900 dark:text-gray-100"
                />
              </label>
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
              <Field label="업데이트 예정">
                <button
                  type="button"
                  className={chipClass(form.is_upcoming)}
                  onClick={() => {
                    if (form.is_upcoming) set("upcoming_until", null);
                    set("is_upcoming", !form.is_upcoming);
                  }}
                >
                  Update — 업데이트 예정 덱
                </button>
                {form.is_upcoming && (
                  <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    자동 해제
                    <input
                      type="datetime-local"
                      value={toLocalInput(form.upcoming_until)}
                      onChange={(e) => set("upcoming_until", e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400">비워 두면 직접 끌 때까지 유지</span>
                  </label>
                )}
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
            {saving ? "저장 중…" : creating ? "추가" : "저장"}
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
