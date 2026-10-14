import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { useAdminOnly } from "@/hooks/useAdminOnly";
import CardPickerModal from "@/components/CardPickerModal";
import {
  getBareFace, getCardLetters, getFaceAsset, getFaceLayout, type CardLetters, type LayoutResponse, type ServerFontInfo,
} from "@/api/cardLayoutApi";
import {
  ELEMENTS, changedPaths, cssFont, drawLetters, elementGuides, elementsOf, isServerFont, mergeLayout, moveElement,
  neededFonts, resolveFont, serverFamily, type ElementKey, type FaceLayout, type FontSpec, type Rgba,
} from "@/lib/cardLayout";
import { installPastedFont, removePastedFont, type PastedFont } from "@/lib/webFontPaste";

const W = 704;
const H = 1024;
const STORE = "dev_cardlayout";
const FONT_EXAMPLE = '<link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&display=swap" rel="stylesheet">';
const FRAME_NAMES: Record<string, string> = {
  normal: "일반", effect: "효과", ritual: "의식", fusion: "융합", synchro: "싱크로", xyz: "엑시즈", link: "링크",
  token: "토큰", spell: "마법", trap: "함정", normal_pendulum: "일반 펜듈럼", effect_pendulum: "효과 펜듈럼",
  ritual_pendulum: "의식 펜듈럼", fusion_pendulum: "융합 펜듈럼", synchro_pendulum: "싱크로 펜듈럼", xyz_pendulum: "엑시즈 펜듈럼",
};
const PRIMARY = "rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed";
const SECONDARY = "rounded-lg bg-gray-500 text-white font-semibold hover:bg-gray-600 transition";
const FIELD = "rounded-lg border border-gray-300 dark:border-gray-600 bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";

type Saved = { layout?: unknown; fonts?: { id: string; source: string }[]; cardId?: number; withText?: boolean };
type Pasted = PastedFont & { id: string; loading?: boolean };
type View = "letters" | "overlay" | "blink" | "diff" | "side";

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}") as Saved;
  } catch {
    return {};
  }
}

// face-assets fonts and kind icons, fetched once per visit
const serverLoads = new Map<string, Promise<void>>();
const loadedServer = new Set<string>();
function loadServerFont(info: ServerFontInfo) {
  let p = serverLoads.get(info.file);
  if (!p) {
    p = getFaceAsset(info.file)
      .then(async (buf) => {
        const weight = info.weight_range ? `${info.weight_range[0]} ${info.weight_range[1]}` : String(info.weight);
        const face = new FontFace(serverFamily(info.file), buf, { weight });
        await face.load();
        document.fonts.add(face);
        loadedServer.add(info.file);
      })
      .catch((e) => {
        serverLoads.delete(info.file);
        throw e;
      });
    serverLoads.set(info.file, p);
  }
  return p;
}
const iconLoads = new Map<string, Promise<ImageBitmap>>();
const loadIcon = (name: string) => {
  let p = iconLoads.get(name);
  if (!p) {
    p = getFaceAsset(name).then((buf) => createImageBitmap(new Blob([buf], { type: "image/png" })));
    iconLoads.set(name, p);
  }
  return p;
};

const getAt = (obj: unknown, path: (string | number)[]): unknown =>
  path.reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]), obj);
function setAt<T>(obj: T, path: (string | number)[], value: unknown): T {
  const out = structuredClone(obj);
  let o = out as unknown as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  o[path[path.length - 1]] = value;
  return out;
}
const fmtMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;
const hex = ([r, g, b]: Rgba) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** /dev/cardlayout (operators only, 참혈 2026-10-14): the card faces' letters — every piece's place, size and font
 *  — tuned in the browser over faces drawn without them, against the faces drawn today. Web fonts can be pasted in;
 *  nothing here changes the drawn faces. */
