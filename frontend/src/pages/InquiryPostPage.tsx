import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAdmin, isAuthenticated } from "@/api/accountApi";
import {
  BOARD_INFO,
  InquiryError,
  answerInquiry,
  deleteInquiry,
  deleteInquiryAnswer,
  formatInquiryDate,
  getInquiry,
  type InquiryPost,
} from "@/api/inquiryApi";
import { refreshInquiryAlerts } from "@/lib/inquiryAlerts";

export default function InquiryPostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<InquiryPost | null>(null);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getInquiry(Number(id))
      .then(setPost)
      .catch((e) => {
        // A private post comes back 403 with its title, so the page can still say what is locked.
        if (e instanceof InquiryError && e.status === 403 && e.data) setPost(e.data as InquiryPost);
        else setError(e.message || "글을 불러오지 못했습니다.");
      });
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    if (isAuthenticated()) isAdmin().then(setStaff).catch(() => {});
  }, []);

  const removePost = async () => {
    if (!post || !window.confirm("이 글을 지울까요?")) return;
    try {
      await deleteInquiry(post.id);
      refreshInquiryAlerts();
      navigate(`/inquiry/${post.board}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };

  const submitAnswer = async () => {
    if (!post || !answer.trim()) return;
    setBusy(true);
    try {
      await answerInquiry(post.id, answer.trim());
      refreshInquiryAlerts();
      setAnswer("");
      load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "답변을 올리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeAnswer = async (commentId: number) => {
    if (!window.confirm("이 답변을 지울까요?")) return;
    try {
      await deleteInquiryAnswer(commentId);
      refreshInquiryAlerts();
      load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  };

  if (error) {
    return (
      <div className="min-h-screen px-4 py-10 w-full lg:w-[88%] mx-auto text-center text-gray-600 dark:text-gray-300">
        <p>{error}</p>
        <Link to="/inquiry" className="mt-4 inline-block text-blue-600 dark:text-blue-400">← 문의하기</Link>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen px-4 sm:px-6 py-6 w-full lg:w-[88%] mx-auto">
        <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="mt-4 h-7 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="mt-2 h-4 w-40 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="mt-6 h-40 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    );
  }

  const info = BOARD_INFO[post.board];

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 w-full lg:w-[88%] mx-auto text-gray-900 dark:text-white">
      <Link to={`/inquiry/${post.board}`} className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
        ← {info.icon} {info.title}
      </Link>

      <header className="mt-3 pb-3 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl md:text-2xl font-bold leading-snug">
          {post.is_private && <span className="mr-1.5" title="비공개 글">🔒</span>}
          {post.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>익명{post.mine ? " (내 글)" : ""}</span>
          <span>{formatInquiryDate(post.created_at)}</span>
          <span
            className={`px-2 py-0.5 rounded-full font-semibold ${
              post.answered ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900" : "border border-gray-300 dark:border-gray-600"
            }`}
          >
            {post.answered ? "✓ 답변 완료" : "답변 대기"}
          </span>
          {post.author_name && <span className="text-amber-700 dark:text-amber-400">작성자 {post.author_name} (운영진에게만 보임)</span>}
          {post.notify_email != null && <span>{post.notify_email ? "✉️ 답변 메일 알림 켬" : "메일 알림 끔"}</span>}
          {(post.mine || staff) && post.can_view && (
            <button type="button" onClick={removePost} className="ml-auto text-red-500 hover:underline bg-transparent p-0 border-0">
              글 지우기
            </button>
          )}
        </div>
      </header>

      {!post.can_view ? (
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-10 text-center">
          <div className="text-3xl" aria-hidden="true">🔒</div>
          <p className="mt-2 font-semibold">비공개 글입니다</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">글쓴이와 운영진만 내용을 볼 수 있어요.</p>
          {!isAuthenticated() && (
            <Link to="/login" className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400">내가 쓴 글이라면 로그인해 주세요 →</Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 whitespace-pre-wrap break-words leading-relaxed">{post.body}</div>

          <section className="mt-8">
            <h2 className="text-base font-bold">운영진 답변 {post.comments?.length ? <span className="text-blue-600 dark:text-blue-400">{post.comments.length}</span> : null}</h2>
            {post.comments && post.comments.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-3">
                {post.comments.map((c) => (
                  <li key={c.id} className="rounded-xl border border-blue-100 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 p-4">
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-semibold text-blue-700 dark:text-blue-300">운영진</span>
                      <span>{formatInquiryDate(c.created_at)}</span>
                      {staff && (
                        <button type="button" onClick={() => removeAnswer(c.id)} className="ml-auto text-red-500 hover:underline bg-transparent p-0 border-0">
                          삭제
                        </button>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{c.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">아직 답변이 없습니다. 운영진이 확인하는 대로 답변을 달아 드릴게요.</p>
            )}

            {staff && (
              <div className="mt-4 flex flex-col gap-2">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  maxLength={3000}
                  rows={4}
                  placeholder="답변 쓰기 (운영진만 보이는 칸, 답변은 '운영진'으로 표시됩니다)"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {post.notify_email ? "글쓴이가 메일 알림을 켜 두어, 답변을 올리면 알림 메일이 함께 나갑니다." : "글쓴이가 메일 알림을 켜지 않았습니다."}
                  </span>
                  <button
                    type="button"
                    onClick={submitAnswer}
                    disabled={busy || !answer.trim()}
                    className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed"
                  >
                    {busy ? "올리는 중…" : "답변 올리기"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
