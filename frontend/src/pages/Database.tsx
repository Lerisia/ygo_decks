import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

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
}

export default function DatabasePage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [filteredDecks, setFilteredDecks] = useState<Deck[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPerformanceTags, setSelectedPerformanceTags] = useState<string[]>([]);
  const [selectedAestheticTags, setSelectedAestheticTags] = useState<string[]>([]);
  const [selectedSummoningMethod, setSelectedSummoningMethod] = useState<string | null>(null);
  const [performanceTags, setPerformanceTags] = useState<string[]>([]);
  const [aestheticTags, setAestheticTags] = useState<string[]>([]);
  const [selectedStrength, setSelectedStrength] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [selectedDeckType, setSelectedDeckType] = useState<string | null>(null);
  const [selectedArtStyle, setSelectedArtStyle] = useState<string | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const navigate = useNavigate();

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
    };
    localStorage.setItem("deck_filters", JSON.stringify(filters));
  };

  useEffect(() => {
    return () => {
      saveFilters();
    };
  }, [
    searchQuery,
    selectedPerformanceTags,
    selectedAestheticTags,
    selectedSummoningMethod,
    selectedStrength,
    selectedDifficulty,
    selectedDeckType,
    selectedArtStyle,
  ]);

  useEffect(() => {
    const saved = localStorage.getItem("deck_filters");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSearchQuery(parsed.searchQuery || "");
        setSelectedPerformanceTags(parsed.selectedPerformanceTags || []);
        setSelectedAestheticTags(parsed.selectedAestheticTags || []);
        setSelectedSummoningMethod(parsed.selectedSummoningMethod || null);
        setSelectedStrength(parsed.selectedStrength || null);
        setSelectedDifficulty(parsed.selectedDifficulty || null);
        setSelectedDeckType(parsed.selectedDeckType || null);
        setSelectedArtStyle(parsed.selectedArtStyle || null);
  
        const hasAnyFilter =
          (parsed.selectedPerformanceTags?.length ?? 0) > 0 ||
          (parsed.selectedAestheticTags?.length ?? 0) > 0 ||
          parsed.selectedSummoningMethod ||
          parsed.selectedStrength ||
          parsed.selectedDifficulty ||
          parsed.selectedDeckType ||
          parsed.selectedArtStyle;
  
        if (hasAnyFilter) {
          setFilterExpanded(true);
        }
      } catch (err) {
        console.error("필터 복원 실패:", err);
      }
    }
  }, []);
  

  useEffect(() => {
    // Get decks from backend
    fetch("/api/deck/")
    .then((res) => res.json())
    .then((data) => {
      console.log("API에서 받은 데이터:", data);
      setDecks(Array.isArray(data.decks) ? data.decks : []);
      setFilteredDecks(Array.isArray(data.decks) ? data.decks : []);
      });

    // Get tags from backend
    fetch("/api/tags/")
      .then((res) => res.json())
      .then((data) => {
        setPerformanceTags(data.performance_tags);
        setAestheticTags(data.aesthetic_tags);
      });
  }, []);

  // Apply filtering
  useEffect(() => {
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

    setFilteredDecks(filtered);
  }, [searchQuery,
    selectedPerformanceTags,
    selectedAestheticTags,
    selectedSummoningMethod,
    selectedStrength,
    selectedDifficulty,
    selectedDeckType,
    selectedArtStyle,
    decks]);


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
    <div className="h-auto min-h-screen px-4 text-center p-4">
      {/* Search decks */}
      <Input
        placeholder="덱 이름 검색..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mb-4"
      />

      {/* Filter expand / fold */}
      <button onClick={toggleFilterSection} className="mb-4 px-4 py-2 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition">
        {filterExpanded ? "필터 숨기기 ▲" : "필터 보기 ▼"}
      </button>

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
                {["티어권", "준티어권", "비티어권", "하위권"].map((o) => (
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
                localStorage.removeItem("deck_filters");
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
            <img
              src={deck.cover_image || "/default_cover.png"}
              alt={deck.name}
              className="w-full h-24 md:h-28 object-cover rounded-lg"
            />
            <p className="mt-1 text-sm sm:text-base">{deck.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
