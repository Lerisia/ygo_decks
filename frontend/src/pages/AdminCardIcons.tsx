import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  searchCards, listCustomIllusts, uploadCustomIllust, deleteCustomIllust, bulkUploadCustomIllusts,
  listIcons, createIcon, updateIcon, deleteIcon, setIconNew, listThemes, bulkSetTheme,
  RARITY_LABEL, RARITY_PRICE, RARITY_BADGE,
  type CardSearchResult, type CardIcon, type IconCategory, type IconRarity,
} from "@/api/cardIconApi";
import { getMyBorders, type Border } from "@/api/avatarApi";
import Avatar from "@/components/Avatar";
import SearchForm from "@/components/SearchForm";

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
const TAB_KEY = "icon_admin_tab";
const MIN_RADIUS = 0.05, MAX_RADIUS = 0.5;

const BUTTON = "inline-flex items-center justify-center rounded-lg font-semibold text-sm transition";
const PRIMARY = `${BUTTON} bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`;
const SECONDARY = `${BUTTON} bg-gray-500 hover:bg-gray-600 text-white`;
const FIELD = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-base md:text-sm";
const chip = (on: boolean) =>
  `h-9 px-3 rounded-full text-sm border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600"}`;
// a round button laid over a picture (download, delete): big enough for a thumb
const OVERLAY = "absolute w-8 h-8 p-0 rounded-full bg-black/60 text-white flex items-center justify-center text-sm leading-none border-0";

type Tab = "card" | "custom";

const rememberedTab = (): Tab => {
  try {
    return localStorage.getItem(TAB_KEY) === "custom" ? "custom" : "card";
  } catch {
    return "card";
  }
};

/** The illustration's own file, named after it, for the download link. */
const downloadName = (c: CardSearchResult) => {
  const m = /\.(webp|jpe?g|png|gif)(?:\?|$)/i.exec(c.image_url || "");
  return `${(c.name || "").replace(/[\\/:*?"<>|]/g, " ").trim() || "illust"}.${m ? m[1].toLowerCase() : "jpg"}`;
};

/** /manage/card-icons: a card's art or a custom illustration cropped to a round icon. Made for a phone as much as a
 *  desk (엘리스 2026-10-15): the picker shows tabs, a search box and a grid, with uploading folded away; the crop is
 *  dragged with one finger and sized with two; saving sits in a bar above the phone's tab bar; the saved icons fold
 *  up on a phone and open an action sheet when pressed. */
