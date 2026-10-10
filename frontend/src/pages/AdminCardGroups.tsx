import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CardSearchModal, { type CardSearchResult } from "@/components/CardSearchModal";
import {
  editCardGroupMember,
  getCardGroup,
  listCardGroups,
  updateCardGroup,
  type CardGroupDetail,
  type CardGroupListResponse,
  type MemberHow,
  type NameSource,
} from "@/api/cardGroupAdminApi";

/** Staff review of 카드군: the groups worked out from the Japanese card texts. Korean names come from pairing
 *  Japanese 「」 with Korean "" in the same card texts; the uncertain ones are listed first. Edits here
 *  survive the nightly rebuild. */

const SOURCE_LABEL: Record<NameSource, string> = {
  pair: "효과문 대조",
  quote: "한국어 효과문",
  common: "카드 이름 공통 부분",
  manual: "운영진",
  none: "없음",
};

const HOW_LABEL: Record<MemberHow, string> = {
  name: "이름",
  reading: "읽는 법",
  treated: "취급 문구",
  added: "운영진 추가",
  removed: "운영진 제외",
};

const HOW_STYLE: Record<MemberHow, string> = {
  name: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  reading: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  treated: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  added: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  removed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function AdminCardGroups() {
  const navigate = useNavigate();
  const [list, setList] = useState<CardGroupListResponse | null>(null);
  const [q, setQ] = useState("");
  const [reviewOnly, setReviewOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<CardGroupDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const detailRef = useRef<HTMLElement>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await listCardGroups({ q: q.trim() || undefined, review: reviewOnly, page }));
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }, [q, reviewOnly, page]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setPage(1); }, [q, reviewOnly]);

  const open = async (id: number) => {
    setSelected(id);
    setErr("");
    try {
      const d = await getCardGroup(id);
      setDetail(d);
      setNameDraft(d.group.name_ko);
      // On narrow screens the detail sits under the list — bring it into view.
      if (window.innerWidth < 1024) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  };

  const apply = async (work: () => Promise<CardGroupDetail>) => {
    setBusy(true);
    setErr("");
    try {
      const d = await work();
      setDetail(d);
      setNameDraft(d.group.name_ko);
      setList((prev) => prev && {
        ...prev,
        results: prev.results.map((r) => (r.id === d.group.id ? d.group : r)),
        review_count: prev.review_count - (prev.results.find((r) => r.id === d.group.id)?.needs_review && !d.group.needs_review ? 1 : 0),
      });
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const g = detail?.group;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.page_size)) : 1;
  const nameChanged = !!g && nameDraft.trim() !== "" && nameDraft.trim() !== g.name_ko;

  return (
    <div className="min-h-screen px-4 py-4 max-w-7xl mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >← 관리 메인</button>

      <h1 className="text-2xl font-bold mb-1">카드군</h1>
      <p className="text-sm text-gray-500 mb-4">
        일본어 효과문에서 카드군을 뽑아, 이름에 그 글자가 쓰인 카드와 취급 문구가 있는 카드를 모았습니다.
        한국어 이름이 불확실한 카드군이 위에 나옵니다. 여기서 고친 이름과 회원은 다시 계산해도 유지됩니다.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
          전체 <b>{list?.all_count ?? "–"}</b>
        </span>
        <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          확인 필요 <b>{list?.review_count ?? "–"}</b>
        </span>
      </div>

      {err && (
        <div className="mb-3 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <section className="lg:col-span-2">
          <div className="flex gap-2 mb-2">
            <input
              id="card-group-search"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="일본어·한국어로 찾기"
              className="flex-1 min-w-0 border rounded-lg px-3 py-2 bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              onClick={() => setReviewOnly((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${reviewOnly
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-200"}`}
            >확인 필요만</button>
          </div>

          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {!list && Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="h-[60px] px-3 py-2">
                <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-2" />
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
              </li>
            ))}
            {list && list.results.length === 0 && (
              <li className="px-3 py-6 text-sm text-gray-500 text-center">해당하는 카드군이 없습니다.</li>
            )}
            {list?.results.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => open(r.id)}
                  className={`w-full h-[60px] text-left px-3 py-2 transition ${selected === r.id
                    ? "bg-blue-50 dark:bg-blue-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/60"}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold truncate">「{r.text}」</span>
                    {r.reading && <span className="text-xs text-gray-400 truncate">{r.reading}</span>}
                    <span className="ml-auto text-xs text-gray-500 shrink-0 tabular-nums">{r.members}장</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm min-w-0">
                    <span className={`truncate ${r.name_ko ? "" : "text-gray-400"}`}>{r.name_ko || "이름 없음"}</span>
                    {r.needs_review && <span className="shrink-0 text-[11px] px-1.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">확인 필요</span>}
                    {r.name_source === "manual" && <span className="shrink-0 text-[11px] px-1.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">운영진</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {list && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-2 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-40"
              >이전</button>
              <span className="tabular-nums">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 disabled:opacity-40"
              >다음</button>
            </div>
          )}
        </section>

        <section ref={detailRef} className="lg:col-span-3 scroll-mt-4">
          {!g && (
            <div className="h-full min-h-[200px] flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500">
              왼쪽에서 카드군을 고르세요.
            </div>
          )}
          {g && detail && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <h2 className="text-xl font-bold">「{g.text}」</h2>
                {g.reading && <span className="text-sm text-gray-500">{g.reading}</span>}
                {g.md_list && <span className="text-[11px] px-1.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">마듀 목록과 일치</span>}
              </div>
              <p className="text-xs text-gray-500 mb-3">
                이름 출처: {SOURCE_LABEL[g.name_source]}
                {g.name_source === "pair" && <> · 효과문 일치 {pct(g.name_agreement)}</>}
                {g.name_source !== "manual" && <> · 회원 이름에 포함 {pct(g.name_coverage)}</>}
              </p>

              <div className="flex gap-2 mb-2">
                <input
                  id="card-group-name"
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="한국어 이름"
                  className="flex-1 min-w-0 border rounded-lg px-3 py-2 bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  disabled={busy || !nameChanged}
                  onClick={() => apply(() => updateCardGroup(g.id, { name_ko: nameDraft.trim() }))}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${busy || !nameChanged
                    ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                >이름 저장</button>
              </div>
              {g.needs_review && g.name_ko && (
                <button
                  disabled={busy}
                  onClick={() => apply(() => updateCardGroup(g.id, { reviewed: true }))}
                  className="mb-3 px-4 py-2 rounded-lg font-semibold transition bg-gray-500 hover:bg-gray-600 text-white text-sm"
                >이 이름이 맞음</button>
              )}

              {(g.parent || detail.children.length > 0) && (
                <div className="mb-3 text-sm flex flex-wrap items-center gap-1.5">
                  {g.parent && (
                    <>
                      <span className="text-gray-500">상위</span>
                      <button onClick={() => open(g.parent!.id)} className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                        「{g.parent.text}」 {g.parent.name_ko}
                      </button>
                    </>
                  )}
                  {detail.children.length > 0 && <span className="text-gray-500 ml-1">하위</span>}
                  {detail.children.map((c) => (
                    <button key={c.id} onClick={() => open(c.id)} className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">
                      「{c.text}」 {c.name_ko} <span className="text-gray-400 tabular-nums">{c.members}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">회원 {g.members}장</h3>
                <button
                  onClick={() => setSearchOpen(true)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold transition bg-blue-600 hover:bg-blue-700 text-white"
                >카드 추가</button>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {detail.members.map((m) => (
                  <li
                    key={m.card_id}
                    className={`flex items-center gap-2 p-1.5 rounded-lg border border-gray-100 dark:border-gray-800 ${m.how === "removed" ? "opacity-50" : ""}`}
                  >
                    <div className="w-10 h-10 shrink-0 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      {m.image_url && <img loading="lazy" src={m.image_url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate" title={m.name_ja}>{m.name}</div>
                      <span className={`text-[11px] px-1.5 rounded ${HOW_STYLE[m.how]}`}>{HOW_LABEL[m.how]}</span>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => apply(() => editCardGroupMember(g.id, m.card_id, m.how === "removed" ? "add" : "remove"))}
                      className="shrink-0 text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >{m.how === "removed" ? "되살리기" : "제외"}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <CardSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={() => {}}
        onPickCard={(card: CardSearchResult) => { if (g) apply(() => editCardGroupMember(g.id, card.id, "add")); }}
        copyTargetLabel="카드군"
      />
    </div>
  );
}
