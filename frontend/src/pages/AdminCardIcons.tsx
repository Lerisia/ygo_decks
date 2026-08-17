import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  searchCards, listCustomIllusts, uploadCustomIllust, deleteCustomIllust, importTweetIllusts, bulkUploadCustomIllusts,
  getTwitterCredentials, setTwitterCredentials, scrapeTwitterRange,
  listIcons, createIcon, updateIcon, deleteIcon, setIconNew, listThemes, bulkSetTheme,
  RARITY_LABEL, RARITY_PRICE, RARITY_BADGE,
  type CardSearchResult, type CardIcon, type IconCategory, type IconRarity,
} from "@/api/cardIconApi";
import { getMyBorders, listAdminBorders, updateBorder, type Border } from "@/api/avatarApi";
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
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<"card" | "custom">("card");
  const [customPage, setCustomPage] = useState(1);
  const [customTotalPages, setCustomTotalPages] = useState(1);
  const [customTotal, setCustomTotal] = useState(0);

  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);
  const [selectedSourceType, setSelectedSourceType] = useState<"card" | "custom">("card");
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
  const [rarity, setRarity] = useState<IconRarity>("");
  const [theme, setTheme] = useState<string>("");
  const [knownThemes, setKnownThemes] = useState<string[]>([]);
  const [availableBorders, setAvailableBorders] = useState<Border[]>([]);
  const [previewBorderId, setPreviewBorderId] = useState<number | null>(null);
  const [savedQuery, setSavedQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<IconCategory | "all">("all");
  const [themeFilter, setThemeFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"category" | "theme">("theme");
  const [colsPerRow, setColsPerRow] = useState<5 | 8>(8);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTheme, setBulkTheme] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  // 테두리(프레임) pricing panel — list all borders, set category/rarity.
  const [borderPanelOpen, setBorderPanelOpen] = useState(false);
  const [adminBorders, setAdminBorders] = useState<Border[]>([]);
  const [adminBordersLoaded, setAdminBordersLoaded] = useState(false);
  const [borderSavingId, setBorderSavingId] = useState<number | null>(null);

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
    try {
      const t = await listThemes();
      setKnownThemes(t.themes);
    } catch {}
  };

  // Lazy-load the full border list when the pricing panel opens.
  useEffect(() => {
    if (!borderPanelOpen || adminBordersLoaded) return;
    listAdminBorders()
      .then((d) => { setAdminBorders(d.borders); setAdminBordersLoaded(true); })
      .catch((e: any) => setError(e.message || "테두리 목록 로드 실패"));
  }, [borderPanelOpen, adminBordersLoaded]);

  const saveBorder = async (id: number, patch: { category?: IconCategory; rarity?: IconRarity }) => {
    setBorderSavingId(id);
    try {
      const updated = await updateBorder(id, patch);
      setAdminBorders((prev) => prev.map((b) => b.id === id ? { ...b, ...updated } : b));
    } catch (e: any) {
      setError(e.message || "테두리 저장 실패");
    } finally {
      setBorderSavingId(null);
    }
  };

  // Debounced search. Custom-tab pages 20 at a time (newest first); empty
  // query just pages through the whole pool. Card-tab still needs ≥1 char
  // (pool is huge).
  useEffect(() => {
    const q = query.trim();
    if (!q && searchMode === "card") { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        if (searchMode === "card") {
          const data = await searchCards(q);
          setSearchResults(data.results);
        } else {
          const data = await listCustomIllusts(q || undefined, customPage);
          setSearchResults(
            data.results.map((r) => ({ id: r.id, card_id: "", name: r.name, image_url: r.image_url }))
          );
          setCustomTotalPages(data.total_pages);
          setCustomTotal(data.total);
        }
      } catch (e: any) {
        setError(e.message || "검색 실패");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, searchMode, customPage]);

  // Reset to page 1 on query or mode change so the user doesn't land on a stale page.
  useEffect(() => { setCustomPage(1); }, [query, searchMode]);

  const handleSelectCard = (c: CardSearchResult) => {
    setSelectedCard(c);
    setSelectedSourceType(searchMode);
    setCenterX(0.5);
    setCenterY(0.5);
    setRadius(0.25);
    setTitle(c.name);
    setCategory("exclusive");
    setRarity("");
    setTheme("");
    setEditingIconId(null);
  };

  const handleEditIcon = (icon: CardIcon) => {
    setSelectedCard({
      id: icon.is_custom ? (icon.custom_illust as number) : (icon.card as number),
      card_id: icon.card_id || "",
      name: icon.card_name || "",
      image_url: icon.card_image_url,
    });
    setSelectedSourceType(icon.is_custom ? "custom" : "card");
    setCenterX(icon.center_x);
    setCenterY(icon.center_y);
    setRadius(icon.radius);
    setTitle(icon.title || icon.card_name || "");
    setCategory(icon.category);
    setRarity(icon.rarity);
    setTheme(icon.theme || "");
    setEditingIconId(icon.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onImageLoad = () => {
    if (imgRef.current) {
      setImgDims({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  };

  // Relative-drag move: pointerdown anywhere on the image records the
  // starting cursor position + current center, and pointermove shifts
  // the center by the cursor delta (no jump-to-cursor). Lets users grab
  // the image at any point and pan the crop precisely — especially
  // helpful on touch where overshooting was easy with absolute mode.
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origCx: number;
    origCy: number;
  } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origCx: centerX,
      origCy: centerY,
    };
  };

  const clampCenter = (cx: number, cy: number, r: number) => {
    if (!imgDims.w || !imgDims.h) {
      return { cx: Math.max(0, Math.min(1, cx)), cy: Math.max(0, Math.min(1, cy)) };
    }
    const minDim = Math.min(imgDims.w, imgDims.h);
    const minCx = (r * minDim) / imgDims.w;
    const minCy = (r * minDim) / imgDims.h;
    return {
      cx: Math.max(minCx, Math.min(1 - minCx, cx)),
      cy: Math.max(minCy, Math.min(1 - minCy, cy)),
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current?.active || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragRef.current.startX) / rect.width;
    const dy = (e.clientY - dragRef.current.startY) / rect.height;
    const { cx, cy } = clampCenter(
      dragRef.current.origCx + dx,
      dragRef.current.origCy + dy,
      radius,
    );
    setCenterX(cx);
    setCenterY(cy);
  };

  // Re-clamp center when radius changes so the circle stays inside the image
  useEffect(() => {
    const { cx, cy } = clampCenter(centerX, centerY, radius);
    if (cx !== centerX) setCenterX(cx);
    if (cy !== centerY) setCenterY(cy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, imgDims.w, imgDims.h]);

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
        rarity: category === "shop" ? (rarity || "common") : "" as IconRarity,
        theme: theme.trim(),
      };
      if (editingIconId) {
        await updateIcon(editingIconId, payload);
      } else {
        const sourceField = selectedSourceType === "custom"
          ? { custom_illust: selectedCard.id }
          : { card: selectedCard.id };
        await createIcon({ ...sourceField, ...payload });
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

  const handleToggleNew = async (icon: CardIcon) => {
    const target = !icon.is_new;
    try {
      await setIconNew(icon.id, target);
      setIcons((prev) => prev.map((i) =>
        i.id === icon.id
          ? { ...i, is_new: target, shop_listed_at: target ? new Date().toISOString() : null }
          : i
      ));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const filteredSaved = useMemo(() => {
    const q = savedQuery.trim().toLowerCase();
    let list = q
      ? icons.filter((i) =>
          (i.card_name || "").toLowerCase().includes(q) ||
          (i.title || "").toLowerCase().includes(q) ||
          (i.theme || "").toLowerCase().includes(q)
        )
      : icons;
    if (categoryFilter !== "all") {
      list = list.filter((i) => i.category === categoryFilter);
    }
    if (themeFilter !== "all") {
      if (themeFilter === "__none__") list = list.filter((i) => !i.theme);
      else list = list.filter((i) => i.theme === themeFilter);
    }
    const catOrder: Record<IconCategory, number> = { default: 0, shop: 1, exclusive: 2 };
    return [...list].sort((a, b) => {
      const ca = catOrder[a.category] - catOrder[b.category];
      if (ca !== 0) return ca;
      if (a.category === "shop" && b.category === "shop") {
        const pa = (a.price || 0) - (b.price || 0);
        if (pa !== 0) return pa;
      }
      return (a.card_name || "").localeCompare(b.card_name || "");
    });
  }, [icons, savedQuery, categoryFilter, themeFilter]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedIds(new Set(filteredSaved.map((i) => i.id)));
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  const handleBulkApplyTheme = async () => {
    if (selectedIds.size === 0) return;
    setBulkSaving(true);
    setError("");
    try {
      await bulkSetTheme([...selectedIds], bulkTheme.trim());
      await refreshIcons();
      setSelectedIds(new Set());
      setBulkTheme("");
    } catch (e: any) {
      setError(e.message || "일괄 적용 실패");
    } finally {
      setBulkSaving(false);
    }
  };

  const editorSize = 480;

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 관리
      </button>
      <h1 className="text-2xl font-bold mb-2">카드 아이콘 관리</h1>
      <p className="text-sm text-gray-500 mb-6">관리자 전용 — 카드 일러스트를 원형으로 잘라 아이콘으로 등록합니다.</p>

      <datalist id="known-themes">
        {knownThemes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 테두리(프레임) pricing — borders are seeded fixtures; this just
          sets category + rarity (price auto-derives from rarity). */}
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
        <button
          onClick={() => setBorderPanelOpen((v) => !v)}
          className="w-full flex items-center justify-between font-semibold"
        >
          <span>🖼️ 테두리(프레임) 등급·가격 관리</span>
          <span className="text-xs text-gray-500">{borderPanelOpen ? "▲ 닫기" : "▼ 열기"}</span>
        </button>
        {borderPanelOpen && (
          <div className="mt-3">
            {!adminBordersLoaded ? (
              <p className="text-sm text-gray-500">불러오는 중...</p>
            ) : adminBorders.length === 0 ? (
              <p className="text-sm text-gray-500">테두리가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {adminBorders.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 p-2 border rounded-lg border-gray-200 dark:border-gray-700">
                    <Avatar icon={null} border={b} size={56} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{b.name}</div>
                      <div className="text-[11px] text-gray-400">{b.key}{b.is_default ? " · 기본" : ""}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
                        <select
                          value={b.category || "exclusive"}
                          onChange={(e) => saveBorder(b.id, { category: e.target.value as IconCategory })}
                          disabled={borderSavingId === b.id}
                          className="text-xs px-1.5 py-1 border rounded bg-white dark:bg-gray-800"
                        >
                          {(["default", "shop", "exclusive"] as IconCategory[]).map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                          ))}
                        </select>
                        <select
                          value={b.rarity || ""}
                          onChange={(e) => saveBorder(b.id, { rarity: e.target.value as IconRarity })}
                          disabled={borderSavingId === b.id || (b.category !== "shop")}
                          className="text-xs px-1.5 py-1 border rounded bg-white dark:bg-gray-800 disabled:opacity-40"
                        >
                          <option value="">(등급 없음)</option>
                          {(["rare", "epic", "legendary"] as Exclude<IconRarity, "">[]).map((r) => (
                            <option key={r} value={r}>{RARITY_LABEL[r]}</option>
                          ))}
                        </select>
                        <span className={`text-xs font-bold ${b.category === "shop" ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>
                          {b.category === "shop" ? `${b.price ?? 0}P` : "—"}
                        </span>
                        {borderSavingId === b.id && <span className="text-xs text-gray-400">저장 중…</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-3">상점 판매로 바꾸면 등급 선택이 활성화되고, 등급에서 가격이 자동 결정됩니다. 만들기/삭제는 여기서 안 됩니다.</p>
          </div>
        )}
      </div>

      {/* Card search */}
      {!selectedCard && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">{searchMode === "card" ? "카드 검색" : "커스텀 일러스트"}</h2>
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => { setSearchMode("card"); setQuery(""); setSearchResults([]); }}
                className={`px-2 py-1 rounded ${searchMode === "card" ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}
              >
                카드
              </button>
              <button
                onClick={() => { setSearchMode("custom"); setQuery(""); setSearchResults([]); }}
                className={`px-2 py-1 rounded ${searchMode === "custom" ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}
              >
                커스텀
              </button>
            </div>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === "card" ? "카드 이름으로 검색" : "이름 검색 (비워두면 최신 일러스트)"}
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
          />

          {/* Custom illust upload pane (admin-only) — opens above the
              search results so a freshly uploaded image is immediately
              visible/usable. */}
          {searchMode === "custom" && (
            <CustomIllustUploader onUploaded={() => {
              // Jump back to page 1 so the freshly uploaded illust is visible.
              if (customPage !== 1) { setCustomPage(1); return; }
              listCustomIllusts(query.trim() || undefined, 1).then((d) => {
                setSearchResults(
                  d.results.map((r) => ({ id: r.id, card_id: "", name: r.name, image_url: r.image_url }))
                );
                setCustomTotalPages(d.total_pages);
                setCustomTotal(d.total);
              });
            }} />
          )}

          {searching && <p className="text-sm text-gray-500">검색 중...</p>}
          {searchResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {searchResults.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col items-center p-2 border rounded-lg bg-gray-50 dark:bg-gray-900 hover:border-blue-500 relative"
                >
                  <button
                    onClick={() => handleSelectCard(c)}
                    className="flex flex-col items-center w-full"
                  >
                    {c.image_url && (
                      <img src={c.image_url} alt="" className="w-20 h-20 object-cover rounded mb-1" />
                    )}
                    <span className="text-xs text-center truncate w-full">{c.name}</span>
                  </button>
                  {searchMode === "custom" && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`"${c.name}" 일러스트를 삭제할까요?`)) return;
                        try {
                          await deleteCustomIllust(c.id);
                          // Refetch the current page so it back-fills from the
                          // next page rather than leaving a hole.
                          const d = await listCustomIllusts(query.trim() || undefined, customPage);
                          setSearchResults(
                            d.results.map((r) => ({ id: r.id, card_id: "", name: r.name, image_url: r.image_url }))
                          );
                          setCustomTotalPages(d.total_pages);
                          setCustomTotal(d.total);
                          // If this was the last page and it's now empty, step back.
                          if (d.results.length === 0 && customPage > 1) setCustomPage(customPage - 1);
                        } catch (err: any) {
                          setError(err?.message || "삭제 실패");
                        }
                      }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs hover:bg-red-600 leading-none"
                      title="삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchMode === "custom" && customTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => setCustomPage((p) => Math.max(1, p - 1))}
                disabled={customPage <= 1 || searching}
                className="px-3 py-1 rounded-lg bg-blue-600 text-white disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                이전
              </button>
              <span className="text-gray-600 dark:text-gray-300">
                {customPage} / {customTotalPages}
                <span className="text-xs text-gray-500 ml-2">(전체 {customTotal}개)</span>
              </span>
              <button
                type="button"
                onClick={() => setCustomPage((p) => Math.min(customTotalPages, p + 1))}
                disabled={customPage >= customTotalPages || searching}
                className="px-3 py-1 rounded-lg bg-blue-600 text-white disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                다음
              </button>
            </div>
          )}
        </div>
      )}

      {/* Crop editor */}
      {selectedCard && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-6">
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
                  <label className="block text-xs text-gray-500 mb-1">등급</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["common", "rare", "epic", "legendary"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRarity(r)}
                        className={`py-2 rounded-lg border text-xs font-semibold transition ${
                          rarity === r
                            ? `${RARITY_BADGE[r]} border-current`
                            : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500"
                        }`}
                      >
                        {RARITY_LABEL[r]}<br />
                        <span className="text-[10px] font-normal">{RARITY_PRICE[r]}P</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="block text-xs text-gray-500 mb-1">테마 (선택)</label>
              <input
                type="text"
                list="known-themes"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="예: 푸른 눈, 마법사족, 마돌체"
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-3"
              />
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
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">저장된 아이콘 ({icons.length})</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds(new Set());
              }}
              className={`px-2 py-1 text-xs rounded border ${
                selectMode
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
              }`}
            >
              {selectMode ? "선택 종료" : "선택 모드"}
            </button>
            <div className="flex items-center gap-1">
              {[5, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setColsPerRow(n as 5 | 8)}
                  className={`px-2 py-1 text-xs rounded border ${
                    colsPerRow === n
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {n}열
                </button>
              ))}
            </div>
            {availableBorders.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">테두리</label>
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
        </div>
        <input
          type="text"
          value={savedQuery}
          onChange={(e) => setSavedQuery(e.target.value)}
          placeholder="저장된 아이콘 검색 (이름)"
          className="w-full px-3 py-2 mb-3 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
        <div className="flex flex-wrap gap-2 mb-3">
          {(["all", "default", "shop", "exclusive"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 text-xs rounded-full border ${
                categoryFilter === cat
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
              }`}
            >
              {cat === "all" ? "전체" : CATEGORY_LABEL[cat as IconCategory]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">테마</label>
            <select
              value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value)}
              className="px-2 py-1 border rounded-lg bg-white dark:bg-gray-800 text-xs"
            >
              <option value="all">전체</option>
              <option value="__none__">테마 없음</option>
              {knownThemes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">정렬</span>
            {(["category", "theme"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-2 py-1 text-xs rounded border ${
                  groupBy === g
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                }`}
              >
                {g === "category" ? "분류별" : "테마별"}
              </button>
            ))}
          </div>
        </div>
        {selectMode && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                {selectedIds.size}개 선택됨
              </span>
              <button
                onClick={handleSelectAllVisible}
                className="text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-blue-300 rounded"
              >
                보이는 것 모두 선택 ({filteredSaved.length})
              </button>
              <button
                onClick={handleClearSelection}
                disabled={selectedIds.size === 0}
                className="text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 rounded disabled:opacity-50"
              >
                선택 해제
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                list="known-themes"
                value={bulkTheme}
                onChange={(e) => setBulkTheme(e.target.value)}
                placeholder="적용할 테마 (비우면 제거)"
                className="flex-1 min-w-[140px] px-3 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              />
              <button
                onClick={handleBulkApplyTheme}
                disabled={selectedIds.size === 0 || bulkSaving}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkSaving ? "적용 중..." : "테마 일괄 적용"}
              </button>
            </div>
          </div>
        )}
        {(() => {
          if (icons.length === 0) {
            return <p className="text-sm text-gray-500">아직 등록된 아이콘이 없습니다.</p>;
          }
          if (filteredSaved.length === 0) {
            return <p className="text-sm text-gray-500">검색 결과가 없습니다.</p>;
          }

          type Group = { key: string; label: string; badge?: string; items: typeof filteredSaved };
          const groups: Group[] = [];
          if (groupBy === "category") {
            for (const cat of ["default", "shop", "exclusive"] as IconCategory[]) {
              const items = filteredSaved.filter((i) => i.category === cat);
              if (items.length > 0) groups.push({
                key: cat, label: CATEGORY_LABEL[cat], badge: CATEGORY_BADGE[cat], items,
              });
            }
          } else {
            const themeMap = new Map<string, typeof filteredSaved>();
            for (const i of filteredSaved) {
              const k = i.theme || "";
              if (!themeMap.has(k)) themeMap.set(k, []);
              themeMap.get(k)!.push(i);
            }
            const sortedKeys = [...themeMap.keys()].sort((a, b) => {
              if (a === "" && b !== "") return 1;
              if (b === "" && a !== "") return -1;
              return a.localeCompare(b);
            });
            for (const k of sortedKeys) {
              groups.push({
                key: k || "__none__",
                label: k || "테마 없음",
                badge: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
                items: themeMap.get(k)!,
              });
            }
          }

          return (
          <div className="space-y-5">
          {groups.map(({ key, label, badge, items }) => (
            <div key={key}>
              <h3 className={`text-xs font-semibold mb-2 inline-block px-2 py-0.5 rounded ${badge || ""}`}>
                {label} · {items.length}
              </h3>
              {/* auto-fill so the row wraps on narrow viewports instead of
                  forcing 600/640px-wide rows that overflow on phones. */}
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${colsPerRow === 8 ? 76 : 100}px, 1fr))` }}>
              {items.map((icon) => {
              const previewBorder = availableBorders.find((b) => b.id === previewBorderId) || null;
              const isSelected = selectedIds.has(icon.id);
              return (
                <div
                  key={icon.id}
                  onClick={selectMode ? () => toggleSelected(icon.id) : undefined}
                  className={`flex flex-col items-center text-center relative rounded-lg p-1 ${
                    selectMode ? "cursor-pointer" : ""
                  } ${isSelected ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/20" : ""}`}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(icon.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-1 left-1 w-4 h-4 z-10"
                    />
                  )}
                  <Avatar
                    icon={{
                      title: icon.title,
                      card_name: icon.card_name || "",
                      card_image_url: icon.card_image_url,
                      center_x: icon.center_x,
                      center_y: icon.center_y,
                      radius: icon.radius,
                    }}
                    border={previewBorder}
                    size={colsPerRow === 8 ? 64 : 96}
                  />
                  <span className="text-xs mt-1 truncate w-full">{icon.title || icon.card_name}</span>
                  <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${CATEGORY_BADGE[icon.category]}`}>
                    {CATEGORY_LABEL[icon.category]}
                  </span>
                  {icon.category === "shop" && icon.rarity && (
                    <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${RARITY_BADGE[icon.rarity as Exclude<IconRarity, "">]}`}>
                      {RARITY_LABEL[icon.rarity as Exclude<IconRarity, "">]} · {icon.price}P
                    </span>
                  )}
                  {icon.is_new && (
                    <span className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-red-500 text-white font-semibold">🆕 신규</span>
                  )}
                  {icon.theme && (
                    <span className="text-[10px] mt-0.5 text-gray-500 truncate w-full">#{icon.theme}</span>
                  )}
                  <div className="flex gap-2 mt-1 flex-wrap justify-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleEditIcon(icon); }}
                      disabled={selectMode}
                      className="text-[10px] text-blue-500 hover:underline disabled:opacity-40"
                    >
                      수정
                    </button>
                    {icon.category === "shop" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleNew(icon); }}
                        disabled={selectMode}
                        className={`text-[10px] hover:underline disabled:opacity-40 ${icon.is_new ? "text-orange-500" : "text-purple-500"}`}
                      >
                        {icon.is_new ? "신규 내림" : "신규 표시"}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(icon.id); }}
                      disabled={selectMode}
                      className="text-[10px] text-red-500 hover:underline disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
              </div>
            </div>
          ))}
          </div>
          );
        })()}
      </div>
    </div>
  );
}

