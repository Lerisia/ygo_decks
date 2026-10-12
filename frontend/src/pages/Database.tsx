import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import EngineBadge from "@/components/EngineBadge";
import UpdateBadge from "@/components/UpdateBadge";
import { useLocation, useNavigate } from "react-router-dom";
import DatabaseTrackerPromo from "@/components/DatabaseTrackerPromo";
import DexTabs from "@/components/DexTabs";
import SearchForm from "@/components/SearchForm";
import DeckInfoEditModal from "@/components/DeckInfoEditModal";
import DexFilterBar from "@/components/DexFilterBar";
import type { DexField, DexValues } from "@/utils/dexFilter";
import { isAuthenticated, canEditDeckBook } from "@/api/accountApi";
import { matchesDeckQuery } from "@/utils/hangul";

interface Deck {
  id: number;
  name: string;
  cover_image: string | null;
  cover_image_phone?: string | null;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  aliases: string[];
  is_engine: boolean;
  is_upcoming?: boolean;
}

const POWER_COLORS: { label: string; color: string }[] = [
  { label: "최상위권", color: "#ef4444" },
  { label: "상위권", color: "#f97316" },
  { label: "중상위권", color: "#facc15" },
  { label: "중하위권", color: "#22c55e" },
  { label: "하위권", color: "#2563eb" },
  { label: "최하위권", color: "#7e22ce" },  // purple again (특이점 2026-10-08), as on 10/2 before the grey
];
const POWER_COLOR: Record<string, string> = Object.fromEntries(POWER_COLORS.map((p) => [p.label, p.color]));
// With the 덱 파워 switch on, the list runs strongest first — 최상위권, then 상위권, … — and by name within each
// tier (특이점 2026-10-06); off, it is plain name order.
const POWER_RANK: Record<string, number> = Object.fromEntries(POWER_COLORS.map((p, i) => [p.label, i]));
const powerRank = (strength: string) => POWER_RANK[strength] ?? POWER_COLORS.length;
const POWER_SWITCH_KEY = "deck_power_switch";
const options = (labels: string[]) => labels.map((l) => ({ value: l, label: l }));
const SUMMONING_METHODS = ["융합", "의식", "싱크로", "엑시즈", "펜듈럼", "링크", "다양"];
const ETC = [
  { value: "engine", label: "엔진" },
  { value: "upcoming", label: "신규 업데이트" },
];
const ETC_VALUES = ETC.map((e) => e.value);
const one = (v: string | null) => (v ? [v] : []);
// How wide a tile is drawn (3 / 4 / 5 columns inside the page gutters), so a phone picks the 320px cover over the 480px one.
const COVER_SIZES =
  "(min-width: 1280px) 224px, (min-width: 1024px) calc((100vw - 160px) / 5), (min-width: 768px) calc((100vw - 144px) / 4), calc((100vw - 84px) / 3)";
// 3px ring in the deck power colour plus a faint glow of the same colour outside it (drawn outside the box, so no layout shift).
const powerRing = (color: string): CSSProperties => ({ boxShadow: `0 0 0 3px ${color}, 0 0 9px 2px ${color}99` });

// Kept across visits so coming back from a deck page draws the list at once instead of an empty grid
// while /api/deck/ answers again (엘리스 2026-10-02); refreshed quietly in the background.
let cachedDecks: Deck[] | null = null;
let cachedTags: { performance: string[]; aesthetic: string[] } | null = null;

type SavedFilters = {
  searchQuery?: string;
  selectedPerformanceTags?: string[];
  selectedAestheticTags?: string[];
  selectedSummoningMethod?: string | null;
  selectedStrength?: string | null;
  selectedDifficulty?: string | null;
  selectedDeckType?: string | null;
  selectedArtStyle?: string | null;
  selectedEtc?: string[] | string | null;   // one string until 2026-10-12 (참혈: 엔진 and 신규 업데이트 together)
};
// Search and filters last only for this visit (sessionStorage): closing the site starts the next visit fresh
// (특이점 2026-10-02). They used to live in localStorage, so drop that old copy once.
localStorage.removeItem("deck_filters");
const readSavedFilters = (): SavedFilters => {
  try {
    return JSON.parse(sessionStorage.getItem("deck_filters") || "{}") || {};
  } catch {
    return {};
  }
};
const savedEtc = (etc: SavedFilters["selectedEtc"]): string[] =>
  (Array.isArray(etc) ? etc : etc ? [etc] : []).filter((e) => ETC_VALUES.includes(e));
