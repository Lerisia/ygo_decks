import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import Avatar from "@/components/Avatar";
import type { PublicCardIcon, Border } from "@/api/avatarApi";

// === Event types from server ===
export type DmChoosingEvent = {
  drawer_id: string;
  drawer_name: string;
  deadline: number;
  seconds_remaining?: number;
  round: number;
  total_rounds: number;
  turn_index: number;
};
export type DmWordChoicesEvent = {
  choices: { card_id: number | string; name: string; image_url?: string | null }[];
  deadline: number;
  seconds_remaining?: number;
};
export type DmDrawingEvent = {
  drawer_id: string;
  deadline: number;
  duration: number;
  seconds_remaining?: number;
  hint: string;
  word_length: number;
  round: number;
  total_rounds: number;
  turn_index: number;
};
export type DmStrokePayload = {
  op: "start" | "move" | "end" | "fill";
  x: number;  // 0..1
  y: number;  // 0..1
  color?: string;
  size?: number;
  tool?: "pen" | "eraser" | "fill";
};
export type DmChatEvent = {
  player_id: string;
  display_name: string;
  kind: "correct" | "wrong";
  text: string;
  delta?: number;
  total_score?: number;
};
export type DmTurnReveal = {
  word: string;
  drawer_id: string;
  scores: Record<string, number>;
  correct_guessers: Record<string, { score: number; order: number }>;
  drawer_bonus: number;
  image_url?: string | null;
};
export type DmGameEnd = {
  ranked: {
    player: {
      id: number;
      display_name: string;
      avatar_icon: PublicCardIcon | null;
      border: Border | null;
    };
    score: number;
    points_awarded: number;
  }[];
};

export type DmPlayerLite = {
  id: number;
  display_name: string;
  is_host: boolean;
  is_spectator?: boolean;
  avatar_icon: PublicCardIcon | null;
  border: Border | null;
};

interface Props {
  // Game state
  choosing: DmChoosingEvent | null;
  myWordChoices: DmWordChoicesEvent | null;
  drawing: DmDrawingEvent | null;
  drawerWord: string | null;  // only set if I am the drawer
  drawerImageUrl: string | null;  // card illustration, drawer-only
  hint: string;
  reveal: DmTurnReveal | null;
  finalResult: DmGameEnd | null;
  chatLog: DmChatEvent[];
  liveScores: Record<string, number>;
  correctGuesserIds: Set<string>;  // who has guessed this turn
  givenUpIds: Set<string>;  // who has given up this turn

  // Identity
  players: DmPlayerLite[];
  selfDisplayName: string;
  // Player_id-based identity. Required for anonymous rooms where the server
  // sends "플레이어N" as display_name and the user's real nickname does NOT
  // match — falling back to display_name match would break amDrawer detection
  // (and therefore drawing handlers, the reference image, chat dedup, etc).
  selfPlayerId: number | null;

  // Actions
  onChooseWord: (cardId: number | string, name: string) => void;
  onStroke: (payload: DmStrokePayload) => void;
  onClear: () => void;
  onUndo: () => void;
  onGiveUp: () => void;
  onChat: (text: string) => void;

  // Replay strokes from server (sent on reconnect / undo)
  replayStrokes?: DmStrokePayload[];

  // Spectator mode
  amSpectator?: boolean;
  chatLockedExternal?: boolean;
  // Spectator-only: jump into the game mid-round.
  onJoinGame?: () => void;

  // Increments when server sends `dm_close_hint` for this user. The optimistic
  // pending-chat for the close attempt should be dropped (server intentionally
  // doesn't broadcast close attempts to prevent answer-sniping).
  closeHintTick?: number;
}

const COLORS = [
  "#000000", "#666666", "#999999", "#cccccc", "#ffffff",
  "#7c1818", "#cc1f1f", "#ff7f00", "#ffd92e", "#16a34a",
  "#1f7eff", "#1e3a8a", "#7e22ce", "#ec4899", "#9b3a8a", "#7a4a1c",
  "#fcd0a1",
];
const BRUSH_SIZES = [2, 4, 8, 16];

// Lazy-init shared AudioContext (browsers require user-gesture before first play).
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
    catch { return null; }
  }
  return _audioCtx;
}
function playTone(freq: number, durationMs: number, type: OscillatorType = "sine", vol = 0.05) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = type;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
}
function playArpeggio(freqs: number[], stepMs: number, type: OscillatorType = "sine", vol = 0.05) {
  freqs.forEach((f, i) => setTimeout(() => playTone(f, stepMs * 1.5, type, vol), i * stepMs));
}

/** Capture a client-local deadline whenever the server-supplied event changes.
 *  Falls back to server's `deadline` only if `seconds_remaining` isn't set
 *  (older payloads). Resilient to client/server clock skew. */
function useLocalDeadline<T extends { deadline?: number; seconds_remaining?: number } | null>(
  ev: T,
  // identity key so we recompute only when the relevant turn changes
  identity: string | number | null,
): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const lastIdRef = useRef<string | number | null>(null);
  useEffect(() => {
    if (!ev || identity == null) {
      setDeadline(null);
      lastIdRef.current = null;
      return;
    }
    if (lastIdRef.current === identity) return;
    lastIdRef.current = identity;
    if (typeof ev.seconds_remaining === "number") {
      setDeadline(Date.now() / 1000 + Math.max(0, ev.seconds_remaining));
    } else if (typeof ev.deadline === "number") {
      setDeadline(ev.deadline);
    }
  }, [ev, identity]);
  return deadline;
}

function useChoosingLocalDeadline(choosing: DmChoosingEvent | null) {
  return useLocalDeadline(
    choosing,
    choosing ? `${choosing.round}-${choosing.turn_index}-${choosing.drawer_id}` : null,
  );
}

function useDrawingLocalDeadline(drawing: DmDrawingEvent | null) {
  return useLocalDeadline(
    drawing,
    drawing ? `${drawing.round}-${drawing.turn_index}-${drawing.drawer_id}` : null,
  );
}

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b, 255];
}