function CustomIllustUploader({ onUploaded }: { onUploaded: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleUpload = async () => {
    if (!file) { setErr("이미지 파일을 선택하세요."); return; }
    if (!name.trim()) { setErr("이름을 입력하세요."); return; }
    setErr("");
    setBusy(true);
    try {
      await uploadCustomIllust(name.trim(), file);
      setName("");
      setFile(null);
      onUploaded();
    } catch (e: any) {
      setErr(e?.message || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  // Tweet importer (fxtwitter-backed). Pulls all photos from the given
  // tweet at native resolution (== Twitter's :orig). Multi-photo tweets
  // produce one CustomIllust per photo with a "#N" suffix.
  const [tweetUrl, setTweetUrl] = useState("");
  const [tweetName, setTweetName] = useState("");
  const [tweetBusy, setTweetBusy] = useState(false);
  const [tweetErr, setTweetErr] = useState("");
  const [tweetResult, setTweetResult] = useState<string>("");

  const handleTweetImport = async () => {
    setTweetErr("");
    setTweetResult("");
    if (!tweetUrl.trim()) { setTweetErr("트윗 URL을 입력하세요."); return; }
    setTweetBusy(true);
    try {
      const r = await importTweetIllusts(tweetUrl.trim(), tweetName.trim());
      setTweetResult(`${r.created.length}개 가져옴`);
      setTweetUrl("");
      setTweetName("");
      onUploaded();
    } catch (e: any) {
      setTweetErr(e?.message || "import 실패");
    } finally {
      setTweetBusy(false);
    }
  };

  return (
    <div className="space-y-3 mb-3">
      <div className="p-2 border border-dashed border-blue-300 dark:border-blue-700 rounded-lg bg-blue-50/50 dark:bg-blue-900/10">
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">📤 일러스트 업로드</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (예: 푸른눈백룡 SR)"
            className="flex-1 px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-sm"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-xs flex-1"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={busy || !file || !name.trim()}
            className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm rounded font-semibold disabled:opacity-50 hover:bg-blue-700"
          >
            {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>
        {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
      </div>

      <BulkUploader onDone={onUploaded} />

      <TwitterScraper onDone={onUploaded} />

      <div className="p-2 border border-dashed border-sky-300 dark:border-sky-700 rounded-lg bg-sky-50/50 dark:bg-sky-900/10">
        <p className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-2">🐦 트윗 URL → 원본 다운로드</p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
          공식 OCG 트윗 등 — 첨부된 이미지 전부를 트위터 :orig 해상도로 가져와서 등록합니다.
          이미지 여러 장이면 이름 뒤에 "#1, #2…" 가 붙어요. 이름은 카드명을 검색해 선택할 수 있어요.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={tweetUrl}
            onChange={(e) => setTweetUrl(e.target.value)}
            placeholder="https://x.com/YuGiOh_OCG_INFO/status/..."
            className="flex-1 px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-xs"
          />
          <CardNameAutocomplete
            value={tweetName}
            onChange={setTweetName}
            placeholder="이름 (카드 검색)"
            className="sm:w-56"
          />
          <button
            type="button"
            onClick={handleTweetImport}
            disabled={tweetBusy || !tweetUrl.trim()}
            className="shrink-0 px-3 py-1.5 bg-sky-600 text-white text-sm rounded font-semibold disabled:opacity-50 hover:bg-sky-700"
          >
            {tweetBusy ? "가져오는 중…" : "가져오기"}
          </button>
        </div>
        {tweetErr && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{tweetErr}</p>}
        {tweetResult && <p className="text-xs text-green-700 dark:text-green-300 mt-1">✓ {tweetResult}</p>}
      </div>
    </div>
  );
}

function TwitterScraper({ onDone }: { onDone: () => void }) {
  const [credConfigured, setCredConfigured] = useState<{
    configured: boolean; updated_at?: string; auth_token_tail?: string; ct0_tail?: string;
  } | null>(null);
  const [showCredForm, setShowCredForm] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [credErr, setCredErr] = useState("");

  // Default range: last 30 days, ending today
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [since, setSince] = useState(monthAgo);
  const [until, setUntil] = useState(today);
  const [username, setUsername] = useState("YuGiOh_OCG_INFO");
  const [scraping, setScraping] = useState(false);
  const [scrapeErr, setScrapeErr] = useState("");
  const [scrapeResult, setScrapeResult] = useState<import("@/api/cardIconApi").ScrapeResult | null>(null);

  useEffect(() => {
    getTwitterCredentials().then(setCredConfigured).catch(() => setCredConfigured({ configured: false }));
  }, []);

  const handleSaveCred = async () => {
    if (!authToken.trim() || !ct0.trim()) { setCredErr("auth_token + ct0 둘 다 필요"); return; }
    setCredErr("");
    setSavingCred(true);
    try {
      await setTwitterCredentials(authToken.trim(), ct0.trim());
      setAuthToken(""); setCt0("");
      setShowCredForm(false);
      const c = await getTwitterCredentials();
      setCredConfigured(c);
    } catch (e: any) {
      setCredErr(e?.message || "저장 실패");
    } finally {
      setSavingCred(false);
    }
  };

  const handleScrape = async () => {
    setScrapeErr("");
    setScrapeResult(null);
    setScraping(true);
    try {
      const r = await scrapeTwitterRange(since, until, username);
      setScrapeResult(r);
      onDone();
    } catch (e: any) {
      setScrapeErr(e?.message || "수집 실패");
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="p-2 border border-dashed border-purple-300 dark:border-purple-700 rounded-lg bg-purple-50/50 dark:bg-purple-900/10">
      <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-2">🤖 Twitter 자동 수집 (날짜 범위)</p>

      {/* Credentials section */}
      <div className="mb-2 pb-2 border-b border-purple-200 dark:border-purple-800/40">
        {credConfigured?.configured && !showCredForm ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-600 dark:text-gray-400 truncate">
              ✓ 쿠키 등록됨 ({credConfigured.auth_token_tail} / {credConfigured.ct0_tail}, {credConfigured.updated_at?.slice(0, 10)})
            </span>
            <button
              type="button"
              onClick={() => setShowCredForm(true)}
              className="shrink-0 text-xs text-purple-700 dark:text-purple-300 hover:underline"
            >
              변경
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              본인 Twitter 계정 쿠키 (브라우저 DevTools → Application → Cookies → x.com 에서 추출). 저장은 1회.
            </p>
            <div className="flex gap-1">
              <input
                type="text"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="auth_token"
                className="flex-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 text-xs font-mono"
              />
              <input
                type="text"
                value={ct0}
                onChange={(e) => setCt0(e.target.value)}
                placeholder="ct0"
                className="flex-1 px-2 py-1 border rounded bg-white dark:bg-gray-700 text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleSaveCred}
                disabled={savingCred}
                className="shrink-0 px-2 py-1 bg-purple-600 text-white text-xs rounded font-semibold disabled:opacity-50"
              >
                {savingCred ? "..." : "저장"}
              </button>
              {credConfigured?.configured && (
                <button
                  type="button"
                  onClick={() => setShowCredForm(false)}
                  className="shrink-0 px-2 py-1 text-xs text-gray-500"
                >
                  취소
                </button>
              )}
            </div>
            {credErr && <p className="text-xs text-red-600 dark:text-red-400">{credErr}</p>}
          </div>
        )}
      </div>

      {/* Scrape section */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <label className="text-xs text-gray-600 dark:text-gray-400 shrink-0">계정:</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="px-2 py-1 border rounded bg-white dark:bg-gray-700 text-xs font-mono w-full sm:w-44"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <label className="text-xs text-gray-600 dark:text-gray-400 shrink-0">기간:</label>
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="px-2 py-1 border rounded bg-white dark:bg-gray-700 text-xs"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="px-2 py-1 border rounded bg-white dark:bg-gray-700 text-xs"
          />
          <button
            type="button"
            onClick={handleScrape}
            disabled={scraping || !credConfigured?.configured}
            className="shrink-0 ml-auto px-3 py-1.5 bg-purple-600 text-white text-sm rounded font-semibold disabled:opacity-50 hover:bg-purple-700"
          >
            {scraping ? "수집 중…" : "🚀 수집"}
          </button>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          한 번에 최대 90일. 검색: <code>from:{username} since:{since} until:{until} filter:images</code>.
          사이즈/비율 자동 필터 적용 (1000px+, composite 또는 single).
        </p>
        {scrapeErr && <p className="text-xs text-red-600 dark:text-red-400">{scrapeErr}</p>}
        {scrapeResult && (
          <div className="text-xs space-y-0.5 pt-1 border-t border-purple-200 dark:border-purple-800/40">
            <p className="text-gray-600 dark:text-gray-400">트윗 {scrapeResult.tweets_seen}개 검색 → ✓ {scrapeResult.imported_count}장 등록</p>
            {scrapeResult.duplicates > 0 && <p className="text-gray-500">↺ {scrapeResult.duplicates}개 중복 (이미 같은 트윗 등록됨)</p>}
            {scrapeResult.skipped_count > 0 && (
              <details>
                <summary className="text-amber-700 dark:text-amber-300 cursor-pointer">⚠ {scrapeResult.skipped_count}개 필터링</summary>
                <ul className="ml-4 mt-1 text-gray-500">
                  {scrapeResult.skipped.slice(0, 20).map((s, i) => (
                    <li key={i}>tweet {s.tweet}: {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            {scrapeResult.errors > 0 && <p className="text-red-500">✗ {scrapeResult.errors}개 오류</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function BulkUploader({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<import("@/api/cardIconApi").BulkUploadResult | null>(null);
  const [err, setErr] = useState("");

  const handleUpload = async () => {
    if (files.length === 0) { setErr("파일을 선택하세요."); return; }
    setErr("");
    setBusy(true);
    setResult(null);
    try {
      const r = await bulkUploadCustomIllusts(files);
      setResult(r);
      setFiles([]);
      onDone();
    } catch (e: any) {
      setErr(e?.message || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-2 border border-dashed border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">📦 대량 업로드 (자동 필터)</p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
        여러 SAMPLE 이미지 한 번에 업로드. 비율/사이즈로 자동 필터:
        composite (1.25~1.40 비율) 또는 single (~1:1) + 1000px 이상만 통과.
        파일명이 곧 이름이 됩니다 (나중에 admin 에서 수정 가능).
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          className="text-xs flex-1"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={busy || files.length === 0}
          className="shrink-0 px-3 py-1.5 bg-amber-600 text-white text-sm rounded font-semibold disabled:opacity-50 hover:bg-amber-700"
        >
          {busy ? `업로드 중 (${files.length}장)…` : `${files.length}장 업로드`}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
      {result && (
        <div className="mt-2 text-xs space-y-0.5">
          <p className="text-green-700 dark:text-green-300">✓ {result.imported_count}개 등록</p>
          {result.duplicates > 0 && (
            <p className="text-gray-500">↺ {result.duplicates}개 중복 (이미 같은 이름 있음)</p>
          )}
          {result.skipped_count > 0 && (
            <details>
              <summary className="text-amber-700 dark:text-amber-300 cursor-pointer">⚠ {result.skipped_count}개 필터링 됨 (클릭 펼침)</summary>
              <ul className="ml-4 mt-1 text-gray-500 dark:text-gray-400">
                {result.skipped.slice(0, 20).map((s, i) => (
                  <li key={i} className="truncate">{s.name}: {s.reason}</li>
                ))}
                {result.skipped.length > 20 && <li>… 외 {result.skipped.length - 20}개</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CardNameAutocomplete({
  value, onChange, placeholder, className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 250ms debounce — keeps typing smooth on phones while still pulling
  // suggestions a beat after the admin pauses.
  useEffect(() => {
    const q = value.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchCards(q);
        setResults(data.results.slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-sm"
      />
      {open && (results.length > 0 || searching) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {searching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">검색 중…</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              {c.image_url && (
                <img src={c.image_url} alt="" className="w-8 h-8 object-cover rounded shrink-0" />
              )}
              <span className="text-sm truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
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
  let bgWidth = size, bgHeight = size, bgX = 0, bgY = 0, nudgeX = 0;
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
    const target = Math.max(0, Math.floor(size / 48));
    nudgeX = Math.min(target, Math.max(0, -bgX));
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
        backgroundPosition: `${bgX + nudgeX}px ${bgY}px`,
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