// /database?q=… (the home search's 전체 보기, 엘리스 2026-10-11) opens the list on that search alone, so it shows
// exactly the decks the search counted.
const queryInAddress = (search: string) => new URLSearchParams(search).get("q");

export default function DatabasePage() {
  const location = useLocation();
  const onList = location.pathname === "/database";
  // Saved filters are read before the first render so the list never shows unfiltered for a frame.
  const [saved] = useState((): SavedFilters => {
    const q = queryInAddress(location.search);
    return q !== null ? { searchQuery: q } : readSavedFilters();
  });
  const [decks, setDecks] = useState<Deck[]>(() => cachedDecks ?? []);
  const [searchQuery, setSearchQuery] = useState(saved.searchQuery || "");
  const [selectedPerformanceTags, setSelectedPerformanceTags] = useState<string[]>(saved.selectedPerformanceTags || []);
  const [selectedAestheticTags, setSelectedAestheticTags] = useState<string[]>(saved.selectedAestheticTags || []);
  const [selectedSummoningMethod, setSelectedSummoningMethod] = useState<string | null>(saved.selectedSummoningMethod || null);
  const [performanceTags, setPerformanceTags] = useState<string[]>(() => cachedTags?.performance ?? []);
  const [aestheticTags, setAestheticTags] = useState<string[]>(() => cachedTags?.aesthetic ?? []);
  const [selectedStrength, setSelectedStrength] = useState<string | null>(saved.selectedStrength || null);
  // 기타: 엔진 / 신규 업데이트 (특이점 2026-10-03, 예전 '구축 형태'·'업데이트' 필터를 합침); both at once since 참혈 10/12
  const [selectedEtc, setSelectedEtc] = useState<string[]>(() => savedEtc(saved.selectedEtc));  // "engine", "upcoming"
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(saved.selectedDifficulty || null);
  const [selectedDeckType, setSelectedDeckType] = useState<string | null>(saved.selectedDeckType || null);
  const [selectedArtStyle, setSelectedArtStyle] = useState<string | null>(saved.selectedArtStyle || null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // 덱 파워 switch (colour rings, power order, colour key). Off unless this browser turned it on (특이점 2026-10-09);
  // a new key, so choices saved while it defaulted to on (10/2~10/8) don't carry over and everyone starts off.
  const [powerBorder, setPowerBorder] = useState(() => {
    try {
      localStorage.removeItem("deck_power_border");
      return localStorage.getItem(POWER_SWITCH_KEY) === "on";
    } catch {
      return false;
    }
  });
  const togglePowerBorder = () =>
    setPowerBorder((on) => {
      try {
        localStorage.setItem(POWER_SWITCH_KEY, on ? "off" : "on");
      } catch {
        /* private mode: the choice lasts while the page is open */
      }
      return !on;
    });
  const navigate = useNavigate();
  // A ?q= arriving while the list is kept alive behind a deck page works the same; the address then drops it, as the
  // search lives on in this visit's saved filters (a stale ?q= would otherwise win over later typing on a reload).
  useEffect(() => {
    if (!onList) return;
    const q = queryInAddress(location.search);
    if (q === null) return;
    setSearchQuery(q);
    setSelectedPerformanceTags([]);
    setSelectedAestheticTags([]);
    setSelectedSummoningMethod(null);
    setSelectedStrength(null);
    setSelectedDifficulty(null);
    setSelectedDeckType(null);
    setSelectedArtStyle(null);
    setSelectedEtc([]);
    navigate("/database", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onList, location.search]);
  // 운영진은 도감에서 바로 새 덱을 추가한다 (특이점 2026-10-03)
  const [staff, setStaff] = useState(false);  // staff or an editor: may add decks
  const [addingDeck, setAddingDeck] = useState(false);
  useEffect(() => {
    if (isAuthenticated()) canEditDeckBook().then(setStaff).catch(() => {});
  }, []);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const saveFilters = () => {
    const filters = {
      searchQuery,
      selectedPerformanceTags,
      selectedAestheticTags,
      selectedSummoningMethod,
      selectedStrength,
      selectedDifficulty,
      selectedDeckType,
      selectedArtStyle,
      selectedEtc,
    };
    sessionStorage.setItem("deck_filters", JSON.stringify(filters));
  };

  // Saved on every change (not only when leaving), so a reload in the same visit keeps them too.
  useEffect(() => {
    saveFilters();
  }, [
    searchQuery,
    selectedPerformanceTags,
    selectedAestheticTags,
    selectedSummoningMethod,
    selectedStrength,
    selectedDifficulty,
    selectedDeckType,
    selectedArtStyle, selectedEtc]);

  useEffect(() => {
    // Get decks from backend (again whenever staff edit a deck's info on its page)
    const loadDecks = () =>
      fetch("/api/deck/")
        .then((res) => res.json())
        .then((data) => {
          const list: Deck[] = Array.isArray(data.decks) ? data.decks : [];
          cachedDecks = list;
          setDecks(list);
        });
    loadDecks();
    window.addEventListener("deck-info-changed", loadDecks);

    // Get tags from backend
    fetch("/api/tags/")
      .then((res) => res.json())
      .then((data) => {
        cachedTags = { performance: data.performance_tags, aesthetic: data.aesthetic_tags };
        setPerformanceTags(data.performance_tags);
        setAestheticTags(data.aesthetic_tags);
      });
    return () => window.removeEventListener("deck-info-changed", loadDecks);
  }, []);

  // Apply filtering
  const filteredDecks = useMemo(() => {
    // The same match as the deck pickers (초성, spaces ignored), so the home search's count holds here.
    let filtered = decks.filter((deck) => matchesDeckQuery(searchQuery, deck.name, deck.aliases ?? []));

    if (selectedPerformanceTags.length > 0) {
      filtered = filtered.filter((deck) =>
        selectedPerformanceTags.every((tag) => deck.performance_tags.includes(tag))
      );
    }
    if (selectedAestheticTags.length > 0) {
      filtered = filtered.filter((deck) =>
        selectedAestheticTags.every((tag) => deck.aesthetic_tags.includes(tag))
      );
    }

    if (selectedEtc.includes("engine")) {
      filtered = filtered.filter((deck) => deck.is_engine);
    }
    if (selectedEtc.includes("upcoming")) {
      filtered = filtered.filter((deck) => deck.is_upcoming);
    }
    if (selectedStrength) {
      filtered = filtered.filter((deck) => deck.strength === selectedStrength);
    }
    if (selectedDifficulty) {
      filtered = filtered.filter((deck) => deck.difficulty === selectedDifficulty);
    }
    if (selectedDeckType) {
      filtered = filtered.filter((deck) => deck.deck_type === selectedDeckType);
    }
    if (selectedArtStyle) {
      filtered = filtered.filter((deck) => deck.art_style === selectedArtStyle);
    }
    if (selectedSummoningMethod) {
      filtered = filtered.filter((deck) => deck.summoning_methods.includes(selectedSummoningMethod));
    }

    // With the 덱 파워 switch off the list keeps the API's name order (가나다), as before 10/6 (특이점 2026-10-08).
    if (!powerBorder) return filtered;
    // filter() always returns a fresh array, and the sort is stable, so the API's name order holds within a tier.
    return filtered.sort((a, b) => powerRank(a.strength) - powerRank(b.strength));
  }, [searchQuery,
    powerBorder,
    selectedPerformanceTags,
    selectedAestheticTags,
    selectedSummoningMethod,
    selectedStrength,
    selectedDifficulty,
    selectedDeckType,
    selectedArtStyle,
    decks, selectedEtc]);

  // The filter bar's items (참혈 2026-10-12): 파워 always on top, the 성능 tags as 기믹 (several at once), and 기타
  // with the 비성능 tags as one group of 그 외 toggles, any of them together, a deck having them all.
  const filterFields: DexField[] = [
    { key: "strength", label: "파워", primary: true, options: options(POWER_COLORS.map((p) => p.label)) },
    { key: "difficulty", label: "난이도", options: options(["쉬움", "보통", "어려움"]) },
    { key: "deck_type", label: "덱 타입", options: options(["전개", "미드레인지", "운영", "특이"]) },
    { key: "art_style", label: "아트 스타일", options: options(["멋있는", "어두운", "명랑한", "환상적", "웅장한"]) },
    { key: "summoning", label: "소환법", options: options(SUMMONING_METHODS) },
    { key: "gimmick", label: "기믹", multi: true, options: options(performanceTags) },
  ];
  const filterExtra: DexField = {
    key: "other", label: "그 외", multi: true,
    options: [...ETC, ...aestheticTags.map((t) => ({ value: `tag:${t}`, label: t }))],
  };
  const filterValues: DexValues = {
    strength: one(selectedStrength),
    difficulty: one(selectedDifficulty),
    deck_type: one(selectedDeckType),
    art_style: one(selectedArtStyle),
    summoning: one(selectedSummoningMethod),
    gimmick: selectedPerformanceTags,
    other: [...selectedEtc, ...selectedAestheticTags.map((t) => `tag:${t}`)],
  };
  const applyFilters = (v: DexValues) => {
    setSelectedStrength(v.strength?.[0] ?? null);
    setSelectedDifficulty(v.difficulty?.[0] ?? null);
    setSelectedDeckType(v.deck_type?.[0] ?? null);
    setSelectedArtStyle(v.art_style?.[0] ?? null);
    setSelectedSummoningMethod(v.summoning?.[0] ?? null);
    setSelectedPerformanceTags(v.gimmick ?? []);
    setSelectedEtc(ETC_VALUES.filter((e) => v.other?.includes(e)));
    setSelectedAestheticTags((v.other ?? []).filter((t) => t.startsWith("tag:")).map((t) => t.slice(4)));
  };

  return (
    <div className="h-auto min-h-screen px-4 pt-6 pb-4 text-center">
      <DexTabs />
      <DatabaseTrackerPromo />

      {/* Search decks, with 덱 추가 for staff at its right */}
      {/* Enter (the phone keyboard's 검색 key) puts the keyboard away; the list already follows the typing. */}
      <div className="mb-4 flex items-center gap-2">
        <SearchForm>
          <Input
            placeholder="덱 이름 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            enterKeyHint="search"
            className="flex-1 min-w-0"
          />
        </SearchForm>
        {staff && (
          <button
            type="button"
            onClick={() => setAddingDeck(true)}
            className="shrink-0 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
          >
            ➕ 덱 추가
          </button>
        )}
      </div>

      {/* Filters, with the 덱 파워 switch at the row's right end */}
      <div className="mb-4">
        <DexFilterBar
          fields={filterFields}
          extra={filterExtra}
          values={filterValues}
          onChange={applyFilters}
          active={onList}
          right={
            <button
              type="button"
              role="switch"
              aria-checked={powerBorder}
              onClick={togglePowerBorder}
              className="h-9 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              덱 파워
              <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${powerBorder ? "bg-blue-600" : "bg-gray-400"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${powerBorder ? "translate-x-4" : ""}`} />
              </span>
            </button>
          }
        />
      </div>
      {addingDeck && (
        <DeckInfoEditModal
          onClose={() => setAddingDeck(false)}
          onSaved={(deck) => {
            setAddingDeck(false);
            window.dispatchEvent(new Event("deck-info-changed"));
            navigate(`/database/${deck.id}`);
          }}
        />
      )}
      {/* Colour key: one line wherever the six fit (they need 344px inside the page, i.e. screens from ~400px);
          narrower phones get three a row, 최상위·상위·중상위 over 중하위·하위·최하위, never a lone sixth
          (특이점 2026-10-08). Labels never break mid-word. */}
      {powerBorder && (
        <div className="-mt-2 mb-4 w-fit mx-auto grid grid-cols-[repeat(3,auto)] gap-x-3 gap-y-1 min-[400px]:flex min-[400px]:gap-x-2 sm:flex-wrap sm:justify-center sm:gap-x-3 text-xs text-gray-600 dark:text-gray-300">
          {POWER_COLORS.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      )}

      {/* List of available decks */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredDecks.map((deck) => (
          <div key={deck.id} className="text-center cursor-pointer" onClick={() => navigate(`/database/${deck.id}`)}>
            <div className="relative">
              <img
                loading="lazy"
                decoding="async"
                src={deck.cover_image || "/default_cover.png"}
                srcSet={deck.cover_image && deck.cover_image_phone ? `${deck.cover_image_phone} 320w, ${deck.cover_image} 480w` : undefined}
                sizes={COVER_SIZES}
                alt={deck.name}
                className="w-full h-24 md:h-auto md:aspect-[4/3] object-cover rounded-lg"
                style={powerBorder && POWER_COLOR[deck.strength] ? powerRing(POWER_COLOR[deck.strength]) : undefined}
              />
              {/* E always top-left, U always top-right, so each mark keeps its own corner (특이점 2026-10-10). */}
              {deck.is_engine && <EngineBadge className="absolute top-1 left-1 w-5 h-5 sm:w-6 sm:h-6 text-[11px] sm:text-xs" />}
              {deck.is_upcoming && <UpdateBadge className="absolute top-1 right-1 w-5 h-5 sm:w-6 sm:h-6 text-[11px] sm:text-xs" />}
            </div>
            <p className="mt-1 text-sm sm:text-base">{deck.name}</p>
          </div>
        ))}
      </div>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-4 sm:bottom-8 w-10 h-10 bg-gray-700 text-white rounded-full shadow-lg flex items-center justify-center text-lg hover:bg-gray-600 transition z-50"
        >
          ↑
        </button>
      )}
    </div>
  );
}
