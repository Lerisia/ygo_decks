import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import PickerModal, { type PickerItem } from "@/components/PickerModal";
import DexTabs from "@/components/DexTabs";
import {
  type CardFilters, type CardListItem, type CardOptions,
  EMPTY_FILTERS, filtersToSearch, getCardOptions, listCards, searchToFilters,
} from "@/api/cardDexApi";

const SELECT = "w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm disabled:opacity-50";
const GRID = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3";
const SORTS = [
  { value: "new", label: "최신 카드순" },
  { value: "name", label: "이름순" },
];

const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const hasFilter = (f: CardFilters) => !!(f.category || f.frame || f.attribute || f.race || f.level || f.st || f.group);

function TileSkeleton() {
  return (
    <div>
      <div className="w-full aspect-[704/1024] rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="mt-1 h-10 flex items-start justify-center">
        <div className="mt-1 h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

function CardTile({ card }: { card: CardListItem }) {
  return (
    <Link to={`/cards/${card.id}`} className="block text-center group">
      <img
        loading="lazy"
        decoding="async"
        src={card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png"}
        alt={card.name}
        className="w-full aspect-[704/1024] object-contain group-hover:opacity-90 transition"
      />
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
  const [filters, setFilters] = useState<CardFilters>(() => searchToFilters(location.search));
  const [qInput, setQInput] = useState(filters.q);
  const [options, setOptions] = useState<CardOptions | null>(null);
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(() => hasFilter(filters));
  const [pickingGroup, setPickingGroup] = useState(false);
  const [groupQuery, setGroupQuery] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const key = filtersToSearch(filters);

  // The address is the source of truth while the list is on screen (a 카드군 chip links here with ?group=).
  useEffect(() => {
    if (!onList) return;
    const next = searchToFilters(location.search);
    if (filtersToSearch(next) !== key) {
      setFilters(next);
      setQInput(next.q);
      if (hasFilter(next)) setFilterOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList, location.search]);

  const update = (patch: Partial<CardFilters>) => {
    const next = { ...filters, ...patch };
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
  const groupItems: PickerItem[] = useMemo(() => {
    const q = normalize(groupQuery);
    return (options?.groups ?? [])
      .filter((g) => !q || normalize(g.name).includes(q))
      .map((g) => ({ key: g.id, name: g.name, sub: `${g.count.toLocaleString()}장` }));
  }, [options, groupQuery]);
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
    <div className="h-auto min-h-screen w-full max-w-5xl mx-auto px-4 py-4 text-center">
      <DexTabs />
      {/* In the book itself the search filters the list as you type (엘리스 2026-10-11); the home page keeps the picker. */}
      {/* Enter (the phone keyboard's 검색 key) ends the typing: search at once and put the keyboard away. A form
          submit fires even while a Korean syllable is still being composed, where a bare Enter key may not. */}
      <form
        role="search"
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (qInput.trim() !== filters.q) update({ q: qInput.trim() });
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <Input
          placeholder="카드 이름 검색 (한국어·일본어·영어)"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          enterKeyHint="search"
        />
      </form>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="px-4 py-2 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition"
        >
          {filterOpen ? "필터 숨기기 ▲" : "필터 보기 ▼"}
        </button>
        <select
          aria-label="정렬"
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value })}
          className="px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm font-semibold"
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
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
            <span className="block text-sm font-semibold mb-1">카드군</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPickingGroup(true)}
                className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                  filters.group ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                {filters.group ? groupName ?? "카드군" : "카드군 고르기"}
              </button>
              {filters.group && (
                <button
                  type="button"
                  onClick={() => update({ group: "" })}
                  className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  aria-label="카드군 지우기"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-center">
            <button
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition"
              onClick={() => {
                setQInput("");
                update({ ...EMPTY_FILTERS });
              }}
            >
              필터 초기화
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 h-6 flex items-center text-sm text-gray-600 dark:text-gray-300 text-left">
        {total !== null && <span>{hasFilter(filters) || filters.q ? `조건에 맞는 카드 ${total.toLocaleString()}장` : `카드 ${total.toLocaleString()}장`}</span>}
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

      <PickerModal
        open={pickingGroup}
        onClose={() => setPickingGroup(false)}
        title="카드군 고르기"
        placeholder="카드군 이름"
        query={groupQuery}
        onQueryChange={setGroupQuery}
        items={groupItems}
        status={!options ? "loading" : groupItems.length ? "ready" : "empty"}
        emptyText="맞는 카드군이 없습니다."
        onPick={(item) => {
          setPickingGroup(false);
          update({ group: String(item.key) });
        }}
        viewKey="card-groups"
        defaultView="list"
      />

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