/** Iterative flood fill (BFS using a stack, scanline-ish) */
function floodFill(ctx: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number, hexColor: string) {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const startIdx = idx(sx, sy);
  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
  const [tr, tg, tb, ta] = hexToRgba(hexColor);
  if (sr === tr && sg === tg && sb === tb && sa === ta) return;

  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    // Find leftmost matching pixel on this row
    let lx = x;
    while (lx >= 0) {
      const i = idx(lx, y);
      if (data[i] !== sr || data[i + 1] !== sg || data[i + 2] !== sb || data[i + 3] !== sa) break;
      lx--;
    }
    lx++;
    let spanAbove = false;
    let spanBelow = false;
    let cx = lx;
    while (cx < w) {
      const i = idx(cx, y);
      if (data[i] !== sr || data[i + 1] !== sg || data[i + 2] !== sb || data[i + 3] !== sa) break;
      data[i] = tr; data[i + 1] = tg; data[i + 2] = tb; data[i + 3] = ta;
      if (y > 0) {
        const i2 = idx(cx, y - 1);
        const match = data[i2] === sr && data[i2 + 1] === sg && data[i2 + 2] === sb && data[i2 + 3] === sa;
        if (!spanAbove && match) { stack.push(cx, y - 1); spanAbove = true; }
        else if (spanAbove && !match) spanAbove = false;
      }
      if (y < h - 1) {
        const i2 = idx(cx, y + 1);
        const match = data[i2] === sr && data[i2 + 1] === sg && data[i2 + 2] === sb && data[i2 + 3] === sa;
        if (!spanBelow && match) { stack.push(cx, y + 1); spanBelow = true; }
        else if (spanBelow && !match) spanBelow = false;
      }
      cx++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export default function DuchMindGameView({
  choosing, myWordChoices, drawing, drawerWord, drawerImageUrl, hint,
  reveal, finalResult, chatLog, liveScores, correctGuesserIds, givenUpIds,
  players, selfDisplayName, selfPlayerId,
  onChooseWord, onStroke, onClear, onUndo, onGiveUp, onChat,
  replayStrokes,
  amSpectator, chatLockedExternal, closeHintTick, onJoinGame,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeBufRef = useRef<DmStrokePayload[]>([]);  // local stroke history for re-render
  const drawingActiveRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 600 });

  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(4);
  const [tool, setTool] = useState<"pen" | "eraser" | "fill">("pen");
  const [chatInput, setChatInput] = useState("");
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem("dm_muted") === "1");

  // One-tap canvas capture → instant download. No preview, no dialog —
  // moments pass fast and users want to grab the screenshot in the moment.
  // Captures the whole canvas container, so the drawer's reference-image
  // overlay (top-left) and the reveal panel are included if visible.
  const handleCaptureCanvas = useCallback(async () => {
    const node = containerRef.current;
    if (!node) return;
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `duchmind-${ts}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Fallback to canvas-only capture if html-to-image fails
      const cv = canvasRef.current;
      if (!cv) return;
      cv.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `duchmind-${ts}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    }
  }, []);
  const playIfNotMuted = useCallback((fn: () => void) => { if (!muted) fn(); }, [muted]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // Optimistic chat: keep messages we've sent locally until the server
  // broadcasts them back, so the input feels instant.
  const [pendingChats, setPendingChats] = useState<{ tempId: number; text: string; sentAt: number }[]>([]);
  const [showPlayersModal, setShowPlayersModal] = useState(false);
  const [showCardImage, setShowCardImage] = useState(false);
  // Desktop drawer-only canvas overlay; visible by default each turn, dismissable.
  const [desktopOverlayVisible, setDesktopOverlayVisible] = useState(true);
  // Position of the drawer reference-image overlay inside the canvas. Drawer
  // can drag the small handle bar at the top to reposition it.
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number }>({ top: 8, left: 8 });
  const overlayDragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const handleOverlayDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    overlayDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origTop: overlayPos.top,
      origLeft: overlayPos.left,
    };
    const onMove = (mv: MouseEvent) => {
      const d = overlayDragRef.current;
      if (!d) return;
      setOverlayPos({
        top: Math.max(0, d.origTop + (mv.clientY - d.startY)),
        left: Math.max(0, d.origLeft + (mv.clientX - d.startX)),
      });
    };
    const onUp = () => {
      overlayDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Guesser-only card lookup modal (search by Korean name → see illustration).
  const [showCardSearch, setShowCardSearch] = useState(false);
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState<{ id: number; name: string; image_url: string | null }[]>([]);
  const [cardSearchLoading, setCardSearchLoading] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const amDrawer = !!(
    drawing
    && drawing.drawer_id
    && selfPlayerId != null
    && String(selfPlayerId) === drawing.drawer_id
  );
  // Players who actually participate in the round (excludes spectators).
  // Use this for game-state checks; keep `players` for chat sender lookup.
  const participantPlayers = players.filter((p) => !p.is_spectator);
  // Display order in player-list UIs: participants first (sorted by live
  // score desc), then spectators always at the bottom.
  const orderedDisplayPlayers = (() => {
    const participants = [...participantPlayers].sort(
      (a, b) => (liveScores[String(b.id)] ?? 0) - (liveScores[String(a.id)] ?? 0),
    );
    const specs = players.filter((p) => p.is_spectator);
    return [...participants, ...specs];
  })();

  // Resize canvas to container
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        const w = Math.max(200, Math.floor(r.width));
        const h = Math.max(150, Math.floor(w * 0.78));
        setCanvasDims({ w, h });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Render strokes from buffer
  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    let drawingPath = false;
    let last: { x: number; y: number } | null = null;
    for (const p of strokeBufRef.current) {
      const x = p.x * cv.width;
      const y = p.y * cv.height;
      if (p.op === "fill") {
        floodFill(ctx, cv.width, cv.height, Math.floor(x), Math.floor(y), p.color || "#000000");
        drawingPath = false;
        last = null;
      } else if (p.op === "start") {
        drawingPath = true;
        last = { x, y };
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = p.size || 4;
        ctx.strokeStyle = (p.tool || "pen") === "eraser" ? "#ffffff" : (p.color || "#000000");
        ctx.moveTo(x, y);
      } else if (p.op === "move" && drawingPath && last) {
        ctx.lineTo(x, y);
        ctx.stroke();
        last = { x, y };
      } else if (p.op === "end") {
        drawingPath = false;
        last = null;
      }
    }
  }, []);

  // Redraw on canvas resize
  useEffect(() => { redraw(); }, [canvasDims, redraw]);

  // When server sends a replay (reconnect / undo), reset buffer
  useEffect(() => {
    if (replayStrokes !== undefined) {
      strokeBufRef.current = [...replayStrokes];
      redraw();
    }
  }, [replayStrokes, redraw]);

  // Handle incoming dm_stroke / dm_clear from server (parent passes via chatLog? no — via separate hook)
  // Parent will pass strokes through replayStrokes mechanism — for live strokes, parent imperatively pushes via window event.
  // To keep it simple here, we expose a method via ref... actually simpler: have parent call addStroke directly.
  // For now, listen for a custom event on window:
  useEffect(() => {
    const onAdd = (e: Event) => {
      // Drawer already painted locally + pushed to buffer; processing the
      // server's echo would interleave path state and cause zigzag artifacts.
      if (amDrawer) return;
      const detail = (e as CustomEvent).detail as DmStrokePayload | undefined;
      if (!detail) return;
      strokeBufRef.current.push(detail);
      drawIncrement(detail);
    };
    const onClear = () => {
      strokeBufRef.current = [];
      redraw();
    };
    window.addEventListener("dm-add-stroke", onAdd as EventListener);
    window.addEventListener("dm-clear-canvas", onClear);
    return () => {
      window.removeEventListener("dm-add-stroke", onAdd as EventListener);
      window.removeEventListener("dm-clear-canvas", onClear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amDrawer]);

  // Debounced card-name search for the guesser's lookup modal.
  useEffect(() => {
    if (!showCardSearch) return;
    const q = cardSearchQuery.trim();
    if (!q) { setCardSearchResults([]); return; }
    let cancelled = false;
    setCardSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const token = localStorage.getItem("access_token") || "";
        const res = await fetch(`/api/search/?q=${encodeURIComponent(q)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        if (!cancelled) setCardSearchResults(data.results || []);
      } catch {
        if (!cancelled) setCardSearchResults([]);
      } finally {
        if (!cancelled) setCardSearchLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cardSearchQuery, showCardSearch]);

  // Preload all word-choice illustrations as soon as they arrive so the modal
  // doesn't display half-loaded images.
  useEffect(() => {
    if (!myWordChoices) return;
    for (const c of myWordChoices.choices) {
      if (c.image_url) {
        const img = new Image();
        img.src = c.image_url;
      }
    }
  }, [myWordChoices]);

  // Reset canvas when a NEW turn starts. Trigger on `choosing` (not `drawing`)
  // so the previous turn's drawing disappears the moment the next drawer enters
  // card-selection, instead of lingering until they actually start drawing.
  //
  // First-time bookkeeping: on a refresh mid-turn the server replays strokes,
  // so we must NOT wipe on the very first event. We track that with a
  // separate `hasInited` flag instead of relying on `lastTurnKeyRef === null`,
  // because between turns both `choosing` and `drawing` go to null briefly
  // (during `dm_turn_reveal`) — resetting the ref then would mis-classify
  // the next turn's first event as "first mount" and skip the wipe.
  const hasInitedRef = useRef(false);
  const lastTurnKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const ev = choosing || drawing;
    if (!ev) return;  // keep ref across reveal-phase null gap
    const key = `${ev.round}-${ev.turn_index}-${ev.drawer_id}`;
    if (!hasInitedRef.current) {
      hasInitedRef.current = true;
      lastTurnKeyRef.current = key;
      return;
    }
    if (lastTurnKeyRef.current !== key) {
      lastTurnKeyRef.current = key;
      strokeBufRef.current = [];
      redraw();
      setShowCardImage(false);
      setDesktopOverlayVisible(true);
    }
  }, [choosing, drawing, redraw]);

  // "새 문제 시작" pop — fires on every transition into the drawing phase.
  // Separate from the canvas-wipe effect because the wipe is keyed by the
  // *choosing* event (which arrives first); by the time `drawing` lands, the
  // wipe-key is already locked in and that effect wouldn't re-trigger.
  // hasInitedDrawRef skips the chime on a mid-turn reconnect.
  const hasInitedDrawRef = useRef(false);
  const lastDrawKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!drawing) return;
    const key = `${drawing.round}-${drawing.turn_index}-${drawing.drawer_id}`;
    if (!hasInitedDrawRef.current) {
      hasInitedDrawRef.current = true;
      lastDrawKeyRef.current = key;
      return;
    }
    if (lastDrawKeyRef.current !== key) {
      lastDrawKeyRef.current = key;
      // 뽁: A5 → E6 quick sweep
      playIfNotMuted(() => playArpeggio([880, 1318], 30, "sine", 0.12));
    }
  }, [drawing, playIfNotMuted]);

  // Hint reveal sound
  const lastHintRef = useRef("");
  useEffect(() => {
    if (drawing && hint && hint !== lastHintRef.current) {
      const prevReveals = (lastHintRef.current.match(/[^_\s\-·\/]/g) || []).length;
      const curReveals = (hint.match(/[^_\s\-·\/]/g) || []).length;
      if (curReveals > prevReveals) {
        playIfNotMuted(() => playTone(880, 80, "sine", 0.07));
      }
      lastHintRef.current = hint;
    }
    if (!drawing) lastHintRef.current = "";
  }, [hint, drawing, playIfNotMuted]);

  // Turn reveal sound
  const lastRevealKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (reveal) {
      const k = `${reveal.drawer_id}:${reveal.word}`;
      if (lastRevealKeyRef.current !== k) {
        lastRevealKeyRef.current = k;
        playIfNotMuted(() => playArpeggio([784, 587, 523], 90, "sine"));  // descending bell
      }
    } else {
      lastRevealKeyRef.current = null;
    }
  }, [reveal, playIfNotMuted]);

  // Personal correct guess sound (one-shot per turn).
  const myCorrectCountRef = useRef(0);

  // When server signals "close hint" (private to this user), drop the most
  // recent optimistic pending chat — it represents the close attempt that
  // never gets broadcast. Skip the initial mount (tick 0).
  const closeHintTickRef = useRef<number | undefined>(closeHintTick);
  useEffect(() => {
    if (closeHintTick == null) return;
    if (closeHintTickRef.current === closeHintTick) return;
    closeHintTickRef.current = closeHintTick;
    setPendingChats((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, [closeHintTick]);
  // Track which player ids have already triggered an "other correct" chime
  // for the current turn so we don't fire it again on every re-render.
  const otherCorrectFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const meId = selfPlayerId != null
      ? String(selfPlayerId)
      : (players.find((p) => p.display_name === selfDisplayName)?.id?.toString() || "");
    const isMyCorrect = !!meId && correctGuesserIds.has(meId);
    if (isMyCorrect && myCorrectCountRef.current === 0) {
      myCorrectCountRef.current = 1;
      // Personal correct: bright ascending arpeggio (E-A-D)
      playIfNotMuted(() => playArpeggio([659, 880, 1175], 60, "triangle", 0.12));
    }
    // Other-player correct: short G5 chime, played once per player per turn.
    for (const pid of correctGuesserIds) {
      if (pid === meId) continue;
      if (otherCorrectFiredRef.current.has(pid)) continue;
      otherCorrectFiredRef.current.add(pid);
      playIfNotMuted(() => playTone(784, 90, "sine", 0.08));
    }
    if (!drawing) {
      myCorrectCountRef.current = 0;
      otherCorrectFiredRef.current = new Set();
    }
  }, [correctGuesserIds, drawing, players, selfDisplayName, selfPlayerId, playIfNotMuted]);

  // Scroll chat to bottom on new message, on chat-container re-mount (reveal
  // toggle), AND when guesser action buttons (search/give-up) appear/disappear
  // — those buttons shrink the scroll area and would otherwise hide the last
  // line. useLayoutEffect runs before paint so users never see the jump.
  useLayoutEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatLog.length, reveal, drawing, amDrawer]);

  const drawIncrement = (p: DmStrokePayload) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const x = p.x * cv.width;
    const y = p.y * cv.height;
    if (p.op === "fill") {
      floodFill(ctx, cv.width, cv.height, Math.floor(x), Math.floor(y), p.color || "#000000");
      return;
    }
    if (p.op === "start") {
      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = p.size || 4;
      ctx.strokeStyle = (p.tool || "pen") === "eraser" ? "#ffffff" : (p.color || "#000000");
      ctx.moveTo(x, y);
    } else if (p.op === "move") {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  // Pointer events (drawer only)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!amDrawer) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (tool === "fill") {
      const p: DmStrokePayload = { op: "fill", x, y, color, tool: "fill" };
      strokeBufRef.current.push(p);
      drawIncrement(p);
      onStroke(p);
      return;
    }
    cv.setPointerCapture(e.pointerId);
    drawingActiveRef.current = true;
    lastPosRef.current = { x, y };
    const p: DmStrokePayload = { op: "start", x, y, color, size: brushSize, tool };
    strokeBufRef.current.push(p);
    drawIncrement(p);
    onStroke(p);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!amDrawer || !drawingActiveRef.current) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // Throttle slightly: skip if too close
    const last = lastPosRef.current;
    if (last) {
      const dx = (x - last.x) * cv.width;
      const dy = (y - last.y) * cv.height;
      if (dx * dx + dy * dy < 1) return;
    }
    lastPosRef.current = { x, y };
    const p: DmStrokePayload = { op: "move", x, y };
    strokeBufRef.current.push(p);
    drawIncrement(p);
    onStroke(p);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!amDrawer) return;
    drawingActiveRef.current = false;
    lastPosRef.current = null;
    const p: DmStrokePayload = { op: "end", x: 0, y: 0 };
    strokeBufRef.current.push(p);
    onStroke(p);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatInput.trim();
    if (!t) return;
    // Optimistic: render instantly, then dedupe when server broadcasts back.
    setPendingChats((prev) => [...prev, { tempId: Date.now() + Math.random(), text: t, sentAt: Date.now() }]);
    onChat(t);
    setChatInput("");
  };

  // Dedupe optimistic messages when the server's matching broadcast arrives.
  // Match strategy: any chat from self that arrived AFTER our local sentAt,
  // matching either the same text OR the "정답을 맞혔습니다!" reply.
  useEffect(() => {
    if (pendingChats.length === 0) return;
    // Match by player_id — display_name doesn't survive in anonymous rooms
    // (server sends "플레이어N", not the user's real nickname).
    const meIdStr = selfPlayerId != null ? String(selfPlayerId) : "";
    const myMessages = meIdStr
      ? chatLog.filter((m) => String(m.player_id) === meIdStr)
      : chatLog.filter((m) => m.display_name === selfDisplayName);
    if (myMessages.length === 0) return;
    setPendingChats((prev) => {
      let i = 0;
      let pendingLeft = [...prev];
      // for each broadcast self-message (in order), match against earliest pending
      for (let _k = 0; _k < myMessages.length; _k++) {
        if (pendingLeft.length === 0) break;
        // pop the oldest pending entry that hasn't been matched yet
        pendingLeft = pendingLeft.slice(1);
        i++;
      }
      // Only update if some pending was consumed, to avoid extra rerenders.
      return i > 0 ? pendingLeft : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLog]);

  // Time remaining (for choosing or drawing)
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 200);
    return () => clearInterval(id);
  }, []);

  // Client-local deadlines (immune to clock skew). MUST be called every
  // render — moved above the finalResult early return so hook order stays
  // stable when the game ends.
  const choosingLocalDeadline = useChoosingLocalDeadline(choosing);
  const drawingLocalDeadline = useDrawingLocalDeadline(drawing);

  // ==== Final result view ====
  if (finalResult) {
    const ranked = finalResult.ranked || [];
    return (
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-3 sm:p-5">
        <h2 className="text-xl font-bold text-center mb-4">🏆 게임 종료</h2>
        {ranked.length === 0 ? (
          <p className="text-center text-sm text-gray-500">결과 데이터가 없습니다.</p>
        ) : (
        <div className="space-y-2">
          {ranked.map((entry, i) => (
            <div
              key={entry.player.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                i === 0 ? "bg-yellow-100 dark:bg-yellow-900/30"
                : i === 1 ? "bg-gray-100 dark:bg-gray-700"
                : i === 2 ? "bg-orange-100 dark:bg-orange-900/30"
                : "bg-gray-50 dark:bg-gray-900"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-lg w-7 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                </span>
                <Avatar icon={entry.player.avatar_icon} border={entry.player.border} size={36} />
                <span className="font-semibold truncate">{entry.player.display_name}</span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="font-bold text-lg leading-tight">{entry.score}점</span>
                {entry.points_awarded > 0 && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    +{entry.points_awarded}P
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    );
  }

  // ==== Drawer-only word choice modal ====
  const showWordChoiceModal = !!myWordChoices && !!choosing && !drawing;
  const choiceRemaining = choosingLocalDeadline != null ? Math.max(0, choosingLocalDeadline - now) : 0;
  const drawingRemaining = drawingLocalDeadline != null ? Math.max(0, drawingLocalDeadline - now) : 0;

  // ==== Layout ====
  const wordHint = drawerWord && amDrawer ? drawerWord : (hint || "");

  // Top-2 player ids by current live score (only positive scores qualify;
  // ties broken by player.id ordering — first one in sorted order wins).
  const rankedIds: string[] = (() => {
    const scored = players
      .map((p) => ({ id: String(p.id), score: liveScores[String(p.id)] ?? 0 }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map((x) => x.id);
  })();
  const rankMedal = (pid: string): string => {
    if (rankedIds[0] === pid) return "🥇";
    if (rankedIds[1] === pid) return "🥈";
    return "";
  };

  // Progress bar fraction (0..1) for current phase — drawing or choosing.
  const timerTotal = drawing ? (drawing.duration || 80) : choosing ? 15 : 0;
  const timerRemaining = drawing ? drawingRemaining : choosing && !reveal ? choiceRemaining : 0;
  const timerFrac = timerTotal > 0 ? Math.max(0, Math.min(1, timerRemaining / timerTotal)) : 0;
  const timerActive = !!(drawing || (choosing && !reveal));
  const timerColor = timerFrac > 0.5 ? "bg-green-500" : timerFrac > 0.25 ? "bg-yellow-400" : "bg-red-500";

  return (
    <div className="bg-gray-100 dark:bg-gray-900 lg:rounded-xl lg:shadow p-0 lg:p-3">
      {/* Time gauge — single thin bar at the very top, color shifts from
          green → yellow → red as the clock runs down. */}
      <div className="h-1 bg-gray-200 dark:bg-gray-700 mb-1 rounded-full overflow-hidden">
        {timerActive && (
          <div
            className={`h-full ${timerColor} transition-[width] duration-200 ease-linear`}
            style={{ width: `${timerFrac * 100}%` }}
          />
        )}
      </div>
      {/* Unified status bar — fixed height, content swaps by phase so the
          layout never jumps when state transitions (correct guess, reveal,
          new turn, etc.). */}
      <div className="bg-white dark:bg-gray-800 rounded-lg px-2 py-2 mb-2 text-sm h-[68px] flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="font-semibold whitespace-nowrap">
            {(drawing?.round ?? choosing?.round) ? `라운드 ${drawing?.round ?? choosing?.round}/${drawing?.total_rounds ?? choosing?.total_rounds}` : ""}
          </span>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
              {drawing ? `${drawingRemaining.toFixed(1)}s` :
               choosing && !reveal ? `${choiceRemaining.toFixed(1)}s` :
               reveal ? `정답자 ${Object.keys(reveal.correct_guessers).length}명 +${reveal.drawer_bonus}` : ""}
            </span>
            <button
              onClick={handleCaptureCanvas}
              title="캔버스 캡처 (PNG 다운로드)"
              className="text-base"
            >
              📸
            </button>
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                localStorage.setItem("dm_muted", next ? "1" : "0");
              }}
              title={muted ? "음소거 해제" : "음소거"}
              className="text-base"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>
        <div
          className={`font-bold text-center break-words flex-1 flex items-center justify-center gap-2 overflow-hidden ${
            reveal ? "text-base text-green-700 dark:text-green-300" :
            drawing && amDrawer ? "text-base" :
            "font-mono tracking-wider text-base"
          }`}
        >
          <span>
            {reveal ? `✓ ${reveal.word}` :
             drawing
              ? (amDrawer
                  // Drawer always sees their own word (+ length when guessers see it).
                  ? (drawing.word_length > 0 ? `${wordHint} (${drawing.word_length})` : wordHint)
                  // Guessers: empty hint = host disabled length reveal → just an "?".
                  : (wordHint
                      ? `${wordHint.split("").join(" ")} (${drawing.word_length})`
                      : "❓ 그림만 보고 맞춰보세요"))
              : choosing ? `🎨 ${choosing.drawer_name} 단어 선택 중...` : ""}
          </span>
          {drawing && amDrawer && drawerImageUrl && (
            <button
              type="button"
              onClick={() => {
                setShowCardImage(true);
                setDesktopOverlayVisible(true);
              }}
              className="shrink-0 px-2 py-0.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 active:bg-blue-800"
              style={{ touchAction: "manipulation" }}
              title="원본 일러스트 보기"
            >
              🖼️ 보기
            </button>
          )}
        </div>
      </div>

      {/* Mobile-only compact player strip on top (avatars only) */}
      <button
        type="button"
        onClick={() => setShowPlayersModal(true)}
        className="lg:hidden w-full flex gap-1.5 overflow-x-auto bg-white dark:bg-gray-800 px-2 py-1.5 mb-1 text-left"
      >
        {orderedDisplayPlayers.map((p) => {
          const isDrawer = drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id);
          const guessed = correctGuesserIds.has(String(p.id));
          const gaveUp = givenUpIds.has(String(p.id));
          const isSelf = selfPlayerId != null ? p.id === selfPlayerId : p.display_name === selfDisplayName;
          const isSpec = p.is_spectator;
          return (
            <div key={p.id} className={`shrink-0 flex flex-col items-center ${isSpec ? "opacity-60" : ""}`}>
              <div className={`rounded-full relative ${
                isSpec ? "" :
                isDrawer ? "ring-2 ring-yellow-400" :
                guessed ? "ring-2 ring-green-400" :
                gaveUp ? "ring-2 ring-orange-400 opacity-60" : ""
              }`}>
                <Avatar icon={p.avatar_icon} border={p.border} size={28} />
                {!isSpec && gaveUp && <span className="absolute -top-1 -right-1 text-[10px]">🏳️</span>}
                {!isSpec && rankMedal(String(p.id)) && (
                  <span className="absolute -top-1 -left-1 text-[10px]">{rankMedal(String(p.id))}</span>
                )}
              </div>
              {isSpec ? (
                <div className="text-[9px] leading-none mt-0.5 text-gray-400">관전</div>
              ) : isSelf && (
                <div className="text-[9px] leading-none mt-0.5 text-blue-600 dark:text-blue-400 font-bold">나</div>
              )}
            </div>
          );
        })}
        <div className="shrink-0 self-center text-xs text-gray-400 ml-auto">탭 ▸</div>
      </button>

      {/* Main game area — at lg+ (≥1024) two columns (canvas | sidebar);
          below that (mobile + iPad portrait) stacked so the canvas isn't
          squeezed. lg:items-start prevents the right (chat) column from
          stretching to the canvas column's height — otherwise we get a big
          empty band below the chat panel. */}
      <div className="lg:grid lg:gap-3 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Left column: canvas + tools. select-none on the column avoids
            mobile text-selection drags spilling into adjacent labels when a
            stroke starts near the canvas edge. The chat column stays
            selectable so users can copy chat history. */}
        <div className="flex flex-col gap-2 mb-2 lg:mb-0 select-none">
          <div ref={containerRef} className="bg-white lg:rounded-lg overflow-hidden lg:border-2 lg:border-gray-300 lg:dark:border-gray-600 relative touch-none">
            <canvas
              ref={canvasRef}
              width={canvasDims.w}
              height={canvasDims.h}
              className="block w-full"
              style={{
                cursor: amDrawer ? (tool === "fill" ? "cell" : "crosshair") : "default",
                touchAction: "none",
                // Prevent iOS long-press callout / image-save menu over the
                // canvas — mobile drawers were getting interrupted mid-stroke.
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {!drawing && !choosing && !reveal && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm bg-white/70">
                게임 준비 중...
              </div>
            )}
            {/* Reveal overlay — small panel at top-left of canvas so the
                drawing remains mostly visible AND chat stays unblocked. */}
            {reveal && reveal.image_url && (
              <div className="absolute top-2 left-2 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-green-400 dark:border-green-600 p-1 max-w-[40%] max-h-[60%]">
                <p className="text-[10px] sm:text-xs text-center text-green-700 dark:text-green-300 font-semibold leading-none mb-1">정답</p>
                <img
                  src={reveal.image_url}
                  alt={reveal.word}
                  className="block rounded object-contain"
                  style={{ maxHeight: "calc(60vh - 5rem)", maxWidth: "100%" }}
                />
              </div>
            )}
            {/* Drawer-only canvas overlay: original card illustration anchored
                to the top-left of the canvas. Desktop has drag/resize handles;
                on mobile it stays static (touch events on the handle aren't
                bound). The "🖼️ 보기" button still opens a full-screen modal
                for a closer look. */}
            {amDrawer && drawing && drawerImageUrl && desktopOverlayVisible && (
              <div
                className="absolute z-10 bg-white rounded-lg shadow-lg border-2 border-blue-300 dark:border-blue-700"
                style={{
                  top: overlayPos.top,
                  left: overlayPos.left,
                  resize: "both",
                  overflow: "hidden",
                  // Sized as a fraction of canvas width — keeps the overlay
                  // proportionate on narrow viewports (iPad portrait, etc).
                  // User can still drag-resize from the bottom-right corner.
                  width: "35%",
                  aspectRatio: "1 / 1",
                  minWidth: "100px",
                  minHeight: "100px",
                  maxWidth: "80%",
                  maxHeight: "85%",
                }}
              >
                {/* Drag handle bar at the top */}
                <div
                  onMouseDown={handleOverlayDragStart}
                  className="absolute top-0 left-0 right-0 h-5 bg-blue-100 dark:bg-blue-900/40 cursor-move flex items-center justify-center select-none"
                  title="드래그해서 이동"
                >
                  <span className="text-[10px] text-blue-600 dark:text-blue-300 leading-none">⋮⋮ 드래그</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDesktopOverlayVisible(false)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white text-gray-900 font-bold text-xs shadow border border-gray-300 hover:bg-gray-100 z-10 flex items-center justify-center"
                  aria-label="닫기"
                  title="닫기"
                >
                  ✕
                </button>
                <img
                  src={drawerImageUrl}
                  alt="원본 일러스트"
                  className="block w-full object-contain pointer-events-none"
                  style={{ height: "calc(100% - 20px)", marginTop: 20 }}
                />
              </div>
            )}
          </div>

          {/* Tool palette — only rendered for the drawer. Chat panel below
              expands to take the freed space when not drawing. */}
          {amDrawer && drawing && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-2 flex flex-wrap items-center gap-2 text-xs">
              <div className="flex flex-wrap gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setColor(c); if (tool === "eraser") setTool("pen"); }}
                    className={`w-6 h-6 rounded border-2 ${color === c && tool !== "eraser" ? "border-blue-500" : "border-gray-300 dark:border-gray-600"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="flex gap-1 ml-1">
                {BRUSH_SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setBrushSize(s)}
                    className={`w-7 h-7 rounded border flex items-center justify-center ${brushSize === s ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                    title={`굵기 ${s}px`}
                  >
                    <span className="rounded-full bg-current" style={{ width: s, height: s }} />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setTool("pen")}
                className={`px-2 py-1 rounded border ${tool === "pen" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >✏ 펜</button>
              <button
                onClick={() => setTool("fill")}
                className={`px-2 py-1 rounded border ${tool === "fill" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >🪣 채우기</button>
              <button
                onClick={() => setTool("eraser")}
                className={`px-2 py-1 rounded border ${tool === "eraser" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >지우개</button>
              <button onClick={() => onUndo()} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600">↶ 되돌리기</button>
              <button onClick={() => onClear()} className="px-2 py-1 rounded border border-red-300 text-red-600">🗑 전체</button>
          </div>
          )}
        </div>

        {/* Mobile: players=horizontal strip on top + chat full-width below.
            Desktop: vertical stack in the right column. */}
        <div className="flex flex-col gap-2 min-w-0">
          {/* Player sidebar — desktop only (mobile uses the top strip + tap modal).
              Caps height + scrolls so it works with up to 12 players. Sorted by
              live score (desc) so the leaderboard reads top-down. */}
          <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-lg p-2 min-w-0 max-h-48 overflow-y-auto">
            <div className="flex gap-1.5 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-x-visible">
              {orderedDisplayPlayers.map((p) => {
                const score = liveScores[String(p.id)] ?? 0;
                const isDrawer = drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id);
                const guessed = correctGuesserIds.has(String(p.id));
                const gaveUp = givenUpIds.has(String(p.id));
                const isSpec = p.is_spectator;
                return (
                  <div
                    key={p.id}
                    title={p.display_name}
                    className={`shrink-0 lg:shrink flex flex-col lg:flex-row items-center lg:gap-2 lg:p-1.5 rounded ${
                      isSpec ? "opacity-60" :
                      isDrawer ? "bg-yellow-50 dark:bg-yellow-900/20" :
                      guessed ? "bg-green-50 dark:bg-green-900/20" :
                      gaveUp ? "bg-orange-50 dark:bg-orange-900/20 opacity-70" : ""
                    }`}
                  >
                    <div className="relative">
                      <Avatar icon={p.avatar_icon} border={p.border} size={28} />
                      {!isSpec && isDrawer && <span className="md:hidden absolute -top-1 -right-1 text-[10px]">🎨</span>}
                      {!isSpec && guessed && <span className="md:hidden absolute -top-1 -right-1 text-[10px]">✓</span>}
                      {!isSpec && gaveUp && !guessed && <span className="md:hidden absolute -top-1 -right-1 text-[10px]">🏳️</span>}
                    </div>
                    {/* Mobile: just score under avatar. Desktop: name + score on the right. */}
                    {!isSpec && (
                      <div className="text-[10px] md:hidden font-semibold leading-tight mt-0.5">{score}</div>
                    )}
                    {isSpec && (
                      <div className="text-[10px] md:hidden text-gray-400 leading-tight mt-0.5">관전</div>
                    )}
                    <div className="hidden lg:block flex-1 min-w-0">
                      <div className="text-xs truncate text-left">
                        {!isSpec && rankMedal(String(p.id)) && `${rankMedal(String(p.id))} `}{!isSpec && isDrawer && "🎨 "}{!isSpec && guessed && "✓ "}{!isSpec && gaveUp && !guessed && "🏳️ "}{p.display_name}
                        {isSpec && <span className="ml-1 text-gray-400">(관전자)</span>}
                      </div>
                      {!isSpec && <div className="text-[11px] text-gray-500 text-left">{score}점</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chat is always visible — reveal illustration shows as a small
              panel inside the canvas area instead of replacing chat, so the
              10-second break gives players actual chat time. */}
          <div className={`bg-white dark:bg-gray-800 rounded-lg p-2 flex flex-col min-w-0 lg:h-[420px] ${amDrawer && drawing ? "h-[min(28svh,260px)]" : "h-[min(36svh,340px)]"}`}>
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto text-sm md:text-base space-y-0.5 pr-1 break-words text-left">
              {chatLog.map((m, i) => {
                if ((m as any).is_system) {
                  return (
                    <div key={i} className="px-1.5 py-1 rounded text-center break-words text-red-600 dark:text-red-400 font-bold">
                      {m.text}
                    </div>
                  );
                }
                const sender = players.find((p) => p.display_name === m.display_name);
                const isSpec = sender?.is_spectator || (m as any).is_spectator;
                return (
                  <div key={i} className={`px-1.5 py-1 rounded text-left break-words ${
                    m.kind === "correct"
                      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-semibold"
                      : "text-gray-700 dark:text-gray-300"
                  }`}>
                    <span className="inline-flex items-center gap-1 mr-1 align-middle">
                      {sender && (
                        <>
                          <span className="md:hidden inline-flex">
                            <Avatar icon={sender.avatar_icon} border={sender.border} size={16} />
                          </span>
                          <span className="hidden md:inline-flex">
                            <Avatar icon={sender.avatar_icon} border={sender.border} size={22} />
                          </span>
                        </>
                      )}
                      <span className={`font-semibold ${isSpec ? "text-gray-500 dark:text-gray-400" : "text-blue-600 dark:text-blue-400"}`}>
                        {m.display_name}
                      </span>
                    </span>
                    <span>{m.text}</span>
                    {m.kind === "correct" && m.delta !== undefined && <span className="ml-1 text-blue-600">+{m.delta}</span>}
                  </div>
                );
              })}
              {pendingChats.map((p) => {
                const sender = selfPlayerId != null
                  ? players.find((pp) => pp.id === selfPlayerId)
                  : players.find((pp) => pp.display_name === selfDisplayName);
                // In anonymous rooms the user's "real" nickname doesn't appear
                // anywhere else in chat — show their anonymized name from the
                // player list to match what everyone else sees.
                const senderName = sender?.display_name || selfDisplayName;
                return (
                  <div key={p.tempId} className="px-1.5 py-1 rounded text-left break-words text-gray-400 dark:text-gray-500 italic">
                    <span className="inline-flex items-center gap-1 mr-1 align-middle">
                      {sender && (
                        <>
                          <span className="md:hidden inline-flex">
                            <Avatar icon={sender.avatar_icon} border={sender.border} size={16} />
                          </span>
                          <span className="hidden md:inline-flex">
                            <Avatar icon={sender.avatar_icon} border={sender.border} size={22} />
                          </span>
                        </>
                      )}
                      <span className="font-semibold">{senderName}</span>
                    </span>
                    <span>{p.text}</span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const meId = selfPlayerId != null
                ? String(selfPlayerId)
                : (players.find((p) => p.display_name === selfDisplayName)?.id?.toString() || "");
              const iAmCorrect = correctGuesserIds.has(meId);
              const iGaveUp = givenUpIds.has(meId);
              const chatLocked = amDrawer || !!chatLockedExternal;
              const placeholder = chatLockedExternal
                ? "관전자 채팅이 비활성화되어 있습니다"
                : amDrawer
                  ? "당신은 출제자입니다"
                  : amSpectator
                    ? "수다 떨기 (관전 중)"
                    : iAmCorrect
                      ? "수다 떨기 (이미 정답)"
                      : iGaveUp
                        ? "수다 떨기 (포기함)"
                        : "정답을 입력해서 맞혀보세요";
              return (
                <>
                  <form onSubmit={handleSubmitChat} className="flex gap-1 mt-2 min-w-0">
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={placeholder}
                      disabled={chatLocked}
                      className="flex-1 min-w-0 px-2 py-1 md:py-2 border rounded bg-white dark:bg-gray-800 text-base sm:text-sm md:text-base"
                    />
                    <button type="submit" disabled={chatLocked || !chatInput.trim()} className="shrink-0 px-3 py-1 md:py-2 bg-blue-600 text-white rounded text-sm md:text-base font-semibold disabled:opacity-40">
                      전송
                    </button>
                  </form>
                  {drawing && !amDrawer && !amSpectator && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => { setCardSearchQuery(""); setCardSearchResults([]); setShowCardSearch(true); }}
                        className="flex-1 text-xs py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      >
                        🔍 카드 검색
                      </button>
                      {!iAmCorrect && !iGaveUp && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("정말 이번 라운드를 포기하시겠습니까?")) onGiveUp();
                          }}
                          className="flex-1 text-xs py-1 rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                        >
                          🏳️ 포기
                        </button>
                      )}
                    </div>
                  )}
                  {amSpectator && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => { setCardSearchQuery(""); setCardSearchResults([]); setShowCardSearch(true); }}
                        className="flex-1 text-xs py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      >
                        🔍 카드 검색
                      </button>
                      {onJoinGame && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("게임에 참여하시겠습니까? 이번 라운드의 마지막 출제 순서로 들어갑니다.")) onJoinGame();
                          }}
                          className="flex-1 text-xs py-1 rounded border border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 font-semibold"
                        >
                          🎮 게임 참여
                        </button>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Word choice modal */}
      {/* Players modal (mobile, opens from tap on top strip) */}
      {showPlayersModal && (
        <div className="lg:hidden fixed inset-0 bg-black/60 z-[60] flex items-end sm:items-center justify-center" onClick={() => setShowPlayersModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl p-4 max-w-md w-full max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base">플레이어</h3>
              <button onClick={() => setShowPlayersModal(false)} className="text-gray-400 text-lg">✕</button>
            </div>
            <div className="space-y-1.5">
              {orderedDisplayPlayers.map((p) => {
                const score = liveScores[String(p.id)] ?? 0;
                const isDrawer = drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id);
                const guessed = correctGuesserIds.has(String(p.id));
                const gaveUp = givenUpIds.has(String(p.id));
                const isSelf = selfPlayerId != null ? p.id === selfPlayerId : p.display_name === selfDisplayName;
                const isSpec = p.is_spectator;
                return (
                  <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${
                    isSpec ? "bg-gray-50 dark:bg-gray-900 opacity-60" :
                    isDrawer ? "bg-yellow-50 dark:bg-yellow-900/20" :
                    guessed ? "bg-green-50 dark:bg-green-900/20" :
                    gaveUp ? "bg-orange-50 dark:bg-orange-900/20 opacity-70" : "bg-gray-50 dark:bg-gray-900"
                  }`}>
                    <Avatar icon={p.avatar_icon} border={p.border} size={36} />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm truncate font-semibold">
                        {!isSpec && rankMedal(String(p.id)) && `${rankMedal(String(p.id))} `}{!isSpec && isDrawer && "🎨 "}{!isSpec && guessed && "✓ "}{!isSpec && gaveUp && !guessed && "🏳️ "}{p.display_name}{!isSpec && isSelf && <span className="text-blue-600 dark:text-blue-400 ml-1">(나)</span>}{isSpec && <span className="text-gray-400 ml-1">(관전자)</span>}
                      </div>
                      {!isSpec && <div className="text-xs text-gray-500">{score}점</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showCardImage && drawerImageUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-[55] flex items-center justify-center p-4"
          onClick={() => setShowCardImage(false)}
          style={{ touchAction: "manipulation" }}
        >
          <div className="relative max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowCardImage(false)}
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-gray-900 font-bold text-xl shadow-lg border border-gray-300 hover:bg-gray-100 active:bg-gray-200 z-10"
              style={{ touchAction: "manipulation" }}
              aria-label="닫기"
            >
              ✕
            </button>
            <img
              src={drawerImageUrl}
              alt="원본 일러스트"
              className="w-full rounded-lg shadow-2xl border-2 border-white object-contain"
            />
          </div>
        </div>
      )}

      {showCardSearch && (
        <div
          className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-2 sm:p-4"
          onClick={() => setShowCardSearch(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-4 w-full max-w-md max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="font-bold text-base shrink-0">🔍 카드 검색</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  * 카드 클릭 시 채팅창으로 복사
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCardSearch(false)}
                className="text-gray-400 text-lg px-2 shrink-0"
                aria-label="닫기"
              >✕</button>
            </div>
            <input
              type="text"
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
              placeholder="카드 이름으로 검색..."
              autoFocus
              className="w-full px-2 py-1.5 border rounded bg-white dark:bg-gray-700 text-base sm:text-sm mb-2"
            />
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {cardSearchLoading && (
                <p className="text-xs text-gray-400 text-center py-3">검색 중...</p>
              )}
              {!cardSearchLoading && cardSearchQuery.trim() && cardSearchResults.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">결과 없음</p>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {cardSearchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setChatInput(c.name);
                      setShowCardSearch(false);
                      setTimeout(() => chatInputRef.current?.focus(), 0);
                    }}
                    className="text-center hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded p-1 transition"
                    title="이 이름으로 채팅 입력"
                  >
                    {c.image_url ? (
                      <img
                        src={c.image_url}
                        alt={c.name}
                        className="w-full aspect-square object-contain rounded bg-gray-100 dark:bg-gray-900"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-square rounded bg-gray-100 dark:bg-gray-900" />
                    )}
                    <p className="text-[10px] sm:text-xs mt-0.5 break-words leading-tight">{c.name}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showWordChoiceModal && myWordChoices && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-5 w-full max-w-lg max-h-[95vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-2 text-center">🎨 단어 선택 ({choiceRemaining.toFixed(1)}초)</h3>
            <p className="text-xs sm:text-sm text-gray-500 text-center mb-3">아래에서 그릴 단어를 선택하세요. 시간 초과 시 첫 번째 단어가 자동 선택됩니다.</p>
            <div className="space-y-2">
              {myWordChoices.choices.map((c) => (
                <button
                  key={c.card_id}
                  onClick={() => onChooseWord(c.card_id, c.name)}
                  className="w-full p-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 active:bg-blue-800 text-base select-none flex items-center gap-3"
                  style={{ touchAction: "manipulation" }}
                >
                  {c.image_url ? (
                    <img
                      src={c.image_url}
                      alt={c.name}
                      className="shrink-0 rounded bg-white object-contain w-16 h-16 sm:w-20 sm:h-20"
                    />
                  ) : (
                    <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded bg-blue-700/30" />
                  )}
                  <span className="flex-1 text-left break-words">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
