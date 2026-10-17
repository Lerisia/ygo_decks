import { useState } from "react";
import { Link } from "react-router-dom";
import { type DeckListComment, addDeckComment, deleteDeckComment } from "@/api/deckListApi";
import UserName from "@/components/UserName";
import { deckDay } from "@/lib/deckDrafts";

const BOX = "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const SEND = "shrink-0 h-9 px-4 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition";

/** The comments under a deck list (엘리스 2026-10-17, on the inquiry board's base): each with who wrote it and when,
 *  theirs and an operator's with 삭제; a box for a member's own, a guest sent to sign in. */
export default function DeckComments({ code, comments, admin, signedIn, next, onChange }: {
  code: string;
  comments: DeckListComment[];
  admin: boolean;
  signedIn: boolean;
  /** where to come back to after signing in */
  next: string;
  onChange: (comments: DeckListComment[]) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const c = await addDeckComment(code, text);
      onChange([...comments, c]);
      setBody("");
    } catch (e) {
      setError((e as Error).message || "댓글을 올리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: DeckListComment) => {
    if (!window.confirm("이 댓글을 지울까요?")) return;
    try {
      await deleteDeckComment(c.id);
      onChange(comments.filter((x) => x.id !== c.id));
    } catch (e) {
      setError((e as Error).message || "댓글을 지우지 못했습니다.");
    }
  };
  return (
    <section className="mt-8" aria-label="댓글">
      <h2 className="m-0 text-base font-bold">
        댓글 {comments.length > 0 && <span className="text-blue-600 dark:text-blue-400 tabular-nums">{comments.length}</span>}
      </h2>
      {comments.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 list-none p-0 m-0">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <UserName user={c.author} size={22} className="text-sm text-gray-800 dark:text-gray-100" />
                <span className="tabular-nums">{deckDay(c.created_at)}</span>
                {(c.mine || admin) && (
                  <button type="button" onClick={() => remove(c)} className="ml-auto p-0 border-0 bg-transparent text-red-500 hover:underline">
                    삭제
                  </button>
                )}
              </div>
              <p className="mt-1.5 mb-0 text-sm whitespace-pre-wrap break-words leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 mb-0 text-sm text-gray-500 dark:text-gray-400">아직 댓글이 없습니다.</p>
      )}
      {signedIn ? (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={3000}
            rows={3}
            placeholder="댓글 쓰기"
            aria-label="댓글 쓰기"
            className={BOX}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
            <button type="button" onClick={submit} disabled={busy || !body.trim()} className={SEND}>
              {busy ? "올리는 중…" : "댓글 올리기"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 mb-0 text-sm text-gray-500 dark:text-gray-400">
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="text-blue-600 dark:text-blue-400 hover:underline">로그인</Link>하면 댓글을 쓸 수 있습니다.
        </p>
      )}
    </section>
  );
}
