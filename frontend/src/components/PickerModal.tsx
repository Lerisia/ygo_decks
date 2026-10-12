import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import SearchForm from "./SearchForm";

/** One picker for choosing a thing from a picture list: decks, cards, and whatever comes next.
 *  It shows the items it is given as a grid or a list (the viewer's choice, remembered per use),
 *  draws them a page at a time, and reports the one tapped. Searching stays with the caller:
 *  filter `items` as `query` changes, or pass `onSubmit` to search on Enter / the 검색 button. */

export type PickerItem = { key: string | number; name: string; image?: string | null; sub?: string };
export type PickerStatus = "idle" | "loading" | "empty" | "ready";
type View = "grid" | "small" | "list";

interface PickerPanelProps {
  onClose: () => void;
  title: string;
  hint?: string;
  placeholder: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** Search on Enter / 검색. Without it the list follows the typing and there is no 검색 button. */
  onSubmit?: (q: string) => void;
  items: PickerItem[];
  status: PickerStatus;
  idleText?: string;
  emptyText?: string;
  onPick: (item: PickerItem) => void;
  /** Remembers the viewer's view for this use (localStorage key suffix). */
  viewKey: string;
  /** Until the viewer picks one: small pictures on a phone, big ones on a wider screen (엘리스 2026-10-11). */
  defaultView?: View;
  imageFit?: "contain" | "cover";
  /** Tailwind aspect class of a grid picture (cards are taller than they are wide). */
  imageAspect?: string;
  /** The corners of a grid picture: Tailwind "rounded", or "card-corner" for a card (index.css). */
  imageCorner?: string;
  /** "inline": drawn in the page (wider grid, fixed height, no overlay); "modal": inside PickerModal. */
  variant?: "modal" | "inline";
  /** A page listing every match of the query, offered above the results (the home search, 엘리스 2026-10-11):
   *  picking one item goes straight to it, so this is the way to browse them all and come back. */
  allResults?: { to: string; count: number; unit: string };
}

interface PickerModalProps extends PickerPanelProps {
  open: boolean;
}

const PAGE = 60;
const GRID_COLS = {
  grid: { modal: "gap-2 grid-cols-3 sm:grid-cols-4", inline: "gap-2 grid-cols-5 lg:grid-cols-8" },
  small: { modal: "gap-1 grid-cols-5 sm:grid-cols-6", inline: "gap-1 grid-cols-8 lg:grid-cols-10" },
};

/** n×n little squares: the big (2) and small (3) picture views. */
function GridGlyph({ n }: { n: number }) {
  const cell = 12 / n;
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" aria-hidden="true" fill="currentColor">
      {Array.from({ length: n * n }, (_, i) => (
        <rect key={i} x={1 + (i % n) * cell} y={1 + Math.floor(i / n) * cell} width={cell - 1.5} height={cell - 1.5} rx={0.5} />
      ))}
    </svg>
  );
}
// Pictures already drawn stay in the page (hidden while filtered out), up to this many, so typing or searching again
// shows them at once instead of building and decoding each picture anew (엘리스 2026-10-06).
const KEEP_MAX = 400;

/** One-shot retry for images that occasionally come back broken (transient media-cache miss). */
function onImgErrorRetry(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.retried) return;
  img.dataset.retried = "1";
  const src = img.src || "";
  if (!src) return;
  img.src = src + (src.includes("?") ? "&" : "?") + "_retry=" + Date.now();
}

function readView(key: string, fallback: View): View {
  try {
    const v = localStorage.getItem(`picker_view_${key}`);
    return v === "grid" || v === "small" || v === "list" ? v : fallback;
  } catch {
    return fallback;
  }
}

export default function PickerModal({ open, ...panel }: PickerModalProps) {
  // Lock page scroll while the modal is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4" onClick={panel.onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl p-2 sm:p-4 w-[88vw] sm:w-full max-w-sm sm:max-w-md h-[70vh] sm:h-[min(85vh,680px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={panel.title}
      >
        <PickerPanel {...panel} variant="modal" />
      </div>
    </div>
  );
}

/** The picker itself: header, search box and results. PickerModal puts it in a dialog; a page can also draw it
 *  in place (the home page's deck search on desktop opens out like this, 특이점 2026-10-08). */
