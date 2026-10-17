import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getUserInfo, isAuthenticated } from "@/api/accountApi";
import { type DeckListBanlistKind, type DeckListPage, createDeckList, listDeckLists } from "@/api/deckListApi";
import DeckListCard, { DeckListAddCard } from "@/components/deckbuilder/DeckListCard";
import Dropdown from "@/components/Dropdown";
import SearchForm from "@/components/SearchForm";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import { type DeckDraft, clearLocalDrafts, localDrafts } from "@/lib/deckDrafts";
import { NEW_DECK_PATH, deckListPath } from "@/lib/deckListPaths";

const ADD_BUTTON = "shrink-0 inline-flex items-center h-9 px-4 rounded-lg font-semibold text-sm transition bg-blue-600 hover:bg-blue-700 text-white";
const CHIP = "inline-flex items-center gap-1 h-9 px-3 rounded-lg border text-sm font-semibold transition";
const CHIP_OFF = `${CHIP} border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500`;
const CHIP_ON = `${CHIP} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const PAGE_BUTTON = "px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-40";
const KINDS: { value: DeckListBanlistKind | "all"; label: string }[] = [
  { value: "all", label: "모든 금제" }, { value: "md", label: "마스터 듀얼" }, { value: "ocg", label: "OCG" }, { value: "tcg", label: "TCG" }, { value: "none", label: "무금제" },
];

/** The decks the first layout kept in this browser go to the member's account, once (2026-10-14). */
async function moveLocalDrafts() {
  const kept: DeckDraft[] = [];
  const local = localDrafts();
  for (const d of local) {
    try {
      await createDeckList({ name: d.name.trim() || "이름 없는 덱", description: d.description, main: d.main, extra: d.extra });
    } catch {
      kept.push(d);
    }
  }
  if (local.length) clearLocalDrafts(kept);
}

/** 덱리 게시판 (/dev/decklists): every deck list members have posted (엘리스 2026-10-17: there is no 마이덱 — a deck is
 *  made here and read here), the newest first, narrowed by the 금제 it is checked by, one's own, and its name; 20 a page, the page and the narrowing kept in the address so the
 *  way back finds them. Anyone reads; posting takes signing in. Operators only while it is laid out. */
export default function DeckLists() {
  const admin = useAdminOnly();
  const signedIn = isAuthenticated();
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.some((k) => k.value === params.get("banlist")) ? params.get("banlist") : "all") as DeckListBanlistKind | "all";
  const author = params.get("author") || "";
  const q = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [data, setData] = useState<DeckListPage | null>(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState(q);
  const [me, setMe] = useState("");
  const narrowed = !!(author || q || kind !== "all");

  // one change to the address at a time; a narrowing starts again from the first page
  const change = (next: Record<string, string | undefined>, keepPage = false) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (!keepPage) p.delete("page");
    setParams(p, { replace: false });
  };

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setData(null);
    setError("");
    (signedIn ? moveLocalDrafts() : Promise.resolve())
      .catch(() => {})
      .then(() => listDeckLists({ page, banlist: kind === "all" ? undefined : kind, author: author || undefined, q: q || undefined }))
      .then((got) => alive && setData(got))
      .catch(() => alive && setError("덱리 게시판을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [admin, signedIn, page, kind, author, q]);
  useEffect(() => setTyped(q), [q]);
  useEffect(() => {
    if (!signedIn) return;
    getUserInfo().then((u) => u?.username && setMe(u.username), () => {});
  }, [signedIn]);
  if (!admin) return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen w-full max-w-5xl mx-auto px-4 py-6">
      <div className="h-9 flex items-center justify-between gap-3">
        <h1 className="m-0 text-xl font-bold">덱리 게시판</h1>
        <Link to={NEW_DECK_PATH} className={ADD_BUTTON}>+ 덱 리스트 올리기</Link>
      </div>
      {/* the narrowing: the 금제, one's own, the name */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Dropdown value={kind} options={KINDS} onChange={(v) => change({ banlist: v === "all" ? undefined : v })} label="금제" className="h-9 px-3 rounded-lg text-sm" />
        {signedIn && me && (
          <button
            type="button"
            onClick={() => change({ author: author === me ? undefined : me })}
            aria-pressed={author === me}
            className={author === me ? CHIP_ON : CHIP_OFF}
          >
            내 글
          </button>
        )}
        {author && author !== me && (
          <button type="button" onClick={() => change({ author: undefined })} className={CHIP_ON} title="이 작성자 풀기">
            {author} <span aria-hidden>✕</span>
          </button>
        )}
        <SearchForm onSearch={() => change({ q: typed.trim() || undefined })}>
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="덱 이름 검색"
            aria-label="덱 이름 검색"
            enterKeyHint="search"
            className="h-9 w-40 sm:w-48 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </SearchForm>
      </div>
      {error ? (
        <p className="py-16 text-center text-gray-500">{error}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 list-none p-0">
          {data === null ? (
            Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[8.25rem] rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />)
          ) : data.results.length ? (
            data.results.map((d) => (
              <li key={d.code}>
                <DeckListCard
                  deck={{ name: d.name, description: d.description, createdAt: d.created_at, updatedAt: d.updated_at }}
                  to={deckListPath(d.code)}
                  author={d.author}
                  comments={d.comment_count ?? 0}
                  isPrivate={d.is_private}
                  mainCount={d.main_count}
                  extraCount={d.extra_count}
                />
              </li>
            ))
          ) : narrowed ? (
            <li className="sm:col-span-2 lg:col-span-3 py-10 text-center text-sm text-gray-500">맞는 덱 리스트가 없습니다.</li>
          ) : (
            <li>
              <DeckListAddCard to={NEW_DECK_PATH} />
            </li>
          )}
        </ul>
      )}
      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => change({ page: String(page - 1) }, true)} className={PAGE_BUTTON}>← 이전</button>
          <span className="tabular-nums text-gray-600 dark:text-gray-300">{page} / {data.pages}</span>
          <button type="button" disabled={page >= data.pages} onClick={() => change({ page: String(page + 1) }, true)} className={PAGE_BUTTON}>다음 →</button>
        </div>
      )}
    </div>
  );
}
