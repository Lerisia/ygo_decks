import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import EngineBadge from "@/components/EngineBadge";
import { useNavigate } from "react-router-dom";
import DatabaseTrackerPromo from "@/components/DatabaseTrackerPromo";

interface Deck {
  id: number;
  name: string;
  cover_image: string | null;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  aliases: string[];
  is_engine: boolean;
}

const POWER_COLORS: { label: string; color: string }[] = [
  { label: "최상위권", color: "#ef4444" },
  { label: "상위권", color: "#f97316" },
  { label: "중상위권", color: "#facc15" },
  { label: "중하위권", color: "#22c55e" },
  { label: "하위권", color: "#2563eb" },
  { label: "최하위권", color: "#4b5563" },
];
const POWER_COLOR: Record<string, string> = Object.fromEntries(POWER_COLORS.map((p) => [p.label, p.color]));
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
  selectedRole?: string | null;
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

export default function DatabasePage() {
  // Saved filters are read before the first render so the list never shows unfiltered for a frame.
  const [saved] = useState(readSavedFilters);
  const [decks, setDecks] = useState<Deck[]>(() => cachedDecks ?? []);
  const [searchQuery, setSearchQuery] = useState(saved.searchQuery || "");
  const [selectedPerformanceTags, setSelectedPerformanceTags] = useState<string[]>(saved.selectedPerformanceTags || []);
  const [selectedAestheticTags, setSelectedAestheticTags] = useState<string[]>(saved.selectedAestheticTags || []);
  const [selectedSummoningMethod, setSelectedSummoningMethod] = useState<string | null>(saved.selectedSummoningMethod || null);
  const [performanceTags, setPerformanceTags] = useState<string[]>(() => cachedTags?.performance ?? []);
  const [aestheticTags, setAestheticTags] = useState<string[]>(() => cachedTags?.aesthetic ?? []);
  const [selectedStrength, setSelectedStrength] = useState<string | null>(saved.selectedStrength || null);
  const [selectedRole, setSelectedRole] = useState<string | null>(saved.selectedRole || null);  // "main" | "engine"
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(saved.selectedDifficulty || null);
  const [selectedDeckType, setSelectedDeckType] = useState<string | null>(saved.selectedDeckType || null);
  const [selectedArtStyle, setSelectedArtStyle] = useState<string | null>(saved.selectedArtStyle || null);
  const [filterExpanded, setFilterExpanded] = useState(() =>
    Boolean(
      (saved.selectedPerformanceTags?.length ?? 0) > 0 ||
        (saved.selectedAestheticTags?.length ?? 0) > 0 ||
        saved.selectedSummoningMethod ||
        saved.selectedStrength ||
        saved.selectedDifficulty ||
        saved.selectedDeckType ||
        saved.selectedArtStyle ||
        saved.selectedRole,
    ),
  );
  const [showScrollTop, setShowScrollTop] = useState(false);
  // 덱 파워별 테두리 색 (특이점 2026-10-02) — 기본 켬, 켜고 끈 상태는 이 브라우저에 저장
  const [powerBorder, setPowerBorder] = useState(() => localStorage.getItem("deck_power_border") !== "off");
  const togglePowerBorder = () =>
    setPowerBorder((on) => {
      localStorage.setItem("deck_power_border", on ? "off" : "on");
      return !on;
    });
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const summoningMethods = ["융합", "의식", "싱크로", "엑시즈", "펜듈럼", "링크", "다양"];

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
      selectedRole,
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
    selectedArtStyle, selectedRole]);

  useEffect(() => {
    // Get decks from backend
    fetch("/api/deck/")
      .then((res) => res.json())
      .then((data) => {
        const list: Deck[] = Array.isArray(data.decks) ? data.decks : [];
        cachedDecks = list;
        setDecks(list);
      });

    // Get tags from backend
    fetch("/api/tags/")
      .then((res) => res.json())
      .then((data) => {
        cachedTags = { performance: data.performance_tags, aesthetic: data.aesthetic_tags };
        setPerformanceTags(data.performance_tags);
        setAestheticTags(data.aesthetic_tags);
      });
  }, []);

  // Apply filtering
  const filteredDecks = useMemo(() => {
    let filtered = decks.filter((deck) => {
      const lowerQuery = searchQuery.toLowerCase();
      return (
        deck.name.toLowerCase().includes(lowerQuery) ||
        deck.aliases?.some((alias) => alias.toLowerCase().includes(lowerQuery))
      );
    });

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

    if (selectedRole === "engine") {
      filtered = filtered.filter((deck) => deck.is_engine);
    } else if (selectedRole === "main") {
      filtered = filtered.filter((deck) => !deck.is_engine);
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

    return filtered;
  }, [searchQuery,
    selectedPerformanceTags,
    selectedAestheticTags,
    selectedSummoningMethod,
    selectedStrength,
    selectedDifficulty,
    selectedDeckType,
    selectedArtStyle,
    decks, selectedRole]);


  // Filter section toggle
  const toggleFilterSection = () => {
    setFilterExpanded(!filterExpanded);
  };

  // Tag selection toggle
  const toggleTag = (tag: string, setTags: React.Dispatch<React.SetStateAction<string[]>>) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="h-auto min-h-screen px-0 sm:px-4 text-center p-4">
      <DatabaseTrackerPromo />

      {/* Search decks */}
      <Input
        placeholder="덱 이름 검색..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mb-4"
      />

      {/* Filter expand / fold + deck power border toggle */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
        <button onClick={toggleFilterSection} className="px-4 py-2 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition">
          {filterExpanded ? "필터 숨기기 ▲" : "필터 보기 ▼"}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={powerBorder}
          onClick={togglePowerBorder}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          덱 파워
          <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${powerBorder ? "bg-blue-600" : "bg-gray-400"}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${powerBorder ? "translate-x-4" : ""}`} />
          </span>
        </button>
      </div>
      {powerBorder && (
        <div className="-mt-2 mb-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
          {POWER_COLORS.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      )}

      {/* Single selection filter 필터 */}
      {filterExpanded && (
        <div className="flex flex-col gap-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-left text-sm font-semibold mb-1">덱 파워</label>
              <select
                value={selectedStrength || ""}
                onChange={(e) => setSelectedStrength(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                {["최상위권", "상위권", "중상위권", "중하위권", "하위권", "최하위권"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-left text-sm font-semibold mb-1">난이도</label>
              <select
                value={selectedDifficulty || ""}
                onChange={(e) => setSelectedDifficulty(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                {["쉬움", "보통", "어려움"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-left text-sm font-semibold mb-1">구축 형태</label>
              <select
                value={selectedRole || ""}
                onChange={(e) => setSelectedRole(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                <option value="main">단일 덱</option>
                <option value="engine">엔진</option>
              </select>
            </div>
            <div>
              <label className="block text-left text-sm font-semibold mb-1">덱 타입</label>
              <select
                value={selectedDeckType || ""}
                onChange={(e) => setSelectedDeckType(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                {["전개", "미드레인지", "운영", "특이"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-left text-sm font-semibold mb-1">아트 스타일</label>
              <select
                value={selectedArtStyle || ""}
                onChange={(e) => setSelectedArtStyle(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                {["멋있는", "어두운", "명랑한", "환상적", "웅장한"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-left text-sm font-semibold mb-1">소환법</label>
              <select
                value={selectedSummoningMethod || ""}
                onChange={(e) => setSelectedSummoningMethod(e.target.value || null)}
                className="w-full px-3 py-2 border rounded-lg bg-white text-black dark:bg-gray-800 dark:text-white text-sm"
              >
                <option value="">전체</option>
                {summoningMethods.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Combined Tag Filter (Aesthetic & Performance) */}
          <div>
            {/* Aesthetic Tags */}
            <p className="text-left font-semibold mb-2">태그 (비성능적)</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {aestheticTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag, setSelectedAestheticTags)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                    selectedAestheticTags.includes(tag)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            {/* Performance Tags */}
            <p className="text-left font-semibold mb-2">태그 (성능적)</p>
            <div className="flex flex-wrap gap-2">
              {performanceTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag, setSelectedPerformanceTags)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                    selectedPerformanceTags.includes(tag)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-center">
            <button
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition"
              onClick={() => {
                sessionStorage.removeItem("deck_filters");
                window.location.reload();
              }}
            >
              필터 초기화
            </button>
          </div>
        </div>
      )}

      {/* List of available decks */}
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredDecks.map((deck) => (
          <div key={deck.id} className="text-center cursor-pointer" onClick={() => navigate(`/database/${deck.id}`)}>
            <div className="relative">
              <img
                src={deck.cover_image || "/default_cover.png"}
                alt={deck.name}
                loading="lazy"
                className="w-full h-24 md:h-auto md:aspect-[4/3] object-cover rounded-lg"
                style={powerBorder && POWER_COLOR[deck.strength] ? powerRing(POWER_COLOR[deck.strength]) : undefined}
              />
              {deck.is_engine && (
                <EngineBadge className="absolute top-1 left-1 w-5 h-5 sm:w-6 sm:h-6 text-[11px] sm:text-xs" />
              )}
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
