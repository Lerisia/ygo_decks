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
  deckIds: number[];
};

const MAX_TIERS = 8;

const COLOR_PALETTES: Record<number, string[]> = {
  1: ["#ef4444"],
  2: ["#ef4444", "#3b82f6"],
  3: ["#ef4444", "#eab308", "#3b82f6"],
  4: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"],
  5: ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"],
  6: ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6"],
  7: ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#06b6d4", "#8b5cf6"],
  8: ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"],
};

const getTierColor = (index: number, total: number): string => {
  const palette = COLOR_PALETTES[total] || COLOR_PALETTES[8];
  return palette[Math.min(index, palette.length - 1)];
};

const PRESETS: Record<string, string[]> = {
  "S-F": ["S", "A", "B", "C", "D", "F"],
  "1-5": ["1", "2", "3", "4", "5"],
  "상/중/하": ["상", "중", "하"],
};

const DnDBackends = {
  backends: [
    { id: "html5", backend: HTML5Backend, transition: MouseTransition },
    { id: "touch", backend: TouchBackend, options: { enableMouseEvents: false }, preview: true, transition: TouchTransition },
  ],
};

const ITEM_TYPE = "DECK";

// Drag item payload
type DragItem = { id: number; from: { tierId: string | null; index: number } };

// === Draggable deck ===
function DeckCard({
  deck,
  fromTierId,
  fromIndex,
  onDropOn,
  onDropOutside,
  size = "normal",
}: {
  deck: Deck;
  fromTierId: string | null; // null = pool
  fromIndex: number;
  onDropOn?: (item: DragItem, targetTierId: string | null, targetIndex: number) => void;
  onDropOutside?: (deckId: number) => void;
  size?: "normal" | "export";
}) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ITEM_TYPE,
    item: { id: deck.id, from: { tierId: fromTierId, index: fromIndex } } as DragItem,
    end: (item, monitor) => {
      if (!monitor.didDrop() && onDropOutside) {
        // Dropped outside any valid target — return to pool
        onDropOutside(item.id);
      }
    },
    collect: (m) => ({ isDragging: m.isDragging() }),
  }), [deck.id, fromTierId, fromIndex, onDropOutside]);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: ITEM_TYPE,
    canDrop: (item: DragItem) => item.id !== deck.id,
    drop: (item: DragItem) => {
      if (onDropOn && item.id !== deck.id) {
        onDropOn(item, fromTierId, fromIndex);
      }
    },
    collect: (m) => ({ isOver: m.isOver() && m.canDrop() }),
  }), [deck.id, fromTierId, fromIndex, onDropOn]);

  const img = deck.cover_image_small || deck.cover_image || "/default_cover.png";

  if (size === "export") {
    return (
      <div className="shrink-0" style={{ width: 96 }}>
        <img
          src={img}
          alt={deck.name}
          draggable={false}
          className="w-24 h-24 object-cover rounded-lg border-2 border-gray-300 shadow"
        />
        <div className="w-24 text-sm text-center truncate mt-1 text-gray-700 font-semibold">
          {deck.name}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={(node) => { drag(drop(node)); }}
      className={`shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${isDragging ? "opacity-30" : ""} ${isOver ? "scale-110 transition-transform" : ""}`}
      title={deck.name}
    >
      <img
        src={img}
        alt={deck.name}
        draggable={false}
        className={`w-20 md:w-24 h-20 md:h-24 object-cover rounded-lg border-2 ${isOver ? "border-blue-500" : "border-gray-300 dark:border-gray-600"} shadow`}
      />
      <div className="w-20 md:w-24 text-xs md:text-sm text-center truncate mt-1 text-gray-700 dark:text-gray-300 font-medium">
        {deck.name}
      </div>
    </div>
  );
}

// === Drop zone (container — appends to end) ===
function DropZone({
  onDrop,
  children,
  className,
}: {
  onDrop: (item: DragItem) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ITEM_TYPE,
    drop: (item: DragItem, monitor) => {
      // Only fire if a child didn't already handle it
      if (monitor.didDrop()) return;
      onDrop(item);
    },
    collect: (m) => ({ isOver: m.isOver({ shallow: true }) }),
  }));

  return (
    <div
      ref={drop as unknown as React.Ref<HTMLDivElement>}
      className={`${className || ""} ${isOver ? "ring-4 ring-blue-400" : ""}`}
    >
      {children}
    </div>
  );
}

