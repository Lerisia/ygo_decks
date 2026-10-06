import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { isAuthenticated, getUserInfo } from "@/api/accountApi";
import {
  BOARD_INFO,
  createInquiry,
  formatInquiryDate,
  listInquiries,
  type InquiryBoard,
  type InquiryPage,
} from "@/api/inquiryApi";

const isBoard = (b: string | undefined): b is InquiryBoard => b === "deck" || b === "site";

function WriteForm({ board, onCancel }: { board: InquiryBoard; onCancel: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [notify, setNotify] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getUserInfo().then((u) => setEmail(u?.email ?? null)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError("제목과 내용을 모두 써 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const post = await createInquiry({ board, title: title.trim(), body: body.trim(), is_private: isPrivate, notify_email: notify });
      navigate(`/inquiry/post/${post.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "글을 올리지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-white dark:bg-gray-800 p-4 flex flex-col gap-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        placeholder="제목"
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        rows={8}
        placeholder={BOARD_INFO[board].placeholder}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="text-right text-xs text-gray-400 tabular-nums -mt-2">{body.length.toLocaleString()} / 5,000</div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
        <span>
          🔒 <b>비공개로 쓰기</b>
          <span className="block text-xs text-gray-500 dark:text-gray-400">내용은 나와 운영진만 볼 수 있어요. 제목은 목록에 보입니다.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
        <span>
          ✉️ <b>답변이 달리면 메일로 알려 주기</b>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            가입할 때 쓴 메일{email ? ` (${email})` : ""}로 보내 드려요.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed"
        >
          {busy ? "올리는 중…" : "올리기"}
        </button>
      </div>
    </div>
  );
}

export default function InquiryBoardPage() {
  const { board } = useParams();
  const [page, setPage] = useState(1);
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<InquiryPage | null>(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const loggedIn = isAuthenticated();

  const load = useCallback(() => {
    if (!isBoard(board)) return;
    setError("");
    listInquiries(board, page, mine)
      .then(setData)
      .catch((e) => setError(e.message || "목록을 불러오지 못했습니다."));
  }, [board, page, mine]);

  useEffect(load, [load]);
  useEffect(() => {
    setPage(1);
    setWriting(false);
  }, [board]);

  if (!isBoard(board)) return <Navigate to="/inquiry" replace />;
  const info = BOARD_INFO[board];
  const other: InquiryBoard = board === "deck" ? "site" : "deck";

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 max-w-2xl mx-auto text-gray-900 dark:text-white">
      <Link to="/inquiry" className="text-sm text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">← 문의하기</Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold">
            <span aria-hidden="true">{info.icon} </span>
            {info.title}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{info.desc}</p>
        </div>
        {!writing && (
          loggedIn ? (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
            >
              ✏️ 글쓰기
            </button>
          ) : (
            <Link to="/login" className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
              로그인하고 글쓰기
            </Link>
          )
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <Link to={`/inquiry/${other}`} className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
          {BOARD_INFO[other].icon} {BOARD_INFO[other].title} →
        </Link>
        {loggedIn && (
          <label className="flex items-center gap-1.5 cursor-pointer text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} className="w-4 h-4 accent-blue-600" />
            내 글만
          </label>
        )}
      </div>

      {writing && (
        <div className="mt-4">
          <WriteForm board={board} onCancel={() => setWriting(false)} />
        </div>
      )}

      {data?.unanswered != null && (
        <p className="mt-4 text-sm font-semibold text-amber-700 dark:text-amber-400">운영진 확인: 답변 대기 {data.unanswered}건</p>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="mt-4 divide-y divide-gray-200 dark:divide-gray-700 border-y border-gray-200 dark:border-gray-700">
        {data === null && !error
          ? Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="py-3">
                <div className="h-5 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div className="mt-2 h-3.5 w-1/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </li>
            ))
          : data?.results.map((p) => (
              <li key={p.id}>
                <Link to={`/inquiry/post/${p.id}`} className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition px-1">
                  <div className="flex items-start gap-2">
                    <span
                      className={`min-w-0 flex-1 font-semibold leading-snug ${p.can_view ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}
                    >
                      {p.is_private && <span className="mr-1" title="비공개 글">🔒</span>}
                      {p.title}
                      {p.comment_count ? <span className="ml-1.5 text-sm text-blue-600 dark:text-blue-400">[{p.comment_count}]</span> : null}
                    </span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        p.answered
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {p.answered ? "답변 완료" : "답변 대기"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    익명{p.mine ? " (내 글)" : ""} · {formatInquiryDate(p.created_at)}
                    {p.author_name && <span className="ml-2 text-amber-700 dark:text-amber-400">작성자 {p.author_name}</span>}
                  </div>
                </Link>
              </li>
            ))}
        {data && data.results.length === 0 && (
          <li className="py-10 text-center text-sm text-gray-500">{mine ? "내가 쓴 글이 없습니다." : "아직 글이 없습니다."}</li>
        )}
      </ul>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-40"
          >
            ← 이전
          </button>
          <span className="tabular-nums text-gray-600 dark:text-gray-300">{page} / {data.pages}</span>
          <button
            type="button"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-40"
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  );
}
