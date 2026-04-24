import { useState, useEffect, useRef, useMemo } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { MultiBackend, TouchTransition, MouseTransition } from "react-dnd-multi-backend";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";
import { toPng } from "html-to-image";
import { getAllDecks } from "@/api/deckApi";

type Deck = {
  id: number;
  name: string;
  cover_image_small?: string | null;
  cover_image?: string | null;
};

type Tier = {
  id: string;
  name: string;
  color: string;
  deckIds: number[];
};

const DEFAULT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899",
];

const PRESETS: Record<string, { name: string; color: string }[]> = {
  "S-F": [
    { name: "S", color: "#ef4444" },
    { name: "A", color: "#f97316" },
    { name: "B", color: "#eab308" },
    { name: "C", color: "#84cc16" },
    { name: "D", color: "#06b6d4" },
    { name: "F", color: "#8b5cf6" },
  ],
  "1-5": [
    { name: "1", color: "#ef4444" },
    { name: "2", color: "#f97316" },
    { name: "3", color: "#eab308" },
    { name: "4", color: "#22c55e" },
    { name: "5", color: "#3b82f6" },
  ],
  "상/중/하": [
    { name: "상", color: "#ef4444" },
    { name: "중", color: "#eab308" },
    { name: "하", color: "#3b82f6" },
  ],
};

const DnDBackends = {
  backends: [
    { id: "html5", backend: HTML5Backend, transition: MouseTransition },
    { id: "touch", backend: TouchBackend, options: { enableMouseEvents: false }, preview: true, transition: TouchTransition },
  ],
};

const ITEM_TYPE = "DECK";

// === Draggable deck ===
function DeckCard({ deck }: { deck: Deck }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ITEM_TYPE,
    item: { id: deck.id },
    collect: (m) => ({ isDragging: m.isDragging() }),
  }));

  const img = deck.cover_image_small || deck.cover_image || "/default_cover.png";

  return (
    <div
      ref={drag as unknown as React.Ref<HTMLDivElement>}
      className={`shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${isDragging ? "opacity-30" : ""}`}
      style={{ width: 56 }}
      title={deck.name}
    >
      <img
        src={img}
        alt={deck.name}
        draggable={false}
        className="w-14 h-14 object-cover rounded border border-gray-300 dark:border-gray-600"
      />
      <div className="text-[10px] text-center truncate mt-0.5 text-gray-700 dark:text-gray-300">
        {deck.name}
      </div>
    </div>
  );
}

// === Drop zone ===
function DropZone({
  onDrop,
  children,
  className,
}: {
  onDrop: (deckId: number) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ITEM_TYPE,
    drop: (item: { id: number }) => onDrop(item.id),
    collect: (m) => ({ isOver: m.isOver() }),
  }));

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`${className || ""} ${isOver ? "ring-2 ring-blue-400" : ""}`}
    >
      {children}
    </div>
  );
}