export default function DevCardLayout() {
  const admin = useAdminOnly();
  const saved = useMemo(readSaved, []);
  const [server, setServer] = useState<LayoutResponse | null>(null);
  const [layout, setLayout] = useState<FaceLayout | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pasted, setPasted] = useState<Pasted[]>([]);
  const [cardId, setCardId] = useState<number | null>(saved.cardId ?? null);
  const [letters, setLetters] = useState<CardLetters | null>(null);
  const [bare, setBare] = useState<ImageBitmap | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState("");
  const [serverFace, setServerFace] = useState<HTMLImageElement | null>(null);
  const [icons, setIcons] = useState<Map<string, ImageBitmap>>(new Map());
  const [withText, setWithText] = useState(saved.withText ?? false);
  const [view, setView] = useState<View>("letters");
  const [alpha, setAlpha] = useState(50);
  const [blinkOn, setBlinkOn] = useState(false);
  // 0 fits the screen, 1/2/4 times the 704×1024 pixels, -1 the sizes the site shows
  const [zoom, setZoom] = useState<-1 | 0 | 1 | 2 | 4>(0);
  const [guides, setGuides] = useState(true);
  const [selected, setSelected] = useState<ElementKey>("name");
  const [fontBusy, setFontBusy] = useState("");
  const [fontError, setFontError] = useState("");
  const [drawn, setDrawn] = useState(0);
  const [picker, setPicker] = useState(false);
  const faceCanvas = useMemo(() => document.createElement("canvas"), []);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const smallRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  const servers = useMemo(() => new Map((server?.fonts ?? []).map((f) => [f.file, f])), [server]);

  // the server's layout, then what this browser kept (layout, pasted fonts, card)
  useEffect(() => {
    if (!admin) return;
    getFaceLayout()
      .then((res) => {
        setServer(res);
        setLayout(saved.layout ? mergeLayout(res.layout, saved.layout) : res.layout);
        setCardId((id) => id ?? res.samples[0]?.id ?? null);
      })
      .catch((e: Error) => setLoadError(e.message));
    for (const f of saved.fonts ?? []) addFont(f.source, f.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    if (!layout) return;
    const keep: Saved = { layout, fonts: pasted.map(({ id, source }) => ({ id, source })), cardId: cardId ?? undefined, withText };
    localStorage.setItem(STORE, JSON.stringify(keep));
  }, [layout, pasted, cardId, withText]);

  useEffect(() => {
    if (!admin || cardId == null) return;
    const ac = new AbortController();
    setCardBusy(true);
    setCardError("");
    Promise.all([getCardLetters(cardId, ac.signal), getBareFace(cardId, ac.signal).then((b) => createImageBitmap(b))])
      .then(([l, b]) => {
        setLetters(l);
        setBare(b);
      })
      .catch((e: Error) => !ac.signal.aborted && setCardError(e.message))
      .finally(() => !ac.signal.aborted && setCardBusy(false));
    return () => ac.abort();
  }, [admin, cardId]);

  useEffect(() => {
    setServerFace(null);
    if (!letters?.face_url) return;
    const img = new Image();
    img.onload = () => setServerFace(img);
    img.src = letters.face_url;
  }, [letters?.face_url]);

  useEffect(() => {
    const icon = letters?.spell_trap?.icon;
    if (!icon || icons.has(icon)) return;
    loadIcon(icon).then((bm) => setIcons((m) => new Map(m).set(icon, bm))).catch(() => {});
  }, [letters, icons]);

  useEffect(() => {
    if (view !== "blink") return;
    const t = setInterval(() => setBlinkOn((on) => !on), 600);
    return () => clearInterval(t);
  }, [view]);

  // fonts first (the canvas sets nothing in a font still coming), then the face
  useEffect(() => {
    if (!layout || !letters) return;
    let alive = true;
    const list = neededFonts(layout, letters, withText);
    const missing = list.filter(({ spec, size, text }) => {
      const r = resolveFont(spec, servers);
      return r.server ? !loadedServer.has(r.server.file) : !document.fonts.check(cssFont(r, size), text || "가");
    });
    if (!missing.length) {
      setDrawn((n) => n + 1);
      return;
    }
    const big = missing.map(({ spec }) => resolveFont(spec, servers).server).filter((s): s is ServerFontInfo => !!s);
    setFontBusy(big.length ? big.map((s) => `${s.file} ${fmtMb(s.bytes)}`).join(", ") : "웹 글꼴");
    Promise.all(missing.map(({ spec, size, text }) => {
      const r = resolveFont(spec, servers);
      return r.server ? loadServerFont(r.server) : document.fonts.load(cssFont(r, size), text || "가");
    }))
      .then(() => setFontError(""))
      .catch((e: Error) => setFontError(`글꼴을 받지 못했습니다: ${e.message}`))
      .finally(() => {
        if (!alive) return;
        setFontBusy("");
        setDrawn((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [layout, letters, withText, servers, pasted]);

  const paint = useCallback(() => {
    const big = bigRef.current;
    if (!layout || !letters || !bare || !big) return;
    faceCanvas.width = W;
    faceCanvas.height = H;
    const fc = faceCanvas.getContext("2d")!;
    fc.clearRect(0, 0, W, H);
    fc.drawImage(bare, 0, 0, W, H);
    drawLetters(fc, { layout, letters, withText, servers, noLineStart: server?.no_line_start ?? "", icons });

    const ctx = big.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const showServer = view === "blink" && blinkOn;
    ctx.drawImage(showServer && serverFace ? serverFace : faceCanvas, 0, 0, W, H);
    if (serverFace && view === "overlay") {
      ctx.globalAlpha = alpha / 100;
      ctx.drawImage(serverFace, 0, 0, W, H);
      ctx.globalAlpha = 1;
    } else if (serverFace && view === "diff") {
      ctx.globalCompositeOperation = "difference";
      ctx.drawImage(serverFace, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
    if (guides) {
      const present = elementsOf(letters);
      for (const { key } of ELEMENTS) {
        if (!present.has(key)) continue;
        const on = key === selected;
        const g = elementGuides(layout, key);
        ctx.strokeStyle = on ? "rgba(37, 99, 235, 0.95)" : "rgba(236, 72, 153, 0.55)";
        ctx.lineWidth = on ? 2 : 1;
        ctx.setLineDash(on ? [] : [4, 3]);
        for (const [x0, y0, x1, y1] of g.boxes) ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
        for (const [x, y] of g.points) {
          ctx.beginPath();
          ctx.moveTo(x - 10, y + 0.5);
          ctx.lineTo(x + 10, y + 0.5);
          ctx.moveTo(x + 0.5, y - 10);
          ctx.lineTo(x + 0.5, y + 10);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    const dpr = window.devicePixelRatio || 1;
    for (const c of smallRefs.current) {
      if (!c) continue;
      const w = Math.round(c.clientWidth * dpr);
      if (!w) continue;
      c.width = w;
      c.height = Math.round((w * H) / W);
      const sc = c.getContext("2d")!;
      sc.imageSmoothingQuality = "high";
      sc.drawImage(faceCanvas, 0, 0, c.width, c.height);
    }
  }, [layout, letters, bare, withText, servers, server, icons, view, blinkOn, serverFace, alpha, guides, selected, faceCanvas]);

  // the small canvases of 실제 크기 are drawn as they appear
  useEffect(() => {
    paint();
  }, [paint, drawn, zoom]);

  const present = useMemo(() => (letters ? elementsOf(letters) : new Set<ElementKey>()), [letters]);

  const onKey = (e: KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !layout) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    setLayout(moveElement(layout, selected, d[0] * step, d[1] * step));
  };

  const onPick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * W) / rect.width;
    const y = ((e.clientY - rect.top) * H) / rect.height;
    let best: [number, ElementKey] | null = null;
    for (const { key } of ELEMENTS) {
      if (!present.has(key)) continue;
      const g = elementGuides(layout, key);
      const dists = [
        ...g.boxes.map(([x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))),
        ...g.points.map(([px, py]) => Math.hypot(px - x, py - y)),
      ];
      const dist = Math.min(...dists);
      if (dist <= 24 && (!best || dist < best[0])) best = [dist, key];
    }
    if (best) setSelected(best[1]);
    e.currentTarget.parentElement?.focus();
  };

  async function addFont(source: string, id = `f${Date.now().toString(36)}`) {
    setPasted((list) => [...list.filter((p) => p.id !== id), { id, source, families: [], loading: true }]);
    const res = await installPastedFont(id, source).catch((e: Error) => ({ source, families: [], error: e.message }));
    setPasted((list) => list.map((p) => (p.id === id ? { ...res, id } : p)));
  }
  const dropFont = (id: string) => {
    removePastedFont(id);
    setPasted((list) => list.filter((p) => p.id !== id));
  };

  if (!admin) return <div className="min-h-screen" />;
  const changed = server && layout ? new Set(changedPaths(server.layout, layout)) : new Set<string>();
  const set = (path: (string | number)[], value: unknown) => layout && setLayout(setAt(layout, path, value));
  const ctx: Ctx = { layout, defaults: server?.layout ?? null, set, servers, pasted, select: setSelected };
  const actual = zoom === -1;
  const zoomWidth = zoom > 0 ? W * zoom : undefined;
  const sideBySide = view === "side";
  // 맞춤: the whole card in sight, at the top of a phone's screen or beside a PC's controls
  const fit = "w-auto h-auto max-w-full max-h-[40svh] lg:max-h-[calc(100svh-3rem)]";
  const frame = "relative overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 max-h-[40svh] lg:max-h-[calc(100svh-2rem)]";
  const sized = zoomWidth ? { width: zoomWidth, maxWidth: "none", imageRendering: zoom >= 2 ? ("pixelated" as const) : ("auto" as const) } : undefined;

  return (
    <div className="min-h-screen w-full max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold">카드 그림 글자 배치</h1>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-keep">
        서버가 글자 없이 그린 카드 위에 브라우저가 글자를 얹습니다. 값은 이 브라우저에만 저장되고 실제 카드 그림은 바뀌지 않습니다.
        미리보기를 누르면 그 자리 요소가 골라지고, 화살표로 1px · Shift+화살표로 10px 옮깁니다.
      </p>

      {loadError ? (
        <p className="mt-6 text-sm text-red-600">{loadError}</p>
      ) : !server || !layout ? (
        <PageSkeleton />
      ) : (
        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_27rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-6">
          <div className="lg:col-start-1 lg:row-start-1">
            <CardChooser
              samples={server.samples}
              cardId={cardId}
              letters={letters}
              busy={cardBusy}
              error={cardError}
              onCard={setCardId}
              onSearch={() => setPicker(true)}
            />
          </div>
          <div className="mt-3 lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <Segmented
                value={view}
                onChange={setView}
                options={[["letters", "미리보기"], ["overlay", "겹쳐 보기"], ["blink", "깜빡이기"], ["diff", "차이"], ["side", "나란히"]]}
              />
              <Segmented value={zoom} onChange={setZoom} options={[[0, "맞춤"], [1, "1배"], [2, "2배"], [4, "4배"], [-1, "실제 크기"]]} />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} /> 효과문
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> 상자 보기
              </label>
            </div>
            {view === "overlay" && (
              <label className="mt-2 flex items-center gap-3 text-sm">
                <span className="shrink-0 text-gray-600 dark:text-gray-300">지금 서버 그림</span>
                <input type="range" min={0} max={100} value={alpha} onChange={(e) => setAlpha(+e.target.value)} className="flex-1" />
                <span className="w-12 text-right tabular-nums">{alpha}%</span>
              </label>
            )}
            <p className="mt-1 min-h-5 text-xs text-gray-500 dark:text-gray-400 break-keep">
              {!letters?.face_url && view !== "letters"
                ? "이 카드는 아직 서버 그림이 없어 비교할 수 없습니다."
                : view === "diff"
                  ? "검을수록 지금 서버 그림과 같습니다. 밝게 보이는 곳이 어긋난 곳입니다."
                  : view === "blink"
                    ? blinkOn ? "지금 서버 그림" : "조정한 미리보기"
                    : fontBusy
                      ? `글꼴 받는 중… ${fontBusy}`
                      : fontError || "\u00a0"}
            </p>
          </div>
          <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/95 dark:bg-[#0a0a0a]/95 lg:top-4 lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent lg:dark:bg-transparent lg:col-start-1 lg:row-start-3 lg:self-start">
            <div className={actual ? "hidden" : `grid gap-3 ${sideBySide ? "grid-cols-2" : ""}`}>
              <div tabIndex={0} onKeyDown={onKey} className={`${frame} focus:outline-none focus:ring-2 focus:ring-blue-500`}>
                <canvas
                  ref={bigRef}
                  width={W}
                  height={H}
                  onClick={onPick}
                  className={`block mx-auto cursor-crosshair ${sized ? "" : fit}`}
                  style={sized}
                />
                {!bare && <div className="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-800" />}
              </div>
              {sideBySide && (
                <div className={frame}>
                  {letters?.face_url ? (
                    <img src={letters.face_url} alt="지금 서버 그림" className={`block mx-auto ${sized ? "" : fit}`} style={sized} />
                  ) : (
                    <p className="p-4 text-sm text-gray-500">서버 그림 없음</p>
                  )}
                </div>
              )}
            </div>
            {actual && <SmallPreviews faceUrl={letters?.face_url ?? null} refs={smallRefs} onResize={paint} />}
          </div>

          <div className="mt-4 lg:mt-0 lg:col-start-2 lg:row-start-1 lg:row-span-3 flex flex-col gap-3">
            <FontPaste pasted={pasted} onAdd={(s) => addFont(s)} onDrop={dropFont} />
            <ElementControls ctx={ctx} selected={selected} present={present} changed={changed} />
            <ShareBox
              layout={layout}
              pasted={pasted}
              changedCount={changed.size}
              onImport={(json) => {
                const data = JSON.parse(json) as { layout?: unknown; fonts?: string[] };
                setLayout(mergeLayout(server.layout, data.layout ?? data));
                for (const source of data.fonts ?? []) if (!pasted.some((p) => p.source === source)) addFont(source);
              }}
              onReset={() => setLayout(server.layout)}
            />
          </div>
        </div>
      )}
      <CardPickerModal
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(id) => {
          setPicker(false);
          setCardId(id);
        }}
      />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_27rem] lg:gap-x-6 animate-pulse">
      <div>
        <div className="h-[4.75rem] rounded-lg bg-gray-200 dark:bg-gray-800" />
        <div className="mt-2 h-9 w-72 rounded-lg bg-gray-200 dark:bg-gray-800" />
        <div className="mt-3 h-8 rounded-lg bg-gray-200 dark:bg-gray-800" />
        <div className="mt-8 mx-auto h-[40svh] lg:h-[calc(100svh-3rem)] aspect-[704/1024] rounded-lg bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="mt-6 lg:mt-0 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-gray-200 dark:bg-gray-800" />)}
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: [T, string][];
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2.5 h-8 text-sm transition ${v === value ? "bg-blue-600 text-white" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CardChooser({ samples, cardId, letters, busy, error, onCard, onSearch }: {
  samples: LayoutResponse["samples"]; cardId: number | null; letters: CardLetters | null; busy: boolean; error: string;
  onCard: (id: number) => void; onSearch: () => void;
}) {
  const [typed, setTyped] = useState("");
  const open = () => {
    const id = Number(typed);
    if (id > 0) onCard(id);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.name}
            onClick={() => onCard(s.id)}
            className={`px-2.5 h-8 rounded-full border text-sm transition ${s.id === cardId ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && open()}
          placeholder="마듀 카드 번호"
          className={`${FIELD} h-9 w-36 px-3 text-sm`}
        />
        <button type="button" onClick={open} className={`${SECONDARY} h-9 px-3 text-sm`}>열기</button>
        <button type="button" onClick={onSearch} className={`${PRIMARY} h-9 px-3 text-sm`}>카드 찾기</button>
        <span className="min-w-0 text-sm text-gray-600 dark:text-gray-300 truncate">
          {busy ? "불러오는 중…" : error ? <span className="text-red-600">{error}</span> : letters ? `${letters.name} · ${FRAME_NAMES[letters.frame] ?? letters.frame}${letters.overframe ? " · 오버프레임" : ""}` : ""}
        </span>
      </div>
      {letters && letters.prints.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {letters.prints.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onCard(p.id)}
              className={`px-2 h-7 rounded-full border transition ${p.id === letters.id ? "bg-gray-700 border-gray-700 text-white dark:bg-gray-200 dark:text-gray-900" : "border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              {p.overframe ? "오버프레임" : p.alt ? `다른 일러스트 ${i}` : "기본 일러스트"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The face at the sizes the site shows it: a list tile, and the card page on a phone and on a PC. */
function SmallPreviews({ faceUrl, refs, onResize }: {
  faceUrl: string | null; refs: MutableRefObject<(HTMLCanvasElement | null)[]>; onResize: () => void;
}) {
  const sizes = [
    { w: 110, label: "목록" },
    { w: 156, label: "문서 · 휴대폰" },
    { w: 320, label: "문서 · PC" },
  ];
  useEffect(() => {
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onResize]);
  return (
    <div className="flex flex-wrap items-end gap-4 max-h-[40svh] overflow-auto lg:max-h-none">
      {sizes.map(({ w, label }, i) => (
        <figure key={w} className="flex flex-col items-center gap-1">
          <div className="flex gap-1.5">
            <canvas ref={(el) => { refs.current[i] = el; }} style={{ width: w, height: (w * H) / W }} className="card-corner" />
            {faceUrl && <img src={faceUrl} alt="" style={{ width: w, height: (w * H) / W }} className="card-corner opacity-95" />}
          </div>
          <figcaption className="text-xs text-gray-500 dark:text-gray-400 break-keep">
            {label} {w}px{faceUrl ? " · 왼쪽 조정, 오른쪽 지금" : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function FontPaste({ pasted, onAdd, onDrop }: { pasted: Pasted[]; onAdd: (source: string) => void; onDrop: (id: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Panel title="웹 글꼴 붙여넣기">
      <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">
        Google Fonts의 &lt;link&gt; 태그, @import url(…), @font-face CSS를 붙여넣으면 서버에 올리지 않고 바로 씁니다.
        <b className="text-red-600 dark:text-red-400"> 상업용·게임 추출 글꼴(마듀 로딘 등)은 쓰지 않습니다.</b> Noto·마루 부리처럼 무료(OFL 등) 글꼴만.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={FONT_EXAMPLE}
        className={`${FIELD} mt-2 w-full px-3 py-2 text-xs font-mono`}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={!text.trim()} onClick={() => { onAdd(text); setText(""); }} className={`${PRIMARY} h-8 px-3 text-sm`}>적용</button>
        <button type="button" onClick={() => setText(FONT_EXAMPLE)} className={`${SECONDARY} h-8 px-3 text-sm`}>예시 넣기</button>
      </div>
      {pasted.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {pasted.map((p) => (
            <li key={p.id} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-all">
                {p.loading ? "불러오는 중…" : p.error ? <span className="text-red-600">{p.error}</span> : p.families.map((f) => (
                  <span key={f.family} className="mr-2" style={{ fontFamily: JSON.stringify(f.family) }}>
                    {f.family}
                    <span className="ml-1 text-xs text-gray-500">{f.weights.join("·")}</span>
                  </span>
                ))}
              </span>
              <button type="button" onClick={() => onDrop(p.id)} className="shrink-0 text-xs text-gray-500 underline">빼기</button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ShareBox({ layout, pasted, changedCount, onImport, onReset }: {
  layout: FaceLayout; pasted: Pasted[]; changedCount: number; onImport: (json: string) => void; onReset: () => void;
}) {
  const [mode, setMode] = useState<"" | "export" | "import">("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const exported = JSON.stringify({ version: 1, layout, fonts: pasted.map((p) => p.source) }, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setNote("복사했습니다.");
    } catch {
      setNote("복사하지 못했습니다. 칸에서 직접 복사하세요.");
    }
  };
  return (
    <Panel title="설정 공유">
      <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">
        지금 기본값과 다른 값 {changedCount}개. 내보낸 JSON의 layout은 서버의 face_layout.json과 같은 모양입니다.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setMode(mode === "export" ? "" : "export"); setNote(""); }} className={`${PRIMARY} h-8 px-3 text-sm`}>내보내기</button>
        <button type="button" onClick={() => { setMode(mode === "import" ? "" : "import"); setNote(""); }} className={`${SECONDARY} h-8 px-3 text-sm`}>가져오기</button>
        <button
          type="button"
          onClick={() => window.confirm("모든 요소를 지금 서버 그림의 값으로 되돌릴까요?") && onReset()}
          className={`${SECONDARY} h-8 px-3 text-sm`}
        >
          기본값으로
        </button>
      </div>
      {mode === "export" && (
        <>
          <textarea readOnly value={exported} rows={8} className={`${FIELD} mt-2 w-full px-3 py-2 text-xs font-mono`} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copy} className={`${PRIMARY} mt-2 h-8 px-3 text-sm`}>복사</button>
        </>
      )}
      {mode === "import" && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder='{"version": 1, "layout": {…}, "fonts": […]}'
                    className={`${FIELD} mt-2 w-full px-3 py-2 text-xs font-mono`} />
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => {
              try {
                onImport(text);
                setNote("가져왔습니다.");
                setText("");
              } catch {
                setNote("JSON을 읽지 못했습니다.");
              }
            }}
            className={`${PRIMARY} mt-2 h-8 px-3 text-sm`}
          >
            적용
          </button>
        </>
      )}
      {note && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{note}</p>}
    </Panel>
  );
}

function Panel({ title, children, active, onTitle, aside }: {
  title: string; children: ReactNode; active?: boolean; onTitle?: () => void; aside?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-3 ${active ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200 dark:border-gray-700"}`}>
      <div className="flex items-center gap-2">
        {onTitle ? (
          <button type="button" onClick={onTitle} className="text-sm font-bold text-left">{title}</button>
        ) : (
          <h2 className="text-sm font-bold">{title}</h2>
        )}
        <span className="ml-auto flex items-center gap-2">{aside}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

type Ctx = {
  layout: FaceLayout | null;
  defaults: FaceLayout | null;
  set: (path: (string | number)[], value: unknown) => void;
  servers: Map<string, ServerFontInfo>;
  pasted: Pasted[];
  select: (key: ElementKey) => void;
};

/** A number with its slider: arrows step 1 (Shift 10); a dot marks a value off the server's. */
function Num({ ctx, path, label, min, max, step = 1, isNew, hint, fallback = 0 }: {
  ctx: Ctx; path: (string | number)[]; label: string; min: number; max: number; step?: number; isNew?: boolean; hint?: string;
  /** What a page-only value is when it isn't set: what face.py does. */
  fallback?: number;
}) {
  const base = Number(getAt(ctx.defaults, path) ?? fallback);
  const value = Number(getAt(ctx.layout, path) ?? base);
  const off = value !== base;
  const put = (v: number) => ctx.set(path, +(Math.round(v / step) * step).toFixed(4));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    put(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
  };
  return (
    <label className="flex items-center gap-2 text-sm" title={hint}>
      <span className="w-[7.5rem] shrink-0 flex items-center gap-1 text-gray-600 dark:text-gray-300 break-keep leading-tight">
        <span className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${off ? "bg-blue-600" : "bg-transparent"}`} />
        {label}
        {isNew && <NewMark />}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => put(+e.target.value)} className="min-w-0 flex-1" />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => e.target.value !== "" && put(+e.target.value)}
        onKeyDown={onKey}
        className={`${FIELD} h-8 w-[4.5rem] px-2 text-right tabular-nums text-sm`}
      />
    </label>
  );
}

const NewMark = () => (
  <span title="face.py가 아직 읽지 않는 값: 실제 그림에 쓰려면 서버 코드도 바꿔야 합니다." className="px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 text-[10px] leading-4">새</span>
);

function BoxFields({ ctx, path, label }: { ctx: Ctx; path: (string | number)[]; label: string }) {
  const names = ["왼쪽 x", "위 y", "오른쪽 x", "아래 y"];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
      {names.map((n, i) => (
        <Num key={n} ctx={ctx} path={[...path, i]} label={n} min={-50} max={i % 2 ? H + 50 : W + 50} />
      ))}
    </div>
  );
}

function ColorField({ ctx, path, label }: { ctx: Ctx; path: (string | number)[]; label: string }) {
  const value = (getAt(ctx.layout, path) as Rgba) ?? [0, 0, 0, 255];
  const off = JSON.stringify(getAt(ctx.defaults, path)) !== JSON.stringify(value);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-[7.5rem] shrink-0 flex items-center gap-1 text-gray-600 dark:text-gray-300 break-keep">
        <span className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${off ? "bg-blue-600" : "bg-transparent"}`} />
        {label}
      </span>
      <input
        type="color"
        value={hex(value)}
        onChange={(e) => {
          const v = e.target.value;
          ctx.set(path, [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), value[3]]);
        }}
        className="h-8 w-12 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent"
      />
      <span className="text-xs text-gray-500">불투명</span>
      <input
        type="number"
        min={0}
        max={255}
        value={value[3]}
        onChange={(e) => ctx.set(path, [value[0], value[1], value[2], Math.max(0, Math.min(255, +e.target.value))])}
        className={`${FIELD} h-8 w-16 px-2 text-right tabular-nums text-sm`}
      />
    </div>
  );
}

/** A face-assets font (its file, a variable one at a named weight) or a pasted web font with its weight. */
function FontField({ ctx, path, label }: { ctx: Ctx; path: (string | number)[]; label: string }) {
  const spec = getAt(ctx.layout, path) as FontSpec;
  const off = JSON.stringify(getAt(ctx.defaults, path)) !== JSON.stringify(spec);
  const options: { key: string; label: string; weights: [number, string][]; make: (w: number) => FontSpec }[] = [];
  for (const f of ctx.servers.values()) {
    const named = Object.entries(f.instances);
    options.push({
      key: `file:${f.file}`,
      label: `${f.file.replace(/\.(otf|ttf)$/i, "")} · 서버`,
      weights: named.length ? named.map(([n, w]) => [w, n]) : [[f.weight, f.style]],
      make: (w) => ({ file: f.file, variation: named.length ? named.find(([, v]) => v === w)?.[0] ?? null : null }),
    });
  }
  for (const p of ctx.pasted) {
    for (const f of p.families) {
      const steps = f.ranges.flatMap(([lo, hi]) => [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= lo && w <= hi));
      const all = [...new Set([...f.weights, ...steps])].sort((a, b) => a - b);
      if (!all.length) all.push(400, 700);
      options.push({ key: `web:${f.family}`, label: `${f.family} · 웹`, weights: all.map((w) => [w, String(w)]), make: (w) => ({ family: f.family, weight: w }) });
    }
  }
  const key = isServerFont(spec) ? `file:${spec.file}` : `web:${spec.family}`;
  const current = options.find((o) => o.key === key);
  const weight = resolveFont(spec, ctx.servers).weight;
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="w-full sm:w-[7.5rem] shrink-0 flex items-center gap-1 text-gray-600 dark:text-gray-300 break-keep">
        <span className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${off ? "bg-blue-600" : "bg-transparent"}`} />
        {label}
      </span>
      <select
        value={current ? key : ""}
        onChange={(e) => {
          const o = options.find((x) => x.key === e.target.value);
          if (!o) return;
          const w = o.weights.find(([v]) => v === weight)?.[0] ?? o.weights[o.weights.length - 1][0];
          ctx.set(path, o.make(w));
        }}
        className={`${FIELD} h-8 min-w-0 flex-1 px-2 text-sm`}
      >
        {!current && <option value="">{isServerFont(spec) ? spec.file : `${spec.family} (붙여넣은 글꼴 없음)`}</option>}
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <select
        value={weight}
        disabled={!current || current.weights.length < 2}
        onChange={(e) => current && ctx.set(path, current.make(+e.target.value))}
        className={`${FIELD} h-8 w-24 px-1 text-sm disabled:opacity-60`}
      >
        {(current?.weights ?? [[weight, String(weight)]]).map(([w, n]) => <option key={w} value={w}>{n}</option>)}
      </select>
    </div>
  );
}

function ElementControls({ ctx, selected, present, changed }: {
  ctx: Ctx; selected: ElementKey; present: Set<ElementKey>; changed: Set<string>;
}) {
  const L = ctx.layout!;
  const reset = (key: keyof FaceLayout) => ctx.defaults && ctx.set([key], structuredClone(ctx.defaults[key]));
  const section = (key: keyof FaceLayout, title: string, picks: ElementKey[], body: ReactNode) => {
    const n = [...changed].filter((p) => p === key || p.startsWith(`${key}.`)).length;
    const here = picks.some((p) => present.has(p));
    return (
      <Panel
        key={key}
        title={title}
        active={picks.includes(selected)}
        onTitle={() => ctx.select(picks[0])}
        aside={
          <>
            {!here && <span className="text-xs text-gray-400">이 카드에는 없음</span>}
            {n > 0 && (
              <button type="button" onClick={() => reset(key)} className="text-xs text-blue-600 dark:text-blue-400 underline">
                기본값 ({n})
              </button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-1.5">{body}</div>
      </Panel>
    );
  };
  const offsets = L.name.shadow_offsets.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <>
      {section("name", "카드 이름", ["name"], (
        <>
          <BoxFields ctx={ctx} path={["name", "box"]} label="상자 (글자는 세로 가운데)" />
          <FontField ctx={ctx} path={["name", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["name", "size"]} label="크기" min={8} max={96} />
          <Num ctx={ctx} path={["name", "min_size"]} label="최소 크기" min={8} max={96} isNew fallback={L.name.size} hint="넘치면 이 크기까지 줄인 뒤 누릅니다." />
          <Num ctx={ctx} path={["name", "letter_spacing"]} label="자간" min={-10} max={20} step={0.5} isNew />
          <Num ctx={ctx} path={["name", "pad"]} label="좌우 여백" min={0} max={30} />
          <label className="flex items-center gap-2 text-sm">
            <span className="w-[7.5rem] shrink-0 flex items-center gap-1 text-gray-600 dark:text-gray-300">
              <span className="inline-block w-1.5 h-1.5" />정렬 <NewMark />
            </span>
            <select value={L.name.align ?? "left"} onChange={(e) => ctx.set(["name", "align"], e.target.value)} className={`${FIELD} h-8 px-2 text-sm`}>
              <option value="left">왼쪽</option>
              <option value="center">가운데</option>
              <option value="right">오른쪽</option>
            </select>
            <label className="ml-2 flex items-center gap-1.5">
              <input type="checkbox" checked={L.name.squeeze ?? true} onChange={(e) => ctx.set(["name", "squeeze"], e.target.checked)} />
              넘치면 누르기 <NewMark />
            </label>
          </label>
          <ColorField ctx={ctx} path={["name", "color"]} label="글자 색" />
          <ColorField ctx={ctx} path={["name", "light_color"]} label="흰 글씨 색" />
          <div className="text-sm">
            <span className="text-xs text-gray-500 dark:text-gray-400">흰 글씨 프레임 (오버프레임은 늘 흰 글씨)</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(FRAME_NAMES).map(([frame, name]) => {
                const on = L.name.light_frames.includes(frame);
                return (
                  <button
                    key={frame}
                    type="button"
                    onClick={() => ctx.set(["name", "light_frames"], on ? L.name.light_frames.filter((f) => f !== frame) : [...L.name.light_frames, frame])}
                    className={`px-2 h-7 rounded-full border text-xs transition ${on ? "bg-gray-700 border-gray-700 text-white dark:bg-gray-200 dark:text-gray-900" : "border-gray-300 dark:border-gray-600"}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <ColorField ctx={ctx} path={["name", "shadow_color"]} label="그림자 색" />
          <label className="flex items-center gap-2 text-sm">
            <span className="w-[7.5rem] shrink-0 pl-2.5 text-gray-600 dark:text-gray-300 break-keep">그림자 자리 (x,y)</span>
            <input
              key={offsets}
              defaultValue={offsets}
              onBlur={(e) => {
                const pairs = e.target.value.trim().split(/\s+/).map((p) => p.split(",").map(Number));
                if (pairs.every((p) => p.length === 2 && p.every(Number.isFinite))) ctx.set(["name", "shadow_offsets"], pairs);
              }}
              className={`${FIELD} h-8 min-w-0 flex-1 px-2 text-sm font-mono`}
            />
          </label>
          {L.name.fallbacks.map((_, i) => (
            <FontField key={i} ctx={ctx} path={["name", "fallbacks", i]} label={`대체 글꼴 ${i + 1}`} />
          ))}
        </>
      ))}
      {section("spell_trap_line", "【마법 카드】 줄", ["spell_trap_line"], (
        <>
          <BoxFields ctx={ctx} path={["spell_trap_line", "box"]} label="상자 (오른쪽 끝 맞춤, 세로 가운데)" />
          <FontField ctx={ctx} path={["spell_trap_line", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["spell_trap_line", "size"]} label="크기" min={8} max={80} />
          <Num ctx={ctx} path={["spell_trap_line", "letter_spacing"]} label="자간" min={-10} max={20} step={0.5} isNew />
          <ColorField ctx={ctx} path={["spell_trap_line", "color"]} label="글자 색" />
          <Num ctx={ctx} path={["spell_trap_line", "icon_size"]} label="아이콘 크기" min={8} max={80} />
          <Num ctx={ctx} path={["spell_trap_line", "icon_dx"]} label="아이콘 앞 간격" min={-20} max={40} />
          <Num ctx={ctx} path={["spell_trap_line", "icon_advance"]} label="아이콘 자리 폭" min={0} max={100} />
        </>
      ))}
      {section("type_line", "【종족／…】 줄", ["type_line"], (
        <>
          <Num ctx={ctx} path={["type_line", "x"]} label="왼쪽 x" min={0} max={W} />
          <Num ctx={ctx} path={["type_line", "y"]} label="글자 윗선 y" min={0} max={H} hint="PIL anchor la: 글꼴의 ascender 선" />
          <FontField ctx={ctx} path={["type_line", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["type_line", "size"]} label="크기" min={8} max={60} />
          <Num ctx={ctx} path={["type_line", "letter_spacing"]} label="자간" min={-10} max={20} step={0.5} isNew />
          <ColorField ctx={ctx} path={["type_line", "color"]} label="글자 색" />
        </>
      ))}
      {section("stats", "ATK/DEF · LINK", ["stats", "stats_rule"], (
        <>
          <Num ctx={ctx} path={["stats", "right"]} label="오른쪽 x" min={0} max={W} />
          <Num ctx={ctx} path={["stats", "baseline"]} label="기준선 y" min={0} max={H} />
          <FontField ctx={ctx} path={["stats", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["stats", "size"]} label="크기" min={8} max={60} />
          <Num ctx={ctx} path={["stats", "letter_spacing"]} label="자간" min={-10} max={20} step={0.5} isNew />
          <ColorField ctx={ctx} path={["stats", "color"]} label="글자 색" />
          <Num ctx={ctx} path={["stats", "number_gap"]} label="숫자 칸 뒤 간격" min={-20} max={60} />
          <Num ctx={ctx} path={["stats", "label_gap"]} label="항목 사이 간격" min={-20} max={100} />
          <label className="flex items-center gap-2 text-sm">
            <span className="w-[7.5rem] shrink-0 pl-2.5 text-gray-600 dark:text-gray-300 break-keep">숫자 칸 (이 글자 폭)</span>
            <input value={L.stats.slot} onChange={(e) => ctx.set(["stats", "slot"], e.target.value)} className={`${FIELD} h-8 w-24 px-2 text-sm font-mono`} />
          </label>
          <span className="mt-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <button type="button" onClick={() => ctx.select("stats_rule")} className="underline">위 선</button>
          </span>
          <Num ctx={ctx} path={["stats", "rule", "x0"]} label="왼쪽 x" min={0} max={W} />
          <Num ctx={ctx} path={["stats", "rule", "x1"]} label="오른쪽 x" min={0} max={W} />
          <Num ctx={ctx} path={["stats", "rule", "y"]} label="y" min={0} max={H} />
          <Num ctx={ctx} path={["stats", "rule", "width"]} label="굵기" min={0} max={10} />
          <ColorField ctx={ctx} path={["stats", "rule", "color"]} label="선 색" />
        </>
      ))}
      {section("pendulum_scale", "펜듈럼 스케일", ["pendulum_scale"], (
        <>
          <Num ctx={ctx} path={["pendulum_scale", "x", 0]} label="왼쪽 가운데 x" min={0} max={W} />
          <Num ctx={ctx} path={["pendulum_scale", "x", 1]} label="오른쪽 가운데 x" min={0} max={W} />
          <Num ctx={ctx} path={["pendulum_scale", "y"]} label="가운데 y" min={0} max={H} />
          <FontField ctx={ctx} path={["pendulum_scale", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["pendulum_scale", "size"]} label="크기" min={8} max={90} />
          <Num ctx={ctx} path={["pendulum_scale", "letter_spacing"]} label="자간" min={-10} max={20} step={0.5} isNew />
          <ColorField ctx={ctx} path={["pendulum_scale", "color"]} label="글자 색" />
        </>
      ))}
      {section("effect", "효과문", ["effect", "effect_spell_trap"], (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 break-keep">사이트 카드 그림에서는 비워 둡니다(엘리스 10/11). 위 「효과문」을 켜면 보입니다.</p>
          <BoxFields ctx={ctx} path={["effect", "box"]} label="몬스터 상자" />
          <BoxFields ctx={ctx} path={["effect", "spell_trap_box"]} label="마법·함정 상자" />
          <FontField ctx={ctx} path={["effect", "font"]} label="글꼴" />
          <FontField ctx={ctx} path={["effect", "normal_font"]} label="일반 몬스터 글꼴" />
          <Num ctx={ctx} path={["effect", "max_size"]} label="최대 크기" min={6} max={60} />
          <Num ctx={ctx} path={["effect", "min_size"]} label="최소 크기" min={6} max={60} />
          <Num ctx={ctx} path={["effect", "line_spacing"]} label="줄 간격 (배)" min={0.8} max={2.5} step={0.01} />
          <Num ctx={ctx} path={["effect", "letter_spacing"]} label="자간" min={-5} max={10} step={0.5} isNew />
          <ColorField ctx={ctx} path={["effect", "color"]} label="글자 색" />
        </>
      ))}
      {section("pendulum_effect", "펜듈럼 효과문", ["pendulum_effect"], (
        <>
          <BoxFields ctx={ctx} path={["pendulum_effect", "box"]} label="상자" />
          <FontField ctx={ctx} path={["pendulum_effect", "font"]} label="글꼴" />
          <Num ctx={ctx} path={["pendulum_effect", "max_size"]} label="최대 크기" min={6} max={60} />
          <Num ctx={ctx} path={["pendulum_effect", "min_size"]} label="최소 크기" min={6} max={60} />
          <Num ctx={ctx} path={["pendulum_effect", "line_spacing"]} label="줄 간격 (배)" min={0.8} max={2.5} step={0.01} />
          <Num ctx={ctx} path={["pendulum_effect", "letter_spacing"]} label="자간" min={-5} max={10} step={0.5} isNew />
          <ColorField ctx={ctx} path={["pendulum_effect", "color"]} label="글자 색" />
        </>
      ))}
    </>
  );
}
