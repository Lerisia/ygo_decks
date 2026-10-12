import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import ComboBox, { type ComboItem } from "@/components/ComboBox";
import DexTabs from "@/components/DexTabs";
import SearchForm from "@/components/SearchForm";
import {
  type CardFilters, type CardListItem, type CardOptions,
  EMPTY_FILTERS, filtersToSearch, getCardOptions, listCards, searchToFilters, sortDir,
} from "@/api/cardDexApi";

const SELECT = "w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm disabled:opacity-50";
const GRID = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3";
// Master Duel's sorts, each either way (엘리스 10/12), under its names; 디폴트 순: each monster frame before its pendulum,
// low levels first, then spells and traps
const SORTS = [
  { value: "new", label: "최신 카드순" },
  { value: "type", label: "디폴트 순" },
  { value: "name", label: "이름순" },
  { value: "rarity", label: "레어리티" },
  { value: "level", label: "레벨 / 랭크 / 링크" },
  { value: "atk", label: "공격력" },
  { value: "def", label: "수비력" },
];

const SORT_KEY = "card_list_sort";

/** The viewer's last sort and its way, kept in this browser (엘리스 10/12); an address that names one wins. */
function withRememberedSort(f: CardFilters, search: string): CardFilters {
  const qs = new URLSearchParams(search);
  if (qs.has("sort") || qs.has("dir")) return f;
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (SORTS.some((s) => s.value === saved?.sort) && ["", "asc", "desc"].includes(saved.dir)) {
      return { ...f, sort: saved.sort, dir: saved.dir };
    }
  } catch {
    /* no storage: the default sort */
  }
  return f;
}

function rememberSort(f: CardFilters) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sort: f.sort, dir: f.dir }));
  } catch {
    /* private mode: the choice lasts while the page is open */
  }
}

const hasFilter = (f: CardFilters) =>
  !!(f.category || f.frame || f.attribute || f.race || f.level || f.st || f.group || f.card || f.deck || f.has);
// The filter panel opens by itself only for what is chosen in it: a 카드군 or a card's support list reached from a card
// page shows its name and ✕ above the list instead (엘리스 2026-10-11).
const panelFilter = (f: CardFilters) => !!(f.category || f.frame || f.attribute || f.race || f.level || f.st || f.has);
// cards with another art, a monster cut-in, or both: chosen together they narrow to cards with both (엘리스 2026-10-11)
const hasSet = (has: string) => new Set(has.split(",").filter(Boolean));
const HAS = [
  { value: "alt", label: "다른 일러스트 있음" },
  { value: "cutin", label: "소환 연출 있음" },
];