// === Tier row ===
function TierRow({
  tier,
  decks,
  onDrop,
  onRename,
  onColorChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  tier: Tier;
  decks: Deck[];
  onDrop: (deckId: number) => void;
  onRename: (name: string) => void;
  onColorChange: (color: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showColors, setShowColors] = useState(false);

  return (
    <div className="flex border-b border-gray-300 dark:border-gray-700 min-h-[72px]">
      <div
        className="flex flex-col items-center justify-center shrink-0 w-16 relative"
        style={{ backgroundColor: tier.color }}
      >
        {editing ? (
          <input
            autoFocus
            value={tier.name}
            onChange={(e) => onRename(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Enter") setEditing(false); }}
            className="w-12 text-center bg-white/20 text-white font-bold text-lg rounded px-1"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-white font-bold text-lg tracking-wide"
          >
            {tier.name || "?"}
          </button>
        )}
        <button
          onClick={() => setShowColors((s) => !s)}
          className="text-[9px] text-white/80 mt-1 underline"
        >
          색
        </button>
        {showColors && (
          <div className="absolute top-full left-0 z-10 bg-white dark:bg-gray-800 rounded shadow p-2 grid grid-cols-4 gap-1">
            {DEFAULT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onColorChange(c); setShowColors(false); }}
                className="w-5 h-5 rounded border border-gray-300 dark:border-gray-600"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>

      <DropZone
        onDrop={onDrop}
        className="flex-1 flex flex-wrap gap-1 p-2 bg-gray-50 dark:bg-gray-800 items-center"
      >
        {decks.length === 0 && (
          <span className="text-xs text-gray-400">여기로 덱을 끌어다 놓으세요</span>
        )}
        {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
      </DropZone>

      <div className="flex flex-col justify-center gap-0.5 px-1 bg-gray-100 dark:bg-gray-900 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 px-1"
          title="위로"
        >▲</button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="text-xs text-gray-600 dark:text-gray-400 disabled:opacity-30 px-1"
          title="아래로"
        >▼</button>
        <button
          onClick={onRemove}
          className="text-xs text-red-500 px-1"
          title="삭제"
        >✕</button>
      </div>
    </div>
  );
}

// === Main page ===
export default function TierListMaker() {
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [search, setSearch] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(
    PRESETS["S-F"].map((t, i) => ({ id: `t${i}-${Date.now()}`, name: t.name, color: t.color, deckIds: [] }))
  );
  const [title, setTitle] = useState("내 서열표");
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getAllDecks().then((data) => setAllDecks(data.decks || [])).catch(() => {});
  }, []);

  const placedIds = useMemo(() => new Set(tiers.flatMap((t) => t.deckIds)), [tiers]);

  const filteredPool = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allDecks
      .filter((d) => !placedIds.has(d.id))
      .filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [allDecks, placedIds, search]);

  const deckById = useMemo(() => {
    const m = new Map<number, Deck>();
    for (const d of allDecks) m.set(d.id, d);
    return m;
  }, [allDecks]);

  const removeDeckFromTiers = (deckId: number) => {
    setTiers((prev) => prev.map((t) => ({ ...t, deckIds: t.deckIds.filter((id) => id !== deckId) })));
  };

  const onTierDrop = (tierId: string, deckId: number) => {
    setTiers((prev) => {
      const cleaned = prev.map((t) => ({ ...t, deckIds: t.deckIds.filter((id) => id !== deckId) }));
      return cleaned.map((t) => t.id === tierId ? { ...t, deckIds: [...t.deckIds, deckId] } : t);
    });
  };

  const onPoolDrop = (deckId: number) => {
    removeDeckFromTiers(deckId);
  };

  const addTier = () => {
    const idx = tiers.length;
    const color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    setTiers([...tiers, { id: `t${Date.now()}`, name: String.fromCharCode(65 + idx), color, deckIds: [] }]);
  };

  const renameTier = (id: string, name: string) =>
    setTiers((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));

  const colorTier = (id: string, color: string) =>
    setTiers((prev) => prev.map((t) => t.id === id ? { ...t, color } : t));

  const removeTier = (id: string) =>
    setTiers((prev) => prev.filter((t) => t.id !== id));

  const moveTier = (id: string, dir: -1 | 1) => {
    setTiers((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };

  const applyPreset = (key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setTiers(preset.map((t, i) => ({ id: `t${i}-${Date.now()}`, name: t.name, color: t.color, deckIds: [] })));
  };

  const exportImage = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        backgroundColor: document.documentElement.classList.contains("dark") ? "#111827" : "#ffffff",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `${title || "tier-list"}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("export failed", e);
      alert("이미지 저장 실패");
    } finally {
      setExporting(false);
    }
  };

  return (
    <DndProvider backend={MultiBackend} options={DnDBackends}>
      <div className="min-h-screen px-3 py-4 md:py-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-center mb-4">서열표 만들기</h1>

        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <span className="text-sm font-semibold">프리셋:</span>
          {Object.keys(PRESETS).map((k) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {k}
            </button>
          ))}
          <button
            onClick={addTier}
            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 ml-auto"
          >
            + 티어 추가
          </button>
          <button
            onClick={exportImage}
            disabled={exporting}
            className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            {exporting ? "저장 중..." : "이미지 저장"}
          </button>
        </div>

        <div ref={exportRef} className="bg-white dark:bg-gray-900 rounded-lg overflow-hidden shadow mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-center text-lg font-bold p-2 border-b border-gray-200 dark:border-gray-700 bg-transparent"
            placeholder="서열표 제목"
          />
          <div>
            {tiers.map((tier, i) => (
              <TierRow
                key={tier.id}
                tier={tier}
                decks={tier.deckIds.map((id) => deckById.get(id)).filter(Boolean) as Deck[]}
                onDrop={(deckId) => onTierDrop(tier.id, deckId)}
                onRename={(name) => renameTier(tier.id, name)}
                onColorChange={(color) => colorTier(tier.id, color)}
                onRemove={() => removeTier(tier.id)}
                onMoveUp={() => moveTier(tier.id, -1)}
                onMoveDown={() => moveTier(tier.id, 1)}
                canMoveUp={i > 0}
                canMoveDown={i < tiers.length - 1}
              />
            ))}
          </div>
        </div>

        <div className="mb-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="덱 검색..."
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
          />
        </div>

        <DropZone
          onDrop={onPoolDrop}
          className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[120px]"
        >
          <div className="text-xs text-gray-500 mb-2">
            {filteredPool.length}개의 덱 (드래그해서 티어로 이동)
          </div>
          <div className="flex flex-wrap gap-2">
            {filteredPool.map((d) => <DeckCard key={d.id} deck={d} />)}
          </div>
        </DropZone>
      </div>
    </DndProvider>
  );
}