// === Tier row ===
function TierRow({
  tier,
  color,
  decks,
  onDropToEnd,
  onDropOnDeck,
  onDropOutside,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  canRemove,
}: {
  tier: Tier;
  color: string;
  decks: Deck[];
  onDropToEnd: (item: DragItem) => void;
  onDropOnDeck: (item: DragItem, targetTierId: string | null, targetIndex: number) => void;
  onDropOutside: (deckId: number) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex border-b-2 border-gray-200 dark:border-gray-700 min-h-[100px] md:min-h-[120px]">
      <div
        className="flex items-center justify-center shrink-0 w-20 md:w-24"
        style={{ backgroundColor: color }}
      >
        {editing ? (
          <input
            autoFocus
            value={tier.name}
            onChange={(e) => onRename(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Enter") setEditing(false); }}
            className="w-16 text-center bg-white/20 text-white font-bold text-2xl md:text-3xl rounded px-1"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-white font-bold text-2xl md:text-3xl tracking-wide w-full h-full"
          >
            {tier.name || "?"}
          </button>
        )}
      </div>

      <DropZone
        onDrop={onDropToEnd}
        className="flex-1 flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-gray-800 items-center"
      >
        {decks.length === 0 && (
          <span className="text-sm text-gray-400">여기로 덱을 끌어다 놓으세요</span>
        )}
        {decks.map((d, idx) => (
          <DeckCard
            key={d.id}
            deck={d}
            fromTierId={tier.id}
            fromIndex={idx}
            onDropOn={onDropOnDeck}
            onDropOutside={onDropOutside}
          />
        ))}
      </DropZone>

      <div className="flex flex-col justify-center gap-1 px-2 bg-gray-100 dark:bg-gray-900 shrink-0 w-10 md:w-12">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="text-base text-gray-600 dark:text-gray-400 disabled:opacity-30 py-1"
        >▲</button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="text-base text-gray-600 dark:text-gray-400 disabled:opacity-30 py-1"
        >▼</button>
        {canRemove && (
          <button
            onClick={onRemove}
            className="text-base text-red-500 py-1"
          >✕</button>
        )}
      </div>
    </div>
  );
}

// === Fixed-size export layout (landscape, for image save) ===
function ExportView({
  title,
  tiers,
  deckById,
}: {
  title: string;
  tiers: Tier[];
  deckById: Map<number, Deck>;
}) {
  return (
    <div style={{ width: 1280, background: "#ffffff", color: "#111827" }}>
      <div style={{
        textAlign: "center",
        fontSize: 32,
        fontWeight: "bold",
        padding: 16,
        borderBottom: "2px solid #e5e7eb",
      }}>
        {title}
      </div>
      <div>
        {tiers.map((tier, i) => (
          <div
            key={tier.id}
            style={{
              display: "flex",
              borderBottom: "2px solid #e5e7eb",
              minHeight: 140,
            }}
          >
            <div
              style={{
                width: 110,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: getTierColor(i, tiers.length),
              }}
            >
              <div style={{ color: "white", fontWeight: "bold", fontSize: 40, textAlign: "center" }}>
                {tier.name || "?"}
              </div>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                padding: 12,
                backgroundColor: "#f9fafb",
                alignItems: "center",
              }}
            >
              {tier.deckIds.map((id) => {
                const d = deckById.get(id);
                if (!d) return null;
                return <DeckCard key={d.id} deck={d} fromTierId={tier.id} fromIndex={0} size="export" />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// === Main page ===
export default function TierListMaker() {
  const [allDecks, setAllDecks] = useState<Deck[]>([]);
  const [search, setSearch] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(
    PRESETS["S-F"].map((name, i) => ({ id: `t${i}-${Date.now()}`, name, deckIds: [] }))
  );
  const [title, setTitle] = useState("내 서열표");
  const hiddenExportRef = useRef<HTMLDivElement>(null);
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

  // Move deck: remove from source, insert at target (or append if targetIndex = -1)
  const moveDeck = (deckId: number, targetTierId: string | null, targetIndex: number) => {
    setTiers((prev) => {
      const cleaned = prev.map((t) => ({
        ...t,
        deckIds: t.deckIds.filter((id) => id !== deckId),
      }));
      if (targetTierId === null) return cleaned; // moved to pool
      return cleaned.map((t) => {
        if (t.id !== targetTierId) return t;
        const newIds = [...t.deckIds];
        if (targetIndex < 0 || targetIndex >= newIds.length) {
          newIds.push(deckId);
        } else {
          newIds.splice(targetIndex, 0, deckId);
        }
        return { ...t, deckIds: newIds };
      });
    });
  };

  const onTierEndDrop = (tierId: string) => (item: DragItem) => {
    moveDeck(item.id, tierId, -1);
  };

  const onDeckDrop = (item: DragItem, targetTierId: string | null, targetIndex: number) => {
    // If same tier, adjust index for removal
    if (item.from.tierId === targetTierId && item.from.index < targetIndex) {
      moveDeck(item.id, targetTierId, targetIndex);
    } else {
      moveDeck(item.id, targetTierId, targetIndex);
    }
  };

  const onPoolDrop = (item: DragItem) => {
    moveDeck(item.id, null, -1);
  };

  const addTier = () => {
    if (tiers.length >= MAX_TIERS) return;
    const idx = tiers.length;
    setTiers([...tiers, { id: `t${Date.now()}`, name: String.fromCharCode(65 + idx), deckIds: [] }]);
  };

  const renameTier = (id: string, name: string) =>
    setTiers((prev) => prev.map((t) => t.id === id ? { ...t, name } : t));

  const removeTier = (id: string) => {
    if (tiers.length <= 1) return;
    setTiers((prev) => prev.filter((t) => t.id !== id));
  };

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
    setTiers(preset.map((name, i) => ({ id: `t${i}-${Date.now()}`, name, deckIds: [] })));
  };

  const exportImage = async () => {
    if (!hiddenExportRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(hiddenExportRef.current, {
        cacheBust: true,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        width: 1280,
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
      <div className="min-h-screen w-full px-3 py-4 md:py-6 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-4">서열표 만들기</h1>

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <span className="text-base font-semibold w-full md:w-auto">프리셋</span>
          {Object.keys(PRESETS).map((k) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
            >
              {k}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={addTier}
            disabled={tiers.length >= MAX_TIERS}
            className="flex-1 px-4 py-3 text-base bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold disabled:opacity-50"
          >
            + 티어 추가 ({tiers.length}/{MAX_TIERS})
          </button>
          <button
            onClick={exportImage}
            disabled={exporting}
            className="flex-1 px-4 py-3 text-base bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-semibold disabled:opacity-50"
          >
            {exporting ? "저장 중..." : "💾 이미지 저장"}
          </button>
        </div>

        <div className="w-full bg-white dark:bg-gray-900 rounded-lg overflow-hidden shadow mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-center text-xl font-bold p-3 border-b-2 border-gray-200 dark:border-gray-700 bg-transparent"
            placeholder="서열표 제목"
          />
          <div>
            {tiers.map((tier, i) => (
              <TierRow
                key={tier.id}
                tier={tier}
                color={getTierColor(i, tiers.length)}
                decks={tier.deckIds.map((id) => deckById.get(id)).filter(Boolean) as Deck[]}
                onDropToEnd={onTierEndDrop(tier.id)}
                onDropOnDeck={onDeckDrop}
                onDropOutside={(deckId) => moveDeck(deckId, null, -1)}
                onRename={(name) => renameTier(tier.id, name)}
                onRemove={() => removeTier(tier.id)}
                onMoveUp={() => moveTier(tier.id, -1)}
                onMoveDown={() => moveTier(tier.id, 1)}
                canMoveUp={i > 0}
                canMoveDown={i < tiers.length - 1}
                canRemove={tiers.length > 1}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 덱 검색..."
            className="w-full px-4 py-3 text-base border-2 rounded-lg bg-white dark:bg-gray-800"
          />
        </div>

        {/* Hidden fixed-size export view */}
        <div style={{ position: "absolute", left: -99999, top: 0, pointerEvents: "none" }} aria-hidden>
          <div ref={hiddenExportRef}>
            <ExportView title={title} tiers={tiers} deckById={deckById} />
          </div>
        </div>

        <DropZone
          onDrop={onPoolDrop}
          className="w-full p-3 bg-gray-100 dark:bg-gray-800 rounded-lg min-h-[160px]"
        >
          <div className="text-sm text-gray-500 mb-3 font-medium">
            {filteredPool.length}개의 덱 · 드래그해서 티어로 이동
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3 justify-items-center">
            {filteredPool.map((d, idx) => (
              <DeckCard
                key={d.id}
                deck={d}
                fromTierId={null}
                fromIndex={idx}
              />
            ))}
          </div>
        </DropZone>
      </div>
    </DndProvider>
  );
}