function TileSkeleton() {
  return (
    <div>
      <div className="w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="mt-1 h-10 flex items-start justify-center">
        <div className="mt-1 h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

function CardTile({ card }: { card: CardListItem }) {
  return (
    <Link to={`/cards/${card.id}`} className="block text-center group">
      {/* the corner rounds the rarity badge off with the card */}
      <span className="relative block card-corner overflow-hidden">
        <img
          loading="lazy"
          decoding="async"
          src={card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png"}
          alt={card.name}
          className="w-full aspect-[704/1024] object-contain card-corner group-hover:opacity-90 transition"
        />
        {/* the rarity in the top right corner, as Master Duel's own card list shows it (엘리스 10/12) */}
        {card.rarity && (
          <img src={`/media/md_ui/rarity_${card.rarity.toLowerCase()}.png`} alt={card.rarity} className="absolute top-0 right-0 h-3.5 sm:h-4 w-auto" />
        )}
      </span>
      <p className="mt-1 h-10 text-xs sm:text-sm leading-5 line-clamp-2 break-keep">{card.name}</p>
    </Link>
  );
}

/** 카드 도감 list: search, filters and sort live in the address (/cards?group=12…), so a 카드군 on a card page links
 *  straight to its cards; App keeps this page alive behind a card page, like the deck list. */
export default function CardList() {
  const location = useLocation();
  const navigate = useNavigate();
  const onList = location.pathname === "/cards";
  const [filters, setFilters] = useState<CardFilters>(() => withRememberedSort(searchToFilters(location.search), location.search));
  const [qInput, setQInput] = useState(filters.q);
  const [options, setOptions] = useState<CardOptions | null>(null);
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [groupCounts, setGroupCounts] = useState<{ member: number; support: number } | null>(null);
  const [cardFilter, setCardFilter] = useState<{ id: number; name: string } | null>(null);
  const [deckCounts, setDeckCounts] = useState<{ member: number; support: number } | null>(null);
  const [deckFilter, setDeckFilter] = useState<{ id: number; name: string } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(() => panelFilter(filters));
  const [showScrollTop, setShowScrollTop] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const key = filtersToSearch(filters);

  // The address is the source of truth while the list is on screen (a 카드군 chip links here with ?group=).
  useEffect(() => {
    if (!onList) return;
    const next = withRememberedSort(searchToFilters(location.search), location.search);
    if (filtersToSearch(next) !== key) {
      setFilters(next);
      setQInput(next.q);
      if (panelFilter(next)) setFilterOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList, location.search]);

  const update = (patch: Partial<CardFilters>) => {
    const next = { ...filters, ...patch };
    if (next.group !== filters.group || next.deck !== filters.deck) next.role = "";   // another group or deck starts on its own cards
    if (next.sort !== filters.sort || next.dir !== filters.dir) rememberSort(next);
    setFilters(next);
    navigate({ pathname: "/cards", search: filtersToSearch(next) }, { replace: true });
  };

  // The list follows the typing a moment after it stops (names in Korean, Japanese or English).
  useEffect(() => {
    const q = qInput.trim();
    if (q === filters.q) return;
    const t = setTimeout(() => update({ q }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  useEffect(() => {
    getCardOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  // A new search keeps the cards on screen (dimmed) until its answer arrives, and cancels the one before it.
  useEffect(() => {
    const id = ++request.current;
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoading(true);
    setError("");
    setPage(1);
    listCards(filters, 1, ctrl.signal)
      .then((r) => {
        if (id !== request.current) return;
        setItems(r.results);
        setTotal(r.total);
        setGroupCounts(r.group_counts ?? null);
        setCardFilter(r.card_filter ?? null);
        setDeckCounts(r.deck_counts ?? null);
        setDeckFilter(r.deck_filter ?? null);
        setHasMore(r.has_more);
      })
      .catch((e) => id === request.current && e.name !== "AbortError" && setError(e.message))
      .finally(() => id === request.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    const id = request.current;
    const next = page + 1;
    setLoading(true);
    listCards(filters, next)
      .then((r) => {
        if (id !== request.current) return;
        setItems((prev) => [...prev, ...r.results]);
        setPage(next);
        setHasMore(r.has_more);
      })
      .catch((e) => id === request.current && setError(e.message))
      .finally(() => id === request.current && setLoading(false));
  };

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !onList || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList, hasMore, loading, page, key]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const groupName = options?.groups.find((g) => String(g.id) === filters.group)?.name;
  const groupItems: ComboItem[] = useMemo(
    () => (options?.groups ?? []).map((g) => ({ key: String(g.id), name: g.name, sub: `${g.count.toLocaleString()}장` })),
    [options],
  );
  const monsterOnly = filters.category === "spell" || filters.category === "trap";

  const select = (label: string, field: keyof CardFilters, opts: { value: string; label: string }[], disabled = false) => (
    <div>
      <label className="block text-left text-sm font-semibold mb-1">{label}</label>
      <select value={filters[field]} onChange={(e) => update({ [field]: e.target.value })} disabled={disabled} className={SELECT}>
        <option value="">전체</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="h-auto min-h-screen w-full max-w-5xl mx-auto px-4 pt-6 pb-4 text-center">
      <DexTabs />
      {/* In the book itself the search filters the list as you type (엘리스 2026-10-11); the home page keeps the picker. */}
      {/* Enter (the phone keyboard's 검색 key) searches at once and puts the keyboard away. */}
      {/* 카드군 sit beside the name search, out of the filter panel: they are used often (엘리스 10/12) */}
      <div className="mb-4 grid gap-2 sm:grid-cols-[3fr_2fr]">
        <SearchForm onSearch={() => qInput.trim() !== filters.q && update({ q: qInput.trim() })}>
          <Input
            placeholder="카드 이름 검색 (한국어·일본어·영어)"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            enterKeyHint="search"
          />
        </SearchForm>
        <ComboBox
          label="카드군"
          placeholder="카드군 검색 (이름·초성)"
          items={groupItems}
          value={filters.group}
          onPick={(group) => update({ group })}
          onClear={() => update({ group: "" })}
          emptyText="맞는 카드군이 없습니다."
          loading={!options}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="px-4 py-2 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition"
        >
          {filterOpen ? "필터 숨기기 ▲" : "필터 보기 ▼"}
        </button>
        {/* the sort and its way, joined as Master Duel shows them */}
        <div className="flex items-stretch">
          <select
            aria-label="정렬"
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value, dir: "" })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-l-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm font-semibold"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => update({ dir: sortDir(filters) === "asc" ? "desc" : "asc" })}
            aria-label={sortDir(filters) === "asc" ? "오름차순 (누르면 내림차순)" : "내림차순 (누르면 오름차순)"}
            title={sortDir(filters) === "asc" ? "오름차순" : "내림차순"}
            className="w-10 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg bg-white text-black dark:bg-gray-800 dark:text-white text-base font-bold"
          >
            {sortDir(filters) === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {filterOpen && (
        <div className="flex flex-col gap-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {select("종류", "category", options?.categories ?? [])}
            {select("몬스터 형태", "frame", options?.frames ?? [], monsterOnly)}
            {select("속성", "attribute", options?.attributes ?? [], monsterOnly)}
            {select("종족", "race", options?.races ?? [], monsterOnly)}
            {select("레벨·랭크·링크", "level", (options?.levels ?? []).map((n) => ({ value: String(n), label: String(n) })), monsterOnly)}
            {select("마법·함정 종류", "st", options?.spell_trap_kinds ?? [], filters.category === "monster")}
          </div>
          <div className="text-left">
            <span className="block text-sm font-semibold mb-1">일러스트·소환 연출</span>
            <div className="flex flex-wrap items-center gap-2">
              {HAS.map((h) => {
                const on = hasSet(filters.has).has(h.value);
                const toggle = () => {
                  const next = hasSet(filters.has);
                  if (on) next.delete(h.value);
                  else next.add(h.value);
                  update({ has: HAS.map((x) => x.value).filter((v) => next.has(v)).join(",") });
                };
                return (
                  <button
                    key={h.value}
                    type="button"
                    aria-pressed={on}
                    onClick={toggle}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                      on ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-center">
            <button
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition"
              onClick={() => {
                setQInput("");
                update({ ...EMPTY_FILTERS, sort: filters.sort, dir: filters.dir });   // the sort is not a filter
              }}
            >
              필터 초기화
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 h-6 flex items-center text-sm text-gray-600 dark:text-gray-300 text-left">
        {filters.deck && deckCounts ? (
          // a deck's cards, from its page: its 테마 카드 or the cards supporting them (특이점 2026-10-12)
          <div className="flex items-center gap-1.5 min-w-0">
            {deckFilter ? (
              <Link to={`/database/${deckFilter.id}`} className="truncate font-semibold hover:underline" title="덱 문서로">
                '{deckFilter.name}'
              </Link>
            ) : (
              <span className="truncate font-semibold">덱</span>
            )}
            <div role="tablist" aria-label={`${deckFilter?.name ?? "덱"} 카드`} className="flex gap-1.5 shrink-0">
              {([["", "테마 카드", deckCounts.member], ["support", "서포트", deckCounts.support]] as const).map(([role, label, n]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={filters.role === role}
                  disabled={!n && filters.role !== role}
                  onClick={() => update({ role })}
                  className={`px-3 h-6 rounded-full font-semibold tabular-nums whitespace-nowrap transition disabled:opacity-40 ${
                    filters.role === role ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  {label} {n.toLocaleString()}장
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => update({ deck: "" })}
              aria-label="덱 카드 보기 끝내기"
              className="shrink-0 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs"
            >
              ✕
            </button>
          </div>
        ) : filters.group && groupCounts ? (
          // A 카드군's own cards, or the cards supporting it (서포트, 엘리스 2026-10-11)
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate font-semibold">'{groupName ?? "카드군"}'</span>
            <div role="tablist" aria-label={`${groupName ?? "카드군"} 카드`} className="flex gap-1.5 shrink-0">
              {([["", "구성원", groupCounts.member], ["support", "서포트", groupCounts.support]] as const).map(([role, label, n]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={filters.role === role}
                  disabled={!n && filters.role !== role}
                  onClick={() => update({ role })}
                  className={`px-3 h-6 rounded-full font-semibold tabular-nums transition disabled:opacity-40 ${
                    filters.role === role ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  {label} {n.toLocaleString()}장
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => update({ group: "" })}
              aria-label="카드군 지우기"
              className="shrink-0 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs"
            >
              ✕
            </button>
          </div>
        ) : filters.card && cardFilter && total !== null ? (
          // a card's own support list, from its page (엘리스 2026-10-11)
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">'{cardFilter.name}' 서포트 카드 {total.toLocaleString()}장</span>
            <button
              type="button"
              onClick={() => update({ card: "" })}
              aria-label="서포트 카드 보기 끝내기"
              className="shrink-0 w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs"
            >
              ✕
            </button>
          </div>
        ) : (
          total !== null && <span>{hasFilter(filters) || filters.q ? `조건에 맞는 카드 ${total.toLocaleString()}장` : `카드 ${total.toLocaleString()}장`}</span>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error}{" "}
          <button className="underline" onClick={() => update({})}>다시 시도</button>
        </div>
      )}

      {!loading && !error && total === 0 ? (
        <p className="py-16 text-gray-500 dark:text-gray-400">조건에 맞는 카드가 없습니다.</p>
      ) : (
        <div className={`${GRID} transition-opacity ${loading && page === 1 && items.length ? "opacity-50" : ""}`}>
          {items.map((c) => <CardTile key={c.id} card={c} />)}
          {loading && (page > 1 || !items.length) && Array.from({ length: items.length ? 6 : 18 }, (_, i) => <TileSkeleton key={`s${i}`} />)}
        </div>
      )}
      <div ref={sentinel} className="h-px" />


      {showScrollTop && onList && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-4 sm:bottom-8 w-10 h-10 bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center text-lg hover:bg-gray-600 transition z-50"
          aria-label="맨 위로"
        >
          ↑
        </button>
      )}
    </div>
  );
}