export function PickerPanel({
  onClose, title, hint, placeholder, query, onQueryChange, onSubmit, items, status,
  idleText = "이름을 입력하세요.", emptyText = "결과 없음", onPick, viewKey, defaultView, imageFit = "contain",
  imageAspect = "aspect-square", imageCorner = "rounded",
  variant = "modal", allResults,
}: PickerPanelProps) {
  const [view, setView] = useState<View>(() =>
    readView(viewKey, defaultView ?? (window.matchMedia("(max-width: 639px)").matches ? "small" : "grid")),
  );
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const keptRef = useRef(new Map<PickerItem["key"], PickerItem>());
  const inline = variant === "inline";

  // A new result set starts from the top page again.
  useEffect(() => { setVisibleCount(PAGE); }, [items]);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(`picker_view_${viewKey}`, v);
    } catch {
      /* private mode: the choice lasts while the page is open */
    }
  };
  const submit = () => {
    onSubmit?.(query);
    inputRef.current?.blur();
  };
  // Enter (the phone keyboard's 검색 key) always ends the typing and puts the keyboard away, and runs the search
  // in pickers that search on Enter; pickers that follow the typing just lose the keyboard (엘리스 2026-10-11).
  const pick = (it: PickerItem) => { onPick(it); onClose(); };
  const shown = items.slice(0, visibleCount);
  const position = new Map(shown.map((it, i) => [it.key, i]));
  const kept = keptRef.current;
  for (const it of shown) kept.set(it.key, it);
  for (const key of kept.keys()) {
    if (kept.size <= KEEP_MAX) break;
    if (!position.has(key)) kept.delete(key);
  }
  const drawn = [...kept.values()];
  const viewBtn = (v: View, label: string, glyph: React.ReactNode) => (
    <button
      type="button"
      onClick={() => chooseView(v)}
      aria-pressed={view === v}
      aria-label={label}
      title={label}
      className={`w-7 h-7 rounded text-sm leading-none flex items-center justify-center ${view === v ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
    >
      {glyph}
    </button>
  );
  const thumb = (it: PickerItem, cls: string) =>
    it.image ? (
      <img loading="lazy" src={it.image} alt="" className={`${cls} ${imageFit === "cover" ? "object-cover" : "object-contain"} ${imageCorner} bg-gray-100 dark:bg-gray-900`} onError={onImgErrorRetry} />
    ) : (
      <div className={`${cls} ${imageCorner} bg-gray-100 dark:bg-gray-900`} />
    );

  return (
    <div
      className={inline ? "flex flex-col max-h-[440px]" : "contents"}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="font-bold text-base shrink-0">{title}</h3>
            {hint && <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{hint}</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {viewBtn("grid", "큰 그림으로 보기", <GridGlyph n={2} />)}
            {viewBtn("small", "작은 그림으로 보기", <GridGlyph n={3} />)}
            {viewBtn("list", "목록으로 보기", "☰")}
            <button type="button" onClick={onClose} className="text-gray-400 text-lg px-2" aria-label="닫기">✕</button>
          </div>
        </div>
        <div className="flex gap-1.5 mb-2">
          <SearchForm onSearch={() => onSubmit?.(query)}>
            <input
              ref={inputRef}
              type="text"
              enterKeyHint="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="flex-1 min-w-0 px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-base sm:text-sm"
            />
          </SearchForm>
          {onSubmit && (
            <button
              type="button"
              onClick={submit}
              disabled={!query.trim() || status === "loading"}
              className="shrink-0 px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-semibold disabled:bg-gray-400"
            >
              검색
            </button>
          )}
        </div>
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1"
          onScroll={(e) => {
            // Reveal the next page when the viewer nears the bottom.
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) {
              setVisibleCount((c) => Math.min(c + PAGE, items.length));
            }
          }}
        >
          {status === "loading" && <p className="text-xs text-gray-400 text-center py-3">검색 중...</p>}
          {/* The same one line as 검색 중..., so the results don't jump while the next keystroke is searched. */}
          {status === "ready" && allResults && query.trim() && allResults.count > 0 && (
            <Link to={allResults.to} onClick={onClose} className="flex justify-center gap-1 text-xs py-3 font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              <span className="truncate">'{query.trim()}'</span>
              <span className="shrink-0">검색 결과 전체 보기 ({allResults.count.toLocaleString()}{allResults.unit}) →</span>
            </Link>
          )}
          {status === "idle" && <p className="text-xs text-gray-400 text-center py-3">{idleText}</p>}
          {status === "empty" && <p className="text-xs text-gray-400 text-center py-3">{emptyText}</p>}
          {view !== "list" ? (
            <div className={`grid ${GRID_COLS[view][inline ? "inline" : "modal"]}`}>
              {drawn.map((it) => (
                <button key={it.key} type="button" hidden={!position.has(it.key)} style={{ order: position.get(it.key) }} onClick={() => pick(it)} className={`self-start text-center hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition ${view === "small" ? "p-0.5" : "p-1"}`} title={it.name}>
                  {thumb(it, `w-full ${imageAspect}`)}
                  {view === "small" ? (
                    <p className="text-[10px] mt-0.5 leading-tight line-clamp-2 break-keep [overflow-wrap:anywhere]">{it.name}</p>
                  ) : (
                    <p className="text-[10px] sm:text-xs mt-0.5 break-words leading-tight">{it.name}</p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <ul className={inline ? "grid grid-cols-2 lg:grid-cols-3 gap-x-4" : "flex flex-col"}>
              {drawn.map((it) => (
                <li key={it.key} hidden={!position.has(it.key)} style={{ order: position.get(it.key) }} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700">
                  <button type="button" onClick={() => pick(it)} className="w-full flex items-center gap-3 px-1 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition">
                    {thumb(it, "w-10 h-10 shrink-0")}
                    <span className="min-w-0 flex-1 text-sm break-words">{it.name}</span>
                    {it.sub && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{it.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {visibleCount < items.length && (
            <button type="button" onClick={() => setVisibleCount((c) => Math.min(c + PAGE, items.length))} className="w-full text-xs text-blue-600 dark:text-blue-400 py-2 hover:underline">
              더 보기 ({visibleCount} / {items.length})
            </button>
          )}
        </div>
    </div>
  );
}
