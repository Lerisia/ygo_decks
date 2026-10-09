import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createChangelog, updateChangelog, type ChangelogEntry, type ChangelogDraft } from "@/api/changelogApi";

// 운영진이 사이트에서 바로 공지를 쓰고 고친다 (특이점 2026-10-03). 양식은 "[M/D] 제목" + 짧은 목록.

const today = () => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const TEMPLATES = [
  { label: "업데이트 공지", title: () => `[${today()}] `, body: "- ", deck: false },
  { label: "새 덱 추가 안내", title: () => `[${today()}] 새로운 덱 추가 안내`, body: "이하 덱들의 추가 및 조정을 완료했습니다.\n- ", deck: true },
];

/** ISO time → value for <input type="datetime-local"> in the viewer's time zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  entry?: ChangelogEntry;
  onCancel: () => void;
  onSaved: (entry: ChangelogEntry) => void;
}

export default function ChangelogEditor({ entry, onCancel, onSaved }: Props) {
  const [title, setTitle] = useState(entry?.title ?? `[${today()}] `);
  const [body, setBody] = useState(entry?.body ?? "");
  const [deckNotice, setDeckNotice] = useState(entry?.kind === "deck");
  const [schedule, setSchedule] = useState(!!entry?.scheduled);
  const [when, setWhen] = useState(entry ? toLocalInput(entry.published_at) : "");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    if (body.trim() && !window.confirm("작성 중인 내용을 양식으로 바꿀까요?")) return;
    setTitle(t.title());
    setBody(t.body);
    setDeckNotice(t.deck);
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return setError("제목과 본문을 입력해 주세요.");
    if (schedule && !when) return setError("예약 시각을 정해 주세요.");
    const draft: ChangelogDraft = { title, body, kind: deckNotice ? "deck" : "update" };
    if (schedule) draft.published_at = new Date(when).toISOString();
    else if (entry?.scheduled) draft.published_at = new Date().toISOString(); // 예약을 풀면 지금 게시
    setSaving(true);
    setError("");
    try {
      onSaved(entry ? await updateChangelog(entry.id, draft) : await createChangelog(draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      setSaving(false);
    }
  };

  const tab = (on: boolean) =>
    `px-3 py-1 text-sm rounded-lg ${on ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`;

  return (
    <div className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800/60 rounded-xl shadow-sm p-4 md:p-5 space-y-3 text-left">
      {!entry && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">양식</span>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className="px-3 py-1 text-xs rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="[10/3] 덱 도감 업데이트"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 font-semibold"
      />
      <div className="flex gap-1">
        <button type="button" className={tab(!preview)} onClick={() => setPreview(false)}>
          작성
        </button>
        <button type="button" className={tab(preview)} onClick={() => setPreview(true)}>
          미리보기
        </button>
      </div>
      {preview ? (
        <div className="min-h-[10rem] rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 p-4">
          <p className="text-lg md:text-xl font-semibold mb-2">{title}</p>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={"- 덱 도감 '상대법' 항목을 추가\n- 덱 도감에서 파워별로 테두리 구분 기능 추가"}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
        />
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        마크다운 지원 · 기능 하나당 한 줄, 짧은 목록으로 · 늘 갱신되는 콘텐츠(강의노트 추가 등)는 공지하지 않음
      </p>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={deckNotice} onChange={(e) => setDeckNotice(e.target.checked)} />
        📦 정기 덱 추가 공지 <span className="text-xs text-gray-500 dark:text-gray-400">(초록색으로 표시)</span>
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!schedule} onChange={() => setSchedule(false)} />
          {entry && !entry.scheduled ? "게시 시각 유지" : "바로 게시"}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={schedule} onChange={() => setSchedule(true)} />
          {entry && !entry.scheduled ? "게시 시각 변경" : "예약 게시"}
        </label>
        {schedule && (
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          />
        )}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {saving ? "저장 중…" : entry ? "수정 저장" : "게시"}
        </button>
      </div>
    </div>
  );
}
