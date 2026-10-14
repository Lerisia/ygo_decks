import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import ComboBox, { type ComboItem } from "@/components/ComboBox";
import DexFilterBar from "@/components/DexFilterBar";
import DexTabs from "@/components/DexTabs";
import SearchForm from "@/components/SearchForm";
import UnifiedCardSearch from "@/components/UnifiedCardSearch";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import {
  type CardFilters, type CardListItem, type CardOptions,
  filtersToSearch, getCardOptions, listCards, searchToFilters, sortDir,
} from "@/api/cardDexApi";
import type { DexField, DexValues } from "@/utils/dexFilter";
import { trackEvent } from "@/api/analyticsApi";
import { CARD_SORTS, DEV_CARD_SORTS } from "@/lib/cardSorts";

const GRID = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3";
const SORTS = CARD_SORTS;

const SORT_KEY = "card_list_sort";

/** The viewer's last sort and its way, kept in this browser (엘리스 10/12); an address that names one wins. */
function withRememberedSort(f: CardFilters, search: string, sorts = SORTS): CardFilters {
  const qs = new URLSearchParams(search);
  if (qs.has("sort") || qs.has("dir")) return f;
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (sorts.some((s) => s.value === saved?.sort) && ["", "asc", "desc"].includes(saved.dir)) {
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
  !!(f.category || f.frame || f.attribute || f.race || f.level || f.st || f.group || f.card || f.deck || f.has || f.ban);
// cards with another art, a monster cut-in, or both: chosen together they narrow to cards with both (엘리스 2026-10-11)
const HAS = [
  { value: "alt", label: "다른 일러스트" },
  { value: "cutin", label: "소환 연출" },
  // an alternate print whose art covers the whole card (특이점 2026-10-12)
  { value: "overframe", label: "오버프레임" },
];
// the filter bar's chips (참혈 2026-10-12); a monster's items don't fit 마법·함정, nor 마법·함정 a monster
const BAR_KEYS = ["category", "frame", "attribute", "race", "level", "st"] as const;
// today's Master Duel 금제, the same as the icon in each card's corner; several at once (엘리스 10/12)
const BANS = [
  { value: "forbidden", label: "금지" },
  { value: "limited", label: "제한" },
  { value: "semi_limited", label: "준제한" },
  { value: "unlimited", label: "무제한" },
];
const MONSTER_KEYS = ["frame", "attribute", "race", "level"];
const misfit = (key: string, v: DexValues) =>
  MONSTER_KEYS.includes(key) ? ["spell", "trap"].includes(v.category?.[0] ?? "") : key === "st" && v.category?.[0] === "monster";

export function TileSkeleton() {
  return (
    <div>
      <div className="w-full aspect-[704/1024] card-corner bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="mt-1 h-10 flex items-start justify-center">
        <div className="mt-1 h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
    </div>
  );
}

export function CardTile({ card }: { card: CardListItem }) {
  return (
    <Link to={`/cards/${card.id}`} state={{ fromList: true }} className="block text-center group">
      {/* the card's corners are rounded, the rarity badge's are not (특이점 2026-10-12) */}
      <span className="relative block">
        <img
          loading="lazy"
          decoding="async"
          src={card.face_thumb_url || card.thumb_url || card.image_url || "/default_cover.png"}
          alt={card.name}
          className="w-full aspect-[704/1024] object-contain card-corner group-hover:opacity-90 transition"
        />
        {/* today's Master Duel 금제 in the top left corner, in the game's own icon (엘리스 10/12) */}
        {card.ban && (
          <img
            src={`/media/md_ui/info/limit/${card.ban}.webp`}
            alt={{ forbidden: "금지", limited: "제한", semi_limited: "준제한" }[card.ban]}
            className="absolute top-[3%] left-[4%] w-[17%] h-auto drop-shadow"
          />
        )}
        {/* the rarity in the top right corner, as Master Duel's own card list shows it (엘리스 10/12) */}
        {card.rarity && (
          <img src={`/media/md_ui/rarity_${card.rarity.toLowerCase()}_hd.png`} alt={card.rarity} className="absolute top-0 right-0 h-3.5 sm:h-4 w-auto" />
        )}
      </span>
      <p className="mt-1 h-10 text-xs sm:text-sm leading-5 line-clamp-2 break-keep">{card.name}</p>
    </Link>
  );
}

/** 카드 도감 list: search, filters and sort live in the address (/cards?group=12…), so a 카드군 on a card page links
 *  straight to its cards; App keeps this page alive behind a card page, like the deck list. At /dev/cards
 *  (operators only) it tries one box for the name search and the 카드군·서포트 pick (unifiedSearch, 참혈 2026-10-14). */
export default function CardList({ basePath = "/cards", unifiedSearch = false }: { basePath?: string; unifiedSearch?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const allowed = useAdminOnly(unifiedSearch);
  const onList = location.pathname === basePath;
  const sorts = unifiedSearch ? DEV_CARD_SORTS : SORTS;
  const [filters, setFilters] = useState<CardFilters>(() => withRememberedSort(searchToFilters(location.search), location.search, sorts));
  const [qInput, setQInput] = useState(filters.q);
  const [options, setOptions] = useState<CardOptions | null>(null);
  const [items, setItems] = useState<CardListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [groupCounts, setGroupCounts] = useState<{ member: number; support: number } | null>(null);
  const [cardFilter, setCardFilter] = useState<{ id: number; name: string } | null>(null);
  const [deckCounts, setDeckCounts] = useState<{ member: number; support: number } | null>(null);
  const [deckFilter, setDeckFilter] = useState<{ id: number; name: string; by_card?: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const key = filtersToSearch(filters);

  // The address is the source of truth while the list is on screen (a 카드군 chip links here with ?group=).
  useEffect(() => {
    if (!onList) return;
    const next = withRememberedSort(searchToFilters(location.search), location.search, sorts);
    if (filtersToSearch(next) !== key) {
      setFilters(next);
      setQInput(next.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList, location.search]);

  // A sort or its way picked by the viewer is counted (참혈 2026-10-14; the dashboard's 카드 도감 정렬).
  const pickSort = (patch: Pick<CardFilters, "sort" | "dir"> | Pick<CardFilters, "dir">) => {
    const next = { ...filters, ...patch };
    trackEvent("card_sort", `${next.sort}:${sortDir(next)}`);
    update(patch);
  };

  const update = (patch: Partial<CardFilters>) => {
    const next = { ...filters, ...patch };
    if (next.group !== filters.group || next.deck !== filters.deck) next.role = "";   // another group or deck starts on its own cards
    if (next.sort !== filters.sort || next.dir !== filters.dir) rememberSort(next);
    setFilters(next);
    navigate({ pathname: basePath, search: filtersToSearch(next) }, { replace: true });
  };

  // The list follows the typing a moment after it stops (names in Korean, Japanese or English) — but not in the
  // /dev/cards trial, where the names are searched on Enter (참혈 2026-10-14).
  useEffect(() => {
    const q = qInput.trim();
    if (unifiedSearch || q === filters.q) return;
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
  // 카드군, and once a name is typed the cards with a support list (엘리스 10/12: a card's 서포트 searched here too)
  const groupItems: ComboItem[] = useMemo(
    () => [
      ...(options?.groups ?? []).map((g) => ({ key: `g${g.id}`, name: g.name, sub: `${g.count.toLocaleString()}장`, tag: "카드군" })),
      ...(options?.support_cards ?? []).map((c) => ({
        key: `c${c.id}`, name: c.name, sub: `서포트 ${c.count.toLocaleString()}장`, tag: "카드", searchOnly: true,
      })),
    ],
    [options],
  );
  const barFields: DexField[] = [
    { key: "category", label: "종류", primary: true, options: options?.categories ?? [] },
    { key: "frame", label: "몬스터", options: options?.frames ?? [] },
    { key: "attribute", label: "속성", options: options?.attributes ?? [] },
    { key: "race", label: "종족", options: options?.races ?? [] },
    {
      key: "level", label: "레벨·랭크·링크", format: (l) => `레벨·랭크·링크 ${l}`,
      options: (options?.levels ?? []).map((n) => ({ value: String(n), label: String(n) })),
    },
    { key: "st", label: "마법·함정", options: options?.spell_trap_kinds ?? [] },
    { key: "ban", label: "금제", multi: true, options: BANS },
  ];
  const barExtra: DexField = { key: "has", label: "그 외", multi: true, options: HAS };
  const barValues: DexValues = {
    ...Object.fromEntries(BAR_KEYS.map((k) => [k, filters[k] ? [filters[k]] : []])),
    has: filters.has.split(",").filter(Boolean),
    ban: filters.ban.split(",").filter(Boolean),
  };
  const applyBar = (v: DexValues) =>
    update({
      ...Object.fromEntries(BAR_KEYS.map((k) => [k, v[k]?.[0] ?? ""])),
      has: HAS.map((h) => h.value).filter((x) => v.has?.includes(x)).join(","),
      ban: BANS.map((b) => b.value).filter((x) => v.ban?.includes(x)).join(","),
    });

  if (!allowed) return <div className="min-h-screen" />;
  const chosenGroup = groupItems.find((it) => it.key === (filters.group ? `g${filters.group}` : filters.card ? `c${filters.card}` : ""));

  return (
    <div className="h-auto min-h-screen w-full max-w-5xl mx-auto px-4 pt-6 pb-4 text-center">
      <DexTabs />
      {/* In the book itself the search filters the list as you type (엘리스 2026-10-11); the home page keeps the picker. */}
      {/* Enter (the phone keyboard's 검색 key) searches at once and puts the keyboard away. */}
      {/* 카드군 sit beside the name search, out of the filter panel: they are used often (엘리스 10/12) */}
      {unifiedSearch ? (
        <div className="mb-4">
          <UnifiedCardSearch
            query={qInput}
            onQueryChange={setQInput}
            onSubmit={() => qInput.trim() !== filters.q && update({ q: qInput.trim() })}
            items={groupItems}
            chosen={chosenGroup}
            onPick={(key) => {
              setQInput("");
              update({ q: "", ...(key[0] === "g" ? { group: key.slice(1), card: "" } : { card: key.slice(1), group: "" }) });
            }}
            onPickCard={(id) => navigate(`/cards/${id}`, { state: { fromList: true } })}
            onSearchText={(text) => {
              setQInput(text);
              update({ q: text });
            }}
            filterBar={<DexFilterBar fields={barFields} extra={barExtra} values={barValues} onChange={applyBar} isDisabled={misfit} active={onList} trial />}
            onClear={() => update({ group: "", card: "" })}
          />
        </div>
      ) : (
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
          label="카드군·서포트"
          placeholder="카드군·카드 서포트 검색 (이름·초성)"
          items={groupItems}
          value={filters.group ? `g${filters.group}` : filters.card ? `c${filters.card}` : ""}
          onPick={(key) => update(key[0] === "g" ? { group: key.slice(1), card: "" } : { card: key.slice(1), group: "" })}
          onClear={() => update({ group: "", card: "" })}
          emptyText="맞는 카드군·카드가 없습니다."
          loading={!options}
        />
      </div>
      )}

      {/* Filters, with the sort and its way at the row's right end, joined as Master Duel shows them */}
      <div className="mb-4">
        <DexFilterBar
          fields={barFields}
          extra={barExtra}
          values={barValues}
          onChange={applyBar}
          isDisabled={misfit}
          active={onList}
          trial={unifiedSearch}
          right={
            <div className="flex items-stretch h-9">
              {/* its own caret, a little in from the edge (참혈 2026-10-12) */}
              <span className="relative flex">
                <select
                  aria-label="정렬"
                  value={filters.sort}
                  onChange={(e) => pickSort({ sort: e.target.value, dir: "" })}
                  className="appearance-none max-w-[7.5rem] sm:max-w-none max-sm:[field-sizing:content] pl-2 sm:pl-3 pr-7 sm:pr-8 border border-gray-300 dark:border-gray-600 rounded-l-lg rounded-r-none bg-white text-black dark:bg-gray-800 dark:text-white text-sm font-semibold"
                >
                  {/* 조회순 reads 정확도순 while a query is on: the closest names come first then (참혈 2026-10-14) */}
                  {sorts.map((s) => <option key={s.value} value={s.value}>{s.value === "popular" && filters.q ? "정확도순" : s.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" aria-hidden />
              </span>
              <button
                type="button"
                onClick={() => pickSort({ dir: sortDir(filters) === "asc" ? "desc" : "asc" })}
                aria-label={sortDir(filters) === "asc" ? "오름차순 (누르면 내림차순)" : "내림차순 (누르면 오름차순)"}
                title={sortDir(filters) === "asc" ? "오름차순" : "내림차순"}
                className="w-8 sm:w-9 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg rounded-l-none bg-white text-black dark:bg-gray-800 dark:text-white text-base font-bold"
              >
                {sortDir(filters) === "asc" ? "↑" : "↓"}
              </button>
            </div>
          }
        />
      </div>

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
            {deckFilter?.by_card ? (
              // built on a card alone: one list, no 카드군 to split into 테마 카드 and 서포트 (엘리스 10/12)
              <span className="shrink-0 tabular-nums">카드 {deckCounts.member.toLocaleString()}장</span>
            ) : (
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
            )}
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