export default function AdminCardIcons() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(rememberedTab);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);
  const [selectedSourceType, setSelectedSourceType] = useState<Tab>("card");
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
  const [lastSaved, setLastSaved] = useState<CardIcon | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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
      return data.icons;
    } catch (e) {
      setError((e as Error).message || "아이콘 목록 로드 실패");
      return null;
    } finally {
      try {
        const t = await listThemes();
        setKnownThemes(t.themes);
      } catch { /* the theme list is a convenience */ }
    }
  };

  // Debounced search, paged on both tabs: cards 30 a page in name order, custom illusts 20 a page newest first.
  // An empty query pages through every custom illust; the card tab needs a character (the pool is huge).
  useEffect(() => {
    const q = query.trim();
    if (!q && tab === "card") { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        if (tab === "card") {
          const data = await searchCards(q, searchPage);
          setSearchResults(data.results);
          setSearchTotalPages(data.total_pages);
          setSearchTotal(data.total);
        } else {
          const data = await listCustomIllusts(q || undefined, searchPage);
          setSearchResults(data.results.map((r) => ({ id: r.id, card_id: "", name: r.name, image_url: r.image_url })));
          setSearchTotalPages(data.total_pages);
          setSearchTotal(data.total);
        }
      } catch (e) {
        setError((e as Error).message || "검색 실패");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, tab, searchPage]);

  useEffect(() => { setSearchPage(1); }, [query, tab]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setQuery("");
    setSearchResults([]);
    setUploadOpen(false);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* private mode */ }
  };

  const reloadCustomPage = async (page = searchPage) => {
    const d = await listCustomIllusts(query.trim() || undefined, page);
    setSearchResults(d.results.map((r) => ({ id: r.id, card_id: "", name: r.name, image_url: r.image_url })));
    setSearchTotalPages(d.total_pages);
    setSearchTotal(d.total);
    return d;
  };

  const handleSelectCard = (c: CardSearchResult) => {
    setSelectedCard(c);
    setSelectedSourceType(tab);
    setCenterX(0.5);
    setCenterY(0.5);
    setRadius(0.25);
    setTitle(c.name);
    setCategory("exclusive");
    setRarity("");
    setTheme("");
    setEditingIconId(null);
    setLastSaved(null);
    window.scrollTo({ top: 0 });
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
    setLastSaved(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeEditor = () => {
    setSelectedCard(null);
    setEditingIconId(null);
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
        radius,
        category,
        rarity: category === "shop" ? (rarity || "common") : "" as IconRarity,
        theme: theme.trim(),
      };
      let savedId = editingIconId;
      if (editingIconId) {
        await updateIcon(editingIconId, payload);
      } else {
        const sourceField = selectedSourceType === "custom" ? { custom_illust: selectedCard.id } : { card: selectedCard.id };
        const made = await createIcon({ ...sourceField, ...payload });
        savedId = made.id;
      }
      const list = await refreshIcons();
      setLastSaved(list?.find((i) => i.id === savedId) ?? null);
      closeEditor();
    } catch (e) {
      setError((e as Error).message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 아이콘을 삭제하시겠습니까?")) return;
    try {
      await deleteIcon(id);
      await refreshIcons();
      if (lastSaved?.id === id) setLastSaved(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleToggleNew = async (icon: CardIcon) => {
    const target = !icon.is_new;
    try {
      await setIconNew(icon.id, target);
      setIcons((prev) => prev.map((i) =>
        i.id === icon.id ? { ...i, is_new: target, shop_listed_at: target ? new Date().toISOString() : null } : i
      ));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const previewBorder = availableBorders.find((b) => b.id === previewBorderId) || null;

  return (
    <div className="min-h-screen px-4 pt-6 pb-28 sm:pb-6 max-w-4xl mx-auto">
      <button type="button" onClick={() => navigate("/manage")} className="mb-3 p-0 bg-transparent border-0 text-sm text-blue-600 dark:text-blue-400 hover:underline">
        ← 관리
      </button>
      <h1 className="text-2xl font-bold mb-1">카드 아이콘 관리</h1>
      <p className="text-sm text-gray-500 mb-5 break-keep">카드 일러스트나 커스텀 일러스트를 원형으로 잘라 아이콘으로 등록합니다.</p>

      <datalist id="known-themes">
        {knownThemes.map((t) => <option key={t} value={t} />)}
      </datalist>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300 break-keep">
          {error}
        </div>
      )}

      {/* Picking a picture */}
      {!selectedCard && (
        <div ref={searchBoxRef} className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow -mx-4 px-4 py-3 sm:mx-0 sm:p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-1">
              <button type="button" onClick={() => switchTab("card")} className={chip(tab === "card")}>카드</button>
              <button type="button" onClick={() => switchTab("custom")} className={chip(tab === "custom")}>커스텀</button>
            </div>
            {tab === "custom" && (
              <button type="button" onClick={() => setUploadOpen((v) => !v)} className={`${chip(uploadOpen)} ml-auto`} aria-expanded={uploadOpen}>
                {uploadOpen ? "올리기 닫기" : "＋ 올리기"}
              </button>
            )}
          </div>
          <SearchForm>
            <input
              enterKeyHint="search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "card" ? "카드 이름으로 검색" : "이름 검색 (비워 두면 최신 일러스트)"}
              className={`${FIELD} mb-3`}
            />
          </SearchForm>

          {tab === "custom" && uploadOpen && (
            <CustomIllustUploader onUploaded={() => {
              setUploadOpen(false);
              if (searchPage !== 1) { setSearchPage(1); return; }
              reloadCustomPage(1).catch(() => {});
            }} />
          )}

          {searching && <p className="text-sm text-gray-500">검색 중…</p>}
          {!searching && searchResults.length > 0 && (
            <p className="text-xs text-gray-500 mb-2">
              {searchTotal}개{searchTotalPages > 1 && ` · ${searchPage} / ${searchTotalPages}쪽`}
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {searchResults.map((c) => (
                <div key={c.id} className="relative">
                  <button
                    type="button"
                    onClick={() => handleSelectCard(c)}
                    className="block w-full p-0 bg-transparent border-0 rounded-lg overflow-hidden text-left"
                  >
                    <div className="aspect-square w-full bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
                      {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    </div>
                    <span className="block text-xs text-center truncate mt-1 text-gray-800 dark:text-gray-200">{c.name}</span>
                  </button>
                  {tab === "custom" && c.image_url && (
                    <>
                      <a
                        href={c.image_url}
                        download={downloadName(c)}
                        aria-label={`${c.name} 원본 내려받기`}
                        title="원본 내려받기"
                        className={`${OVERLAY} left-1 top-1 no-underline`}
                      >
                        ↓
                      </a>
                      <button
                        type="button"
                        aria-label={`${c.name} 삭제`}
                        title="삭제"
                        onClick={async () => {
                          if (!confirm(`"${c.name}" 일러스트를 삭제할까요?`)) return;
                          try {
                            await deleteCustomIllust(c.id);
                            const d = await reloadCustomPage();
                            if (d.results.length === 0 && searchPage > 1) setSearchPage(searchPage - 1);
                          } catch (err) {
                            setError((err as Error).message || "삭제 실패");
                          }
                        }}
                        className={`${OVERLAY} right-1 top-1 hover:bg-red-600`}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button type="button" onClick={() => setSearchPage(Math.max(1, searchPage - 1))} disabled={searchPage <= 1 || searching} className={`${PRIMARY} h-9 px-4`}>
                이전
              </button>
              <span className="text-gray-600 dark:text-gray-300">{searchPage} / {searchTotalPages}</span>
              <button type="button" onClick={() => setSearchPage(Math.min(searchTotalPages, searchPage + 1))} disabled={searchPage >= searchTotalPages || searching} className={`${PRIMARY} h-9 px-4`}>
                다음
              </button>
            </div>
          )}
        </div>
      )}

      {/* Cropping */}
      {selectedCard && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow -mx-4 px-4 py-3 sm:mx-0 sm:p-4 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-base font-semibold truncate">{editingIconId ? "수정" : "크롭"}: {selectedCard.name}</h2>
            <button type="button" onClick={closeEditor} className={`${SECONDARY} h-9 px-3 shrink-0`}>
              {editingIconId ? "취소" : "다시 고르기"}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <CropCanvas
                imageUrl={selectedCard.image_url || ""}
                centerX={centerX}
                centerY={centerY}
                radius={radius}
                onChange={(cx, cy, r) => { setCenterX(cx); setCenterY(cy); setRadius(r); }}
                onDims={setImgDims}
              />
              <label className="block mt-3 text-xs text-gray-500">
                크기: {(radius * 200).toFixed(1)}%
                <input
                  type="range"
                  min={MIN_RADIUS}
                  max={MAX_RADIUS}
                  step={0.005}
                  value={radius}
                  onChange={(e) => setRadius(parseFloat(e.target.value))}
                  className="block w-full mt-1"
                />
              </label>
              <p className="text-xs text-gray-400 mt-2 break-keep">끌어서 옮기고, 두 손가락으로 벌리거나 슬라이더로 크기를 바꿉니다.</p>

              <div className="mt-3 flex items-center gap-3">
                {[PREVIEW_SIZE, 48, 32].map((size) => (
                  <CircularPreview key={size} imageUrl={selectedCard.image_url || ""} centerX={centerX} centerY={centerY} radius={radius} size={size} crosshair={showCrosshair} />
                ))}
                <label className="flex items-center gap-2 cursor-pointer select-none ml-auto">
                  <input type="checkbox" checked={showCrosshair} onChange={(e) => setShowCrosshair(e.target.checked)} className="w-4 h-4" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">십자선</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">제목 (선택)</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="이 아이콘의 표시명" className={`${FIELD} mb-3`} />

              <label className="block text-xs text-gray-500 mb-1">분류</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as IconCategory)} className={`${FIELD} mb-3`}>
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
                        className={`py-2 px-1 rounded-lg border text-xs font-semibold transition ${
                          rarity === r ? `${RARITY_BADGE[r]} border-current` : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500"
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
              <input type="text" list="known-themes" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="예: 푸른 눈, 마법사족, 마돌체" className={`${FIELD} mb-3`} />

              <div className="hidden sm:flex gap-2">
                {selectedSourceType === "custom" && selectedCard.image_url && (
                  <a href={selectedCard.image_url} download={downloadName(selectedCard)} className={`${SECONDARY} h-10 px-4 no-underline`}>원본 내려받기</a>
                )}
                <button type="button" onClick={handleSave} disabled={saving} className={`${PRIMARY} h-10 flex-1`}>
                  {saving ? "저장 중…" : editingIconId ? "수정 저장" : "아이콘 저장"}
                </button>
              </div>
              {imgDims.w > 0 && (
                <p className="text-[10px] text-gray-400 mt-2">
                  원본 {imgDims.w}×{imgDims.h} · 중심 ({(centerX * 100).toFixed(1)}%, {(centerY * 100).toFixed(1)}%) · 반지름 {(radius * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          {/* On a phone the save sits above the site's tab bar, so no scrolling after each nudge */}
          <div
            className="sm:hidden fixed left-0 right-0 z-40 px-4 py-2 bg-white/95 dark:bg-gray-900/95 border-t border-gray-200 dark:border-gray-700 flex gap-2"
            style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <button type="button" onClick={closeEditor} className={`${SECONDARY} h-11 px-4`}>{editingIconId ? "취소" : "다시"}</button>
            {selectedSourceType === "custom" && selectedCard.image_url && (
              <a href={selectedCard.image_url} download={downloadName(selectedCard)} aria-label="원본 내려받기" className={`${SECONDARY} h-11 w-11 no-underline text-base`}>↓</a>
            )}
            <button type="button" onClick={handleSave} disabled={saving} className={`${PRIMARY} h-11 flex-1`}>
              {saving ? "저장 중…" : editingIconId ? "수정 저장" : "아이콘 저장"}
            </button>
          </div>
        </div>
      )}

      {lastSaved && !selectedCard && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <Avatar
            icon={{ title: lastSaved.title, card_name: lastSaved.card_name || "", card_image_url: lastSaved.card_image_url, center_x: lastSaved.center_x, center_y: lastSaved.center_y, radius: lastSaved.radius }}
            border={previewBorder}
            size={40}
          />
          <span className="text-sm text-green-800 dark:text-green-200 truncate flex-1">저장됨: {lastSaved.title || lastSaved.card_name}</span>
          <button type="button" onClick={() => handleEditIcon(lastSaved)} className={`${SECONDARY} h-9 px-3`}>수정</button>
        </div>
      )}

      <SavedIcons
        icons={icons}
        knownThemes={knownThemes}
        borders={availableBorders}
        previewBorderId={previewBorderId}
        onPreviewBorder={setPreviewBorderId}
        onEdit={handleEditIcon}
        onDelete={handleDelete}
        onToggleNew={handleToggleNew}
        onBulkTheme={async (ids, t) => { await bulkSetTheme(ids, t); await refreshIcons(); }}
        onError={setError}
      />
    </div>
  );
}

/** The picture with the round crop on it: one pointer pans the circle, two pointers (a pinch) size it as well.
 *  The centre is in picture fractions; the radius is a fraction of the picture's shorter side. */
function CropCanvas({ imageUrl, centerX, centerY, radius, onChange, onDims }: {
  imageUrl: string;
  centerX: number;
  centerY: number;
  radius: number;
  onChange: (cx: number, cy: number, r: number) => void;
  onDims: (d: { w: number; h: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // where the circle was and where the fingers were when the current hold began
  const hold = useRef<{ cx: number; cy: number; r: number; midX: number; midY: number; span: number } | null>(null);
  const latest = useRef({ centerX, centerY, radius });
  latest.current = { centerX, centerY, radius };

  const clampCenter = (cx: number, cy: number, r: number) => {
    if (!dims.w || !dims.h) return { cx: Math.max(0, Math.min(1, cx)), cy: Math.max(0, Math.min(1, cy)) };
    const minDim = Math.min(dims.w, dims.h);
    const minCx = (r * minDim) / dims.w, minCy = (r * minDim) / dims.h;
    return { cx: Math.max(minCx, Math.min(1 - minCx, cx)), cy: Math.max(minCy, Math.min(1 - minCy, cy)) };
  };

  // the circle stays inside the picture when the radius grows (the slider) or the picture is known
  useEffect(() => {
    const { cx, cy } = clampCenter(centerX, centerY, radius);
    if (cx !== centerX || cy !== centerY) onChange(cx, cy, radius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, dims.w, dims.h]);

  const fingers = () => {
    const pts = [...pointers.current.values()];
    const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const midY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const span = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { midX, midY, span };
  };
  const beginHold = () => {
    if (pointers.current.size === 0) { hold.current = null; return; }
    const { centerX: cx, centerY: cy, radius: r } = latest.current;
    hold.current = { cx, cy, r, ...fingers() };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginHold();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !hold.current || !containerRef.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const h = hold.current;
    const { midX, midY, span } = fingers();
    const rect = containerRef.current.getBoundingClientRect();
    const r = span > 0 && h.span > 0 ? Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, h.r * (span / h.span))) : h.r;
    const { cx, cy } = clampCenter(h.cx + (midX - h.midX) / rect.width, h.cy + (midY - h.midY) / rect.height, r);
    onChange(cx, cy, r);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    beginHold();   // the finger left behind goes on from where things are, without a jump
  };

  const minDim = Math.min(dims.w, dims.h);
  const rPercentX = dims.w ? (radius * minDim) / dims.w * 100 : 0;
  const rPercentY = dims.h ? (radius * minDim) / dims.h * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative bg-gray-200 dark:bg-gray-900 rounded-lg overflow-hidden touch-none select-none w-full mx-auto"
      style={{ maxWidth: 480, aspectRatio: dims.w && dims.h ? `${dims.w} / ${dims.h}` : "1 / 1" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {imageUrl && (
        <img
          src={imageUrl}
          onLoad={(e) => {
            const d = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
            setDims(d);
            onDims(d);
          }}
          alt=""
          className="absolute inset-0 w-full h-full pointer-events-none"
          draggable={false}
        />
      )}
      {dims.w > 0 && dims.h > 0 && (
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
      )}
    </div>
  );
}

function SavedIcons({ icons, knownThemes, borders, previewBorderId, onPreviewBorder, onEdit, onDelete, onToggleNew, onBulkTheme, onError }: {
  icons: CardIcon[];
  knownThemes: string[];
  borders: Border[];
  previewBorderId: number | null;
  onPreviewBorder: (id: number | null) => void;
  onEdit: (icon: CardIcon) => void;
  onDelete: (id: number) => void;
  onToggleNew: (icon: CardIcon) => void;
  onBulkTheme: (ids: number[], theme: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  // folded on a phone: hundreds of icons would run the page to many screens below the picker
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  const [savedQuery, setSavedQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<IconCategory | "all">("all");
  const [themeFilter, setThemeFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"category" | "theme">("theme");
  const [colsPerRow, setColsPerRow] = useState<5 | 8>(8);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTheme, setBulkTheme] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [sheetIcon, setSheetIcon] = useState<CardIcon | null>(null);

  const filtered = useMemo(() => {
    const q = savedQuery.trim().toLowerCase();
    let list = q
      ? icons.filter((i) =>
          (i.card_name || "").toLowerCase().includes(q) || (i.title || "").toLowerCase().includes(q) || (i.theme || "").toLowerCase().includes(q))
      : icons;
    if (categoryFilter !== "all") list = list.filter((i) => i.category === categoryFilter);
    if (themeFilter !== "all") list = themeFilter === "__none__" ? list.filter((i) => !i.theme) : list.filter((i) => i.theme === themeFilter);
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

  const groups = useMemo(() => {
    type Group = { key: string; label: string; badge?: string; items: CardIcon[] };
    const out: Group[] = [];
    if (groupBy === "category") {
      for (const cat of ["default", "shop", "exclusive"] as IconCategory[]) {
        const items = filtered.filter((i) => i.category === cat);
        if (items.length > 0) out.push({ key: cat, label: CATEGORY_LABEL[cat], badge: CATEGORY_BADGE[cat], items });
      }
    } else {
      const byTheme = new Map<string, CardIcon[]>();
      for (const i of filtered) {
        const k = i.theme || "";
        if (!byTheme.has(k)) byTheme.set(k, []);
        byTheme.get(k)!.push(i);
      }
      const keys = [...byTheme.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
      for (const k of keys) {
        out.push({ key: k || "__none__", label: k || "테마 없음", badge: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300", items: byTheme.get(k)! });
      }
    }
    return out;
  }, [filtered, groupBy]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyBulkTheme = async () => {
    if (selectedIds.size === 0) return;
    setBulkSaving(true);
    onError("");
    try {
      await onBulkTheme([...selectedIds], bulkTheme.trim());
      setSelectedIds(new Set());
      setBulkTheme("");
    } catch (e) {
      onError((e as Error).message || "일괄 적용 실패");
    } finally {
      setBulkSaving(false);
    }
  };

  const previewBorder = borders.find((b) => b.id === previewBorderId) || null;
  const avatarOf = (icon: CardIcon, size: number) => (
    <Avatar
      icon={{ title: icon.title, card_name: icon.card_name || "", card_image_url: icon.card_image_url, center_x: icon.center_x, center_y: icon.center_y, radius: icon.radius }}
      border={previewBorder}
      size={size}
    />
  );

  return (
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow -mx-4 px-4 py-3 sm:mx-0 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">저장된 아이콘 ({icons.length})</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className={chip(open)} aria-expanded={open}>
          {open ? "접기" : "펼치기"}
        </button>
      </div>

      {open && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
              className={chip(selectMode)}
            >
              {selectMode ? "선택 종료" : "선택 모드"}
            </button>
            {[5, 8].map((n) => (
              <button key={n} type="button" onClick={() => setColsPerRow(n as 5 | 8)} className={chip(colsPerRow === n)}>
                {n}열
              </button>
            ))}
            {borders.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-gray-500">
                프레임
                <select
                  value={previewBorderId ?? ""}
                  onChange={(e) => onPreviewBorder(e.target.value ? Number(e.target.value) : null)}
                  className="h-9 px-2 border rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200"
                >
                  <option value="">없음</option>
                  {borders.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <SearchForm>
            <input
              enterKeyHint="search"
              type="text"
              value={savedQuery}
              onChange={(e) => setSavedQuery(e.target.value)}
              placeholder="저장된 아이콘 검색 (이름·테마)"
              className={`${FIELD} mt-3 mb-3`}
            />
          </SearchForm>
          <div className="flex flex-wrap gap-2 mb-3">
            {(["all", "default", "shop", "exclusive"] as const).map((cat) => (
              <button key={cat} type="button" onClick={() => setCategoryFilter(cat)} className={chip(categoryFilter === cat)}>
                {cat === "all" ? "전체" : CATEGORY_LABEL[cat as IconCategory]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              테마
              <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)} className="h-9 px-2 border rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-200">
                <option value="all">전체</option>
                <option value="__none__">테마 없음</option>
                {knownThemes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 mr-1">정렬</span>
              {(["category", "theme"] as const).map((g) => (
                <button key={g} type="button" onClick={() => setGroupBy(g)} className={chip(groupBy === g)}>
                  {g === "category" ? "분류별" : "테마별"}
                </button>
              ))}
            </div>
          </div>
          {selectMode && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{selectedIds.size}개 선택됨</span>
                <button type="button" onClick={() => setSelectedIds(new Set(filtered.map((i) => i.id)))} className={chip(false)}>
                  보이는 것 모두 선택 ({filtered.length})
                </button>
                <button type="button" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0} className={`${chip(false)} disabled:opacity-50`}>
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
                  className={`${FIELD} flex-1 min-w-[140px]`}
                />
                <button type="button" onClick={applyBulkTheme} disabled={selectedIds.size === 0 || bulkSaving} className={`${PRIMARY} h-10 px-4`}>
                  {bulkSaving ? "적용 중…" : "테마 일괄 적용"}
                </button>
              </div>
            </div>
          )}

          {icons.length === 0 ? (
            <p className="text-sm text-gray-500">아직 등록된 아이콘이 없습니다.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500">검색 결과가 없습니다.</p>
          ) : (
            <div className="space-y-5">
              {groups.map(({ key, label, badge, items }) => (
                <div key={key}>
                  <h3 className={`text-xs font-semibold mb-2 inline-block px-2 py-0.5 rounded ${badge || ""}`}>{label} · {items.length}</h3>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${colsPerRow === 8 ? 76 : 100}px, 1fr))` }}>
                    {items.map((icon) => {
                      const isSelected = selectedIds.has(icon.id);
                      return (
                        <button
                          key={icon.id}
                          type="button"
                          onClick={() => (selectMode ? toggleSelected(icon.id) : setSheetIcon(icon))}
                          aria-pressed={selectMode ? isSelected : undefined}
                          className={`flex flex-col items-center text-center relative rounded-lg p-1 bg-transparent border-0 ${
                            isSelected ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/20" : ""
                          }`}
                        >
                          {selectMode && (
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded border ${isSelected ? "bg-blue-600 border-blue-600" : "bg-white border-gray-400"}`} aria-hidden />
                          )}
                          {avatarOf(icon, colsPerRow === 8 ? 64 : 96)}
                          <span className="text-xs mt-1 truncate w-full text-gray-800 dark:text-gray-200">{icon.title || icon.card_name}</span>
                          <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${CATEGORY_BADGE[icon.category]}`}>{CATEGORY_LABEL[icon.category]}</span>
                          {icon.category === "shop" && icon.rarity && (
                            <span className={`text-[10px] mt-0.5 px-1.5 py-0.5 rounded ${RARITY_BADGE[icon.rarity as Exclude<IconRarity, "">]}`}>
                              {RARITY_LABEL[icon.rarity as Exclude<IconRarity, "">]} · {icon.price}P
                            </span>
                          )}
                          {icon.is_new && <span className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-red-500 text-white font-semibold">신규</span>}
                          {icon.theme && <span className="text-[10px] mt-0.5 text-gray-500 truncate w-full">#{icon.theme}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* What to do with a pressed icon */}
      {sheetIcon && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={`${sheetIcon.title || sheetIcon.card_name} 작업`}>
          <button type="button" aria-label="닫기" onClick={() => setSheetIcon(null)} className="absolute inset-0 bg-black/50 border-0 p-0 rounded-none" />
          <div className="relative w-full sm:w-80 bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              {avatarOf(sheetIcon, 48)}
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{sheetIcon.title || sheetIcon.card_name}</p>
                <p className="text-xs text-gray-500 truncate">{CATEGORY_LABEL[sheetIcon.category]}{sheetIcon.theme ? ` · #${sheetIcon.theme}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => { setSheetIcon(null); onEdit(sheetIcon); }} className={`${PRIMARY} h-11`}>수정</button>
              {sheetIcon.category === "shop" && (
                <button type="button" onClick={() => { onToggleNew(sheetIcon); setSheetIcon(null); }} className={`${SECONDARY} h-11`}>
                  {sheetIcon.is_new ? "신규 내림" : "신규 표시"}
                </button>
              )}
              <button type="button" onClick={() => { setSheetIcon(null); onDelete(sheetIcon.id); }} className={`${BUTTON} h-11 bg-red-600 hover:bg-red-700 text-white`}>삭제</button>
              <button type="button" onClick={() => setSheetIcon(null)} className={`${BUTTON} h-11 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100`}>닫기</button>
            </div>
          </div>
        </div>
      )}
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
    } catch (e) {
      setErr((e as Error).message || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 mb-3">
      <div className="p-3 border border-dashed border-blue-300 dark:border-blue-700 rounded-lg bg-blue-50/50 dark:bg-blue-900/10">
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">일러스트 한 장 올리기</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
            }}
            className="text-sm flex-1"
          />
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (카드 이름)" className={`${FIELD} flex-1`} />
          <button type="button" onClick={handleUpload} disabled={busy || !file || !name.trim()} className={`${PRIMARY} h-10 px-4 shrink-0`}>
            {busy ? "올리는 중…" : "올리기"}
          </button>
        </div>
        {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
      </div>

      <BulkUploader onDone={onUploaded} />
    </div>
  );
}

function BulkUploader({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<import("@/api/cardIconApi").BulkUploadResult | null>(null);
  const [err, setErr] = useState("");

  const handleUpload = async () => {
    if (files.length === 0) { setErr("파일을 고르세요."); return; }
    setErr("");
    setBusy(true);
    setResult(null);
    try {
      const r = await bulkUploadCustomIllusts(files);
      setResult(r);
      setFiles([]);
      if (r.imported_count > 0) onDone();
    } catch (e) {
      setErr((e as Error).message || "업로드 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 border border-dashed border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">여러 장 올리기 (SAMPLE 자동 거름)</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 break-keep">
        정사각에 가깝고 1000px 이상인 그림만 들어갑니다. 파일 이름이 그대로 이름이 됩니다.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="text-sm flex-1" />
        <button type="button" onClick={handleUpload} disabled={busy || files.length === 0} className={`${BUTTON} h-10 px-4 shrink-0 bg-amber-600 hover:bg-amber-700 text-white disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed`}>
          {busy ? "올리는 중…" : `${files.length}장 올리기`}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
      {result && (
        <div className="mt-2 text-xs space-y-1">
          <p className="text-green-700 dark:text-green-300">{result.imported_count}개 등록</p>
          {result.duplicates > 0 && <p className="text-gray-500">{result.duplicates}개는 같은 이름이 이미 있어 넘김</p>}
          {result.skipped_count > 0 && (
            <details>
              <summary className="cursor-pointer text-gray-500">{result.skipped_count}개 거름</summary>
              <ul className="mt-1 text-gray-500 space-y-0.5">
                {result.skipped.map((s, i) => <li key={i}>{s.name}: {s.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CircularPreview({ imageUrl, centerX, centerY, radius, size, crosshair = false }: {
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
  let bgWidth = size, bgHeight = size, bgX = 0, bgY = 0, nudgeX = 0;
  if (dims) {
    const minDim = Math.min(dims.w, dims.h);
    const cropDiameterImg = 2 * radius * minDim;
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
        flexShrink: 0,
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
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(239, 68, 68, 0.85)", transform: "translateX(-50%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(239, 68, 68, 0.85)", transform: "translateY(-50%)", pointerEvents: "none" }} />
        </>
      )}
    </div>
  );
}
