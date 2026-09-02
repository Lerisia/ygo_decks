import { useEffect, useState } from "react";
import { deleteAnnouncement, getAnnouncements, postAnnouncement, type Announcement } from "@/api/tournamentApi";

const btn = "px-3 py-1.5 text-sm rounded-lg font-semibold transition disabled:opacity-50";
const blueBtn = `${btn} bg-blue-600 text-white hover:bg-blue-700`;

export default function AnnouncementsTab({ tournamentId, isHost }: { tournamentId: number; isHost: boolean }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => getAnnouncements(tournamentId).then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tournamentId]);

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true); setError("");
    try { await postAnnouncement(tournamentId, content.trim(), pinned); setContent(""); setPinned(false); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "등록 실패"); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {isHost && (
        <div className="mb-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <textarea
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-sm dark:text-white"
            rows={3} placeholder="참가자에게 알릴 내용" value={content} onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center justify-between mt-2">
            <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-blue-600" />
              상단 고정
            </label>
            <button className={blueBtn} disabled={busy || !content.trim()} onClick={submit}>공지 등록</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">등록된 공지가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className={`rounded-lg border p-3 bg-white dark:bg-gray-800 ${a.pinned ? "border-blue-300 dark:border-blue-700" : "border-gray-200 dark:border-gray-700"}`}>
              <div className="flex items-center justify-between mb-1 text-xs text-gray-500 dark:text-gray-400">
                <span>{a.pinned && <span className="mr-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">고정</span>}
                  {new Date(a.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                {isHost && (
                  <button className="text-red-500 hover:underline" onClick={async () => { await deleteAnnouncement(a.id); load(); }}>삭제</button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{a.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
