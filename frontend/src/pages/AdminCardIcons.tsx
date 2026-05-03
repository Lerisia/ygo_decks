import { useEffect, useRef, useState } from "react";
import {
  searchCards, listIcons, createIcon, updateIcon, deleteIcon,
  type CardSearchResult, type CardIcon, type IconCategory,
} from "@/api/cardIconApi";
import { getMyBorders, type Border } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";

const CATEGORY_LABEL: Record<IconCategory, string> = {
  default: "기본 지급",
  shop: "상점 판매",
  exclusive: "비매품",
};

const CATEGORY_BADGE: Record<IconCategory, string> = {
  default: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  shop: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  exclusive: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
};

const PREVIEW_SIZE = 96;

export default function AdminCardIcons() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);
  // Crop state — center + radius in 0~1 ratio of image min dimension
  const [centerX, setCenterX] = useState(0.5);
  const [centerY, setCenterY] = useState(0.5);
  const [radius, setRadius] = useState(0.25);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const [icons, setIcons] = useState<CardIcon[]>([]);
  const [error, setError] = useState("");
  const [showCrosshair, setShowCrosshair] = useState(false);
  const [editingIconId, setEditingIconId] = useState<number | null>(null);
  const [category, setCategory] = useState<IconCategory>("exclusive");
  const [price, setPrice] = useState<number>(0);
  const [availableBorders, setAvailableBorders] = useState<Border[]>([]);
  const [previewBorderId, setPreviewBorderId] = useState<number | null>(null);
  const [savedQuery, setSavedQuery] = useState("");

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Load saved icons + borders on mount
  useEffect(() => {
    refreshIcons();
    getMyBorders()
      .then((d) => {
        setAvailableBorders(d.borders);
        const def = d.borders.find((b) => b.is_default) || d.borders[0];
        if (def) setPreviewBorderId(def.id);
      })
      .catch(() => {});
  }, []);

  const refreshIcons = async () => {
    try {
      const data = await listIcons();
      setIcons(data.icons);
    } catch (e: any) {
      setError(e.message || "아이콘 목록 로드 실패");
    }
  };

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const data = await searchCards(query);
        setSearchResults(data.results);
      } catch (e: any) {
        setError(e.message || "검색 실패");
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const handleSelectCard = (c: CardSearchResult) => {
    setSelectedCard(c);
    setCenterX(0.5);
    setCenterY(0.5);
    setRadius(0.25);
    setTitle(c.name);
    setCategory("exclusive");
    setPrice(0);
    setSearchResults([]);
    setQuery("");
    setEditingIconId(null);
  };

  const handleEditIcon = (icon: CardIcon) => {
    setSelectedCard({
      id: icon.card,
      card_id: icon.card_id,
      name: icon.card_name,
      image_url: icon.card_image_url,
    });
    setCenterX(icon.center_x);
    setCenterY(icon.center_y);
    setRadius(icon.radius);
    setTitle(icon.title || icon.card_name);
    setCategory(icon.category);
    setPrice(icon.price);
    setEditingIconId(icon.id);
    setSearchResults([]);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onImageLoad = () => {
    if (imgRef.current) {
      setImgDims({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  };

  // Drag to move circle center
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { active: true, offsetX: 0, offsetY: 0 };
    handlePointerMove(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current?.active || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setCenterX(Math.max(0, Math.min(1, x)));
    setCenterY(Math.max(0, Math.min(1, y)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) dragRef.current.active = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const handleSave = async () => {
    if (!selectedCard) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: title.trim(),
        center_x: centerX,
        center_y: centerY,
        radius: radius,
        category,
        price: category === "shop" ? price : 0,
      };
      if (editingIconId) {
        await updateIcon(editingIconId, payload);
      } else {
        await createIcon({ card: selectedCard.id, ...payload });
      }
      await refreshIcons();
      setSelectedCard(null);
      setEditingIconId(null);
    } catch (e: any) {
      setError(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 아이콘을 삭제하시겠습니까?")) return;
    try {
      await deleteIcon(id);
      await refreshIcons();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const editorSize = 480;

  return (
    <div className="min-h-screen px-4 py-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">카드 아이콘 관리</h1>
      <p className="text-sm text-gray-500 mb-6">관리자 전용 — 카드 일러스트를 원형으로 잘라 아이콘으로 등록합니다.</p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Card search */}
      {!selectedCard && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-6">
          <h2 className="font-semibold mb-2">카드 검색</h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="카드 이름으로 검색"
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
          />
          {searching && <p className="text-sm text-gray-500">검색 중...</p>}
          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCard(c)}
                  className="flex flex-col items-center p-2 border rounded-lg bg-gray-50 dark:bg-gray-900 hover:border-blue-500"
                >
                  {c.image_url && (
                    <img src={c.image_url} alt="" className="w-20 h-20 object-cover rounded mb-1" />
                  )}
                  <span className="text-xs text-center truncate w-full">{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crop editor */}
      {selectedCard && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              {editingIconId ? "수정" : "크롭"}: {selectedCard.name}
            </h2>
            <button
              onClick={() => { setSelectedCard(null); setEditingIconId(null); }}
              className="text-sm text-gray-500 hover:underline"
            >
              ← {editingIconId ? "취소" : "카드 다시 선택"}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Editor */}
            <div>
              <div
                ref={containerRef}
                className="relative bg-gray-200 dark:bg-gray-900 rounded-lg overflow-hidden touch-none select-none w-full"
                style={{
                  maxWidth: editorSize,
                  aspectRatio: imgDims.w && imgDims.h ? `${imgDims.w} / ${imgDims.h}` : "1 / 1",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {selectedCard.image_url && (
                  <img
                    ref={imgRef}
                    src={selectedCard.image_url}
                    onLoad={onImageLoad}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    draggable={false}
                  />
                )}
                {/* Crop circle: center (centerX,centerY) fractional of image, radius fraction of image min(W,H) */}
                {imgDims.w > 0 && imgDims.h > 0 && (() => {
                  const minDim = Math.min(imgDims.w, imgDims.h);
                  // Convert to container percentage, where radius is in image-min-dim units
                  const rPercentX = (radius * minDim) / imgDims.w * 100;
                  const rPercentY = (radius * minDim) / imgDims.h * 100;
                  return (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${centerX * 100 - rPercentX}%`,
                        top: `${centerY * 100 - rPercentY}%`,
                        width: `${rPercentX * 2}%`,
                        height: `${rPercentY * 2}%`,
                        borderRadius: "50%",
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                        border: "2px solid #3b82f6",
                      }}
                    />
                  );
                })()}
              </div>

              <div className="mt-3 space-y-2">
                <label className="block text-xs text-gray-500">
                  크기: {(radius * 200).toFixed(1)}%
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.005}
                  value={radius}
                  onChange={(e) => setRadius(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <p className="text-xs text-gray-400 mt-2">이미지 위에서 드래그하여 원형 위치 조정</p>
            </div>

            {/* Preview + save */}
            <div>
              <h3 className="font-semibold mb-2 text-sm">미리보기</h3>
              <div className="flex items-center gap-4 mb-2">
                <CircularPreview
                  imageUrl={selectedCard.image_url || ""}
                  centerX={centerX}
                  centerY={centerY}
                  radius={radius}
                  size={PREVIEW_SIZE}
                  crosshair={showCrosshair}
                />
                <CircularPreview
                  imageUrl={selectedCard.image_url || ""}
                  centerX={centerX}
                  centerY={centerY}
                  radius={radius}
                  size={48}
                  crosshair={showCrosshair}
                />
                <CircularPreview
                  imageUrl={selectedCard.image_url || ""}
                  centerX={centerX}
                  centerY={centerY}
                  radius={radius}
                  size={32}
                  crosshair={showCrosshair}
                />
              </div>
              <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCrosshair}
                  onChange={(e) => setShowCrosshair(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">중앙 십자선 표시</span>
              </label>

              <label className="block text-xs text-gray-500 mb-1">제목 (선택)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="이 아이콘의 표시명"
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
              />

              <label className="block text-xs text-gray-500 mb-1">분류</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as IconCategory)}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-2"
              >
                <option value="default">기본 지급 (모든 유저에게 표시)</option>
                <option value="shop">상점 판매</option>
                <option value="exclusive">비매품 (어드민 부여)</option>
              </select>
              {category === "shop" && (
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">가격 (포인트)</label>
                  <input
                    type="number"
                    min={0}
                    value={price}
                    onChange={(e) => setPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
                  />
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "저장 중..." : editingIconId ? "수정 저장" : "아이콘 저장"}
              </button>
              {imgDims.w > 0 && (
                <p className="text-[10px] text-gray-400 mt-2">
                  원본: {imgDims.w}×{imgDims.h} · 좌표 ({(centerX * 100).toFixed(1)}%, {(centerY * 100).toFixed(1)}%) · 반지름 {(radius * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Saved icons */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">저장된 아이콘 ({icons.length})</h2>
          {availableBorders.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">미리보기 테두리</label>
              <select
                value={previewBorderId ?? ""}
                onChange={(e) => setPreviewBorderId(e.target.value ? Number(e.target.value) : null)}
                className="px-2 py-1 border rounded-lg bg-white dark:bg-gray-800 text-xs"
              >
                <option value="">없음</option>
                {availableBorders.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <input
          type="text"
          value={savedQuery}
          onChange={(e) => setSavedQuery(e.target.value)}
          placeholder="저장된 아이콘 검색 (이름)"
          className="w-full px-3 py-2 mb-3 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
        {(() => {
          const q = savedQuery.trim().toLowerCase();
          const filteredSaved = q
            ? icons.filter((i) =>
                (i.card_name || "").toLowerCase().includes(q) ||
                (i.title || "").toLowerCase().includes(q)
              )
            : icons;
          if (icons.length === 0) {
            return <p className="text-sm text-gray-500">아직 등록된 아이콘이 없습니다.</p>;
          }
          if (filteredSaved.length === 0) {
            return <p className="text-sm text-gray-500">검색 결과가 없습니다.</p>;
          }
          return (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {filteredSaved.map((icon) => {
              const previewBorder = availableBorders.find((b) => b.id === previewBorderId) || null;
              return (
                <div key={icon.id} className="flex flex-col items-center text-center">
                  <Avatar
                    icon={{
                      id: icon.id,
                      title: icon.title,
                      card: icon.card,
                      card_id: icon.card_id,
                      card_name: icon.card_name,
                      card_image_url: icon.card_image_url,
                      center_x: icon.center_x,
                      center_y: icon.center_y,
                      radius: icon.radius,
                    }}
                    border={previewBorder}
                    size={64}
                  />
                  <span className="text-xs mt-1 truncate w-full">{icon.title || icon.card_name}</span>
                  <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${CATEGORY_BADGE[icon.category]}`}>
                    {CATEGORY_LABEL[icon.category]}{icon.category === "shop" ? ` ${icon.price}P` : ""}
                  </span>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => handleEditIcon(icon)}
                      className="text-[10px] text-blue-500 hover:underline"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(icon.id)}
                      className="text-[10px] text-red-500 hover:underline"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
    </div>
  );
}

function CircularPreview({
  imageUrl, centerX, centerY, radius, size, crosshair = false,
}: {
  imageUrl: string;
  centerX: number;
  centerY: number;
  radius: number;
  size: number;
  crosshair?: boolean;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!imageUrl) { setDims(null); return; }
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // For non-square images, radius is relative to min(imgW, imgH).
  // Crop center (centerX, centerY) is image-relative (0..1).
  let bgWidth = size, bgHeight = size, bgX = 0, bgY = 0;
  if (dims) {
    const minDim = Math.min(dims.w, dims.h);
    const cropDiameterImg = 2 * radius * minDim; // pixels in image space
    const scale = size / cropDiameterImg;
    bgWidth = dims.w * scale;
    bgHeight = dims.h * scale;
    const cxImg = centerX * dims.w;
    const cyImg = centerY * dims.h;
    bgX = -(cxImg * scale - size / 2);
    bgY = -(cyImg * scale - size / 2);
  }

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
        backgroundPosition: `${bgX + 2}px ${bgY}px`,
        backgroundRepeat: "no-repeat",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {crosshair && (
        <>
          <div style={{
            position: "absolute", left: "50%", top: 0, bottom: 0, width: 1,
            background: "rgba(239, 68, 68, 0.85)", transform: "translateX(-50%)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", top: "50%", left: 0, right: 0, height: 1,
            background: "rgba(239, 68, 68, 0.85)", transform: "translateY(-50%)", pointerEvents: "none",
          }} />
        </>
      )}
    </div>
  );
}
