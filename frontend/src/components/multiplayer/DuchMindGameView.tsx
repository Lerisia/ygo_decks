import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import Avatar from "@/components/Avatar";
import ColorWheelPicker from "@/components/ColorWheelPicker";
import CardSearchModal from "@/components/CardSearchModal";
import { useIsCompactPortrait, useOrientation } from "@/lib/useViewport";
import { setDrawingMode } from "@/lib/drawingMode";
import type { PublicCardIcon, Border } from "@/api/avatarApi";
import {
  BRUSH_REFERENCE_WIDTH as DM_BRUSH_REF_WIDTH,
  floodFill as dmFloodFill,
  replayStrokes as dmReplayStrokes,
  renderStroke as dmRenderStroke,
  stabilizePoint as dmStabilizePoint,
  type DmStrokePayload as CanvasDmStrokePayload,
  type BrushKind,
  type StabilizerLevel,
  type PressureCurve,
  type StrokePoint,
} from "@/lib/duchmindCanvas";

// === Event types from server ===
export type DmChoosingEvent = {
  drawer_id: string;
  drawer_name: string;
  deadline: number;
  seconds_remaining?: number;
  round: number;
  total_rounds: number;
  turn_index: number;
  /** Player ids in drawing order for the current round. Used to label
   *  each player with their #N position in the rotation. */
  drawer_order?: string[];
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
  /** Player ids in drawing order for the current round. Used to label
   *  each player with their #N position in the rotation. */
  drawer_order?: string[];
};
// Re-export so consumers (MultiplayerRoom, SoloDraw, the gallery, etc.) keep
// importing the type from this module. The canonical definition lives in
// `@/lib/duchmindCanvas` so the stroke engine and the wire format stay in
// sync.
export type DmStrokePayload = CanvasDmStrokePayload;
export type { BrushKind, StabilizerLevel, PressureCurve };
export type DmChatEvent = {
  player_id: string;
  display_name: string;
  kind: "correct" | "wrong" | "system";
  text: string;
  delta?: number;
  total_score?: number;
  // Server marks chats from already-solved senders when the room has
  // duchmind_hide_winner_chat enabled. Client hides them from anyone still
  // trying to guess so they aren't spoiled.
  restricted_to_solved?: boolean;
  // Synthetic notice (join/leave/kick/spec→reserve). Renderer styles it
  // distinctly (centered red text) and skips kind-based logic.
  is_system?: boolean;
  // Client-side monotonic id assigned on arrival — used as React list key
  // so slice-window shifts (200-cap) don't force every chat row's DOM to
  // re-update on each new message.
  _uid?: number;
};
export type CapturedTurn = {
  /** Unique key — used as React list key + dedupe within a game. */
  id: string;
  word: string;
  drawerId: string;
  drawerName: string;
  drawerAvatarIcon: PublicCardIcon | null;
  drawerBorder: Border | null;
  /** Canvas snapshot at reveal time, encoded as a PNG data URL. */
  drawingDataUrl: string;
  /** The card's source illustration (the "answer image"). */
  cardImageUrl: string | null;
  capturedAt: number;
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
  // Spectator who reserved a seat for next turn — shown with a 🕐 badge
  // in the player list so others see they're queued up.
  reserved_for_next?: boolean;
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
  // Spectator who has already opted in to next-turn promotion. The
  // game-join button becomes a disabled "예약됨" status and the chat
  // placeholder switches to "입장 예약됨 — 다음 판부터 참여합니다".
  amReservedForNext?: boolean;
  chatLockedExternal?: boolean;

  // Host actions: kick a player mid-game (afk handling). When set, an "×"
  // button shows next to non-self players in the desktop sidebar list.
  isHost?: boolean;
  onKickPlayer?: (playerId: number) => void;
  // Spectator-only: reserve a seat for the next turn. One-shot — the
  // parent disables the call once `amReservedForNext` flips true.
  onJoinGame?: () => void;
  // Mid-game leave (with the parent's confirm dialog handling). Surfaced
  // as a 🚪 icon in the status bar so phones don't lose vertical space
  // to a dedicated "방 나가기" footer button.
  onLeave?: () => void;
  // 👍/👎 reactions on the drawing. onReact sends one; `reactions` is the
  // parent-managed list of currently-floating ones (auto-expired upstream).
  // x/y are % positions on the canvas — parent randomizes them so a burst
  // scatters across the drawing.
  onReact?: (emoji: "up" | "down") => void;
  reactions?: { id: number; emoji: "up" | "down"; x: number; y: number }[];

  // Increments when server sends `dm_close_hint` for this user. The optimistic
  // pending-chat for the close attempt should be dropped (server intentionally
  // doesn't broadcast close attempts to prevent answer-sniping).
  closeHintTick?: number;

  // The series of the room's selected word pack — drives the in-game lookup
  // search endpoint (yugioh = card search; pokemon = pokemon search).
  packSeries?: "yugioh" | "pokemon";

  // Per-turn capture hook — called once when `reveal` lands for a turn,
  // with the canvas snapshot + answer info. Parent collects these into a
  // gallery shown on the game-end screen.
  onTurnCaptured?: (cap: CapturedTurn) => void;
}

const COLORS = [
  "#000000", "#666666", "#999999", "#cccccc", "#ffffff",
  "#7c1818", "#cc1f1f", "#ff7f00", "#ffd92e", "#16a34a",
  "#1f7eff", "#1e3a8a", "#7e22ce", "#ec4899", "#ffb6c1", "#7a4a1c",
  "#fcd0a1",
];
const BRUSH_SIZES = [2, 4, 8, 16];
// Brush sizes are stored as if drawn on an 800px-wide canvas; render scales
// them by (cv.width / DM_BRUSH_REF_WIDTH) so line thickness stays
// proportionally consistent across screen sizes. (The reference constant
// itself is imported from the shared canvas library as DM_BRUSH_REF_WIDTH.)
const getDefaultBrushSize = () => 2;

const STABILIZER_LABELS = ["꺼짐", "약", "중", "강"];
const PRESSURE_CURVE_LABELS: Record<PressureCurve, string> = {
  low: "둔감",
  mid: "보통",
  high: "민감",
};

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
  // Identity includes `deadline` so a server-side deadline mutation (e.g.
  // first-correct speedup) re-captures the local clock.
  return useLocalDeadline(
    drawing,
    drawing ? `${drawing.round}-${drawing.turn_index}-${drawing.drawer_id}-${drawing.deadline}` : null,
  );
}

// === Local countdown widgets ===
// The countdown text and progress bar each own their own 500ms tick so a
// re-render is scoped to the leaf component rather than the whole 3000+
// line DuchMindGameView. Prior to this every tick re-rendered the entire
// chat list + player strip + avatars, which was the dominant mobile lag.
function TimerText({
  deadline,
  totalSeconds,
  suffix = "s",
  className = "",
  mode = "default",
}: {
  deadline: number | null;
  totalSeconds: number;
  suffix?: string;
  className?: string;
  // "muted" forces the gray color (used when the parent wants to display a
  // disabled / inactive timer). "default" colors by remaining ratio.
  mode?: "default" | "muted";
}) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null) {
    return <span className={className}>0.0{suffix}</span>;
  }
  const remaining = Math.max(0, deadline - now);
  const frac = totalSeconds > 0 ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 0;
  const color = mode === "muted"
    ? "text-gray-600 dark:text-gray-400"
    : frac > 0.5 ? "text-green-600 dark:text-green-400"
    : frac > 0.25 ? "text-yellow-700 dark:text-yellow-400"
    : "text-red-600 dark:text-red-500 font-bold";
  return <span className={`${color} ${className}`}>{remaining.toFixed(1)}{suffix}</span>;
}

function TimerBar({
  deadline,
  totalSeconds,
  className = "",
}: {
  deadline: number | null;
  totalSeconds: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null || totalSeconds <= 0) return null;
  const remaining = Math.max(0, deadline - now);
  const frac = Math.max(0, Math.min(1, remaining / totalSeconds));
  const color = frac > 0.5 ? "bg-green-500" : frac > 0.25 ? "bg-yellow-400" : "bg-red-500";
  return (
    <div
      className={`${color} ${className}`}
      style={{ width: `${frac * 100}%` }}
    />
  );
}

// === Chat row (memoized) ===
// Pulled out so timer ticks and unrelated state updates don't re-render every
// existing chat row. Each WS chat append produces just one new row at the
// list bottom; React.memo skips the existing 199. Props are pre-resolved
// (sender object + booleans) so memo's shallow compare actually catches.
interface ChatRowProps {
  m: DmChatEvent;
  sender?: DmPlayerLite;
  iAmSolved: boolean;
  senderSolved: boolean;
  amDrawer: boolean;
  amSpectator?: boolean;
}
const ChatRow = memo(function ChatRow({
  m, sender, iAmSolved, senderSolved, amDrawer, amSpectator,
}: ChatRowProps) {
  if ((m as any).is_system) {
    return (
      <div className="px-1.5 py-0.5 text-left break-words font-semibold text-gray-500 dark:text-gray-400">
        [시스템] {m.text}
      </div>
    );
  }
  if (m.restricted_to_solved && !iAmSolved && !amDrawer && !amSpectator) return null;
  const isSpec = sender?.is_spectator || (m as any).is_spectator;
  return (
    <div className={`px-1.5 py-1 rounded text-left break-words ${
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
        {senderSolved && (
          <span
            className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0"
            title="정답 맞힘"
          />
        )}
      </span>
      <span>{m.text}</span>
      {m.kind === "correct" && m.delta !== undefined && <span className="ml-1 text-blue-600">+{m.delta}</span>}
    </div>
  );
});

export default function DuchMindGameView({
  choosing, myWordChoices, drawing, drawerWord, drawerImageUrl, hint,
  reveal, finalResult, chatLog, liveScores, correctGuesserIds, givenUpIds,
  players, selfDisplayName, selfPlayerId,
  onChooseWord, onStroke, onClear, onUndo, onGiveUp, onChat, onTurnCaptured,
  replayStrokes,
  amSpectator, amReservedForNext, chatLockedExternal, closeHintTick, onJoinGame, onLeave, onReact, reactions,
  isHost, onKickPlayer, packSeries,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Overlay canvas for the in-progress stroke (drawer's own OR a remote
  // drawer being streamed in). The new perfect-freehand engine re-renders
  // the entire current stroke on each new point, so we render to this
  // transparent overlay and only blit to the committed-main on stroke end.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const strokeBufRef = useRef<DmStrokePayload[]>([]);  // local stroke history for re-render
  const drawingActiveRef = useRef(false);
  // The pointerId that owns the current stroke. move / up / cancel events are
  // matched against it, so a stale or out-of-order event from a *previous*
  // stroke (common on fast consecutive strokes — drawing an X) can't end the
  // stroke that's actually in progress.
  const activePointerIdRef = useRef<number | null>(null);
  // Number of stale pointerups still to swallow — see the SoloDraw version
  // for the full rationale. Fixes "2nd stroke fails when it starts where the
  // 1st ended" (the pen reuses its pointerId across a quick lift-and-retouch,
  // so the straggler up can't be told apart by id).
  const staleUpsToIgnoreRef = useRef(0);
  // Window-level pointerup/cancel fallback for an active stroke. Without
  // setPointerCapture (removed for iOS), an off-canvas release fires the
  // pointerup on a *different* element — the canvas handler never sees it,
  // and `drawingActiveRef` stays true → "ghost drawing" when the pointer
  // comes back. Attached on pointerdown, removed on stroke end.
  const winCleanupRef = useRef<(() => void) | null>(null);
  // Brief window after a drawing turn begins where canvas pointerdown is
  // ignored. Stops the word-choice modal's button click from bleeding
  // into the freshly-mounted canvas (which would auto-start a stroke).
  const pointerIgnoreUntilRef = useRef(0);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  // Palm rejection. Two layers:
  //   1) "펜 전용 모드" toggle (persists across sessions) — touch always
  //      ignored regardless of recent activity. For users who only want
  //      pen input.
  //   2) Short auto lockout (PEN_LOCKOUT_MS) — once a pen event lands,
  //      finger input is suppressed for a brief window so a wrist
  //      resting on the screen can't accidentally start a stroke.
  //      Auto-falls-back to touch after the window so non-pen users
  //      aren't blocked.
  const lastPenEventAtRef = useRef(0);
  const PEN_LOCKOUT_MS = 1500;
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = useState({ w: 800, h: 600 });

  // Two-finger pinch-zoom (drawer, non-MLD layout). All refs — the gesture
  // applies its transform straight to the zoom-target div, so it never
  // triggers a React re-render. zoomTargetRef wraps only the canvases, so the
  // reference-image / reveal panels stay at their normal size.
  const zoomTargetRef = useRef<HTMLDivElement>(null);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const zoomRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const gestureRef = useRef<{ O: { x: number; y: number }; baseW: number; baseH: number; prevM: { x: number; y: number }; prevD: number } | null>(null);
  const gestureActiveRef = useRef(false);
  // Whether the zoom badge is mounted (true for the whole gesture + while
  // zoomed in). The badge's % text is updated imperatively via zoomNumRef
  // during the pinch, so the live readout costs zero re-renders.
  const [zoomBadgeOn, setZoomBadgeOn] = useState(false);
  const zoomNumRef = useRef<HTMLSpanElement>(null);

  // Rotating placeholders — picked once per mount so each session has a
  // stable hint, but the room sees variety across users.
  const searchHint = packSeries === "pokemon" ? "포켓몬 검색을 활용해보세요! ↓" : "카드 검색을 활용해보세요! ↓";
  const spectatorPlaceholder = useMemo(() => {
    const candidates = [
      "관전자도 정답을 맞출 수 있어요!",
      "관전자는 모든 채팅이 보입니다 — 스포일러 주의!",
      searchHint,
    ];
    return candidates[Math.floor(Math.random() * candidates.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const guesserPlaceholder = useMemo(() => {
    const candidates = [
      "정답을 입력해서 맞혀보세요",
      searchHint,
    ];
    return candidates[Math.floor(Math.random() * candidates.length)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [color, setColor] = useState("#000000");
  const [wheelOpen, setWheelOpen] = useState(false);
  const [brushSize, setBrushSize] = useState<number>(getDefaultBrushSize);
  const [tool, setTool] = useState<"pen" | "eraser" | "fill">("pen");
  // Drawing-feel settings persist across sessions (and carry between solo +
  // multi — same localStorage keys) so the user only tunes them once.
  const [stabilizer, setStabilizer] = useState<StabilizerLevel>(() => {
    if (typeof window === "undefined") return 1;
    const raw = localStorage.getItem("duchmind_stabilizer");
    const v = raw === null ? 1 : Number(raw);
    return (v === 0 || v === 1 || v === 2 || v === 3 ? v : 1) as StabilizerLevel;
  });
  const [pressureCurve, setPressureCurve] = useState<PressureCurve>(() => {
    if (typeof window === "undefined") return "mid";
    const v = localStorage.getItem("duchmind_pressure_curve");
    return (v === "low" || v === "mid" || v === "high" ? v : "mid") as PressureCurve;
  });
  const [penOnlyMode, setPenOnlyMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("duchmind_pen_only_mode") === "1";
  });
  useEffect(() => {
    localStorage.setItem("duchmind_stabilizer", String(stabilizer));
  }, [stabilizer]);
  useEffect(() => {
    localStorage.setItem("duchmind_pressure_curve", pressureCurve);
  }, [pressureCurve]);
  useEffect(() => {
    localStorage.setItem("duchmind_pen_only_mode", penOnlyMode ? "1" : "0");
  }, [penOnlyMode]);
  const penOnlyModeRef = useRef(penOnlyMode); penOnlyModeRef.current = penOnlyMode;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Refs mirror the live drawing-config state so pointer-event handlers (which
  // can outlive a single render) always read the latest values.
  const stabilizerRef = useRef(stabilizer); stabilizerRef.current = stabilizer;
  const pressureCurveRef = useRef(pressureCurve); pressureCurveRef.current = pressureCurve;
  // Custom color picked from the wheel during THIS drawing turn. Resets
  // on every new turn so each round starts with the rainbow gradient
  // button (no carried-over color). Wheel button behavior:
  //   - no custom set (rainbow shown)        → first tap opens picker
  //   - custom set, preset is active         → tap re-selects the custom
  //   - custom set, custom is already active → tap reopens picker
  const [customColor, setCustomColor] = useState<string | null>(null);
  useEffect(() => {
    setCustomColor(null);
  }, [drawing?.round, drawing?.turn_index, drawing?.drawer_id]);
  const handleWheelButton = useCallback(() => {
    if (tool === "eraser") setTool("pen");
    if (!customColor) { setWheelOpen(true); return; }
    if (color === customColor) setWheelOpen(true);
    else setColor(customColor);
  }, [tool, customColor, color]);
  // Drawer-only at lg+: optionally pin the palette to the left edge of the
  // canvas as a vertical strip instead of the default bottom bar — wide
  // monitors found the bottom palette covering too much of the drawing.
  // Persisted so the choice survives page refresh.
  const [paletteVertical, setPaletteVertical] = useState<boolean>(() => {
    try { return localStorage.getItem("dm_palette_vertical") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("dm_palette_vertical", paletteVertical ? "1" : "0"); } catch {}
  }, [paletteVertical]);

  // Very-small-viewport flag (e.g. iPhone SE 375×667, iPhone 5 320×568).
  // On these the palette floats absolutely on the left side of the canvas
  // (overlapping the drawing) and the reference image opens as a popup
  // instead of an in-canvas overlay — there's just no room otherwise.
  const [isVerySmall, setIsVerySmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 700px) and (max-width: 480px)");
    const update = () => setIsVerySmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const [chatInput, setChatInput] = useState("");
  // Mute toggle was removed (door icon took its place in the status bar).
  // Always play sound; previously-saved localStorage flag is ignored.
  const muted = false;

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
  const chatContentRef = useRef<HTMLDivElement>(null);
  // Separate refs for the compact-mode chat history — mirrors the
  // pinned-to-bottom auto-scroll behavior on the main panel so phone
  // users see the same "new msg = scroll, unless I scrolled up" UX.
  const compactChatScrollRef = useRef<HTMLDivElement>(null);
  const compactChatContentRef = useRef<HTMLDivElement>(null);
  // Optimistic chat: keep messages we've sent locally until the server
  // broadcasts them back, so the input feels instant.
  const [pendingChats, setPendingChats] = useState<{ tempId: number; text: string; sentAt: number }[]>([]);
  const [showPlayersModal, setShowPlayersModal] = useState(false);
  // Drawer-only in-canvas reference overlay; visible by default each turn,
  // dismissable via its ✕ button. The "🖼️ 다시 띄우기" button in the
  // status bar restores it after dismissal.
  const [desktopOverlayVisible, setDesktopOverlayVisible] = useState(true);
  // Very-small-viewport reference image popup (instead of the in-canvas
  // overlay, which doesn't fit on tiny screens).
  const [showCardImage, setShowCardImage] = useState(false);
  // Position of the drawer reference-image overlay inside the canvas. Drawer
  // can drag the small handle bar at the top to reposition it.
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number }>({ top: 8, left: 8 });
  const overlayDragRef = useRef<{ startX: number; startY: number; origTop: number; origLeft: number; pointerId: number } | null>(null);
  // Pointer-event-based drag so the handle works for both mouse (desktop)
  // and touch (phone/iPad). setPointerCapture keeps the move/up events
  // routed to the handle even if the finger drifts off it.
  const handleOverlayDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origTop: overlayPos.top,
      origLeft: overlayPos.left,
      pointerId: e.pointerId,
    };
  };
  const handleOverlayDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = overlayDragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // In MLD-rotated mode the canvas wrapper is CSS-rotated 90° CW, so a
    // screen-x delta is actually a canvas-Y delta and vice versa. Un-rotate
    // the pointer deltas back into the canvas's logical frame before
    // updating overlayPos (which is itself in pre-rotation CSS pixels).
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    const dxLogical = mldRotated ? dyScreen : dxScreen;
    const dyLogical = mldRotated ? -dxScreen : dyScreen;
    // Clamp to canvas bounds — previously only the top-left was clamped
    // (Math.max 0), so the overlay could drift past the canvas's right
    // edge into the chat column.
    const cv = containerRef.current;
    const overlayEl = e.currentTarget.parentElement as HTMLElement | null;
    let nextTop = d.origTop + dyLogical;
    let nextLeft = d.origLeft + dxLogical;
    nextTop = Math.max(0, nextTop);
    nextLeft = Math.max(0, nextLeft);
    if (cv && overlayEl) {
      const cvR = cv.getBoundingClientRect();
      const ovR = overlayEl.getBoundingClientRect();
      // getBoundingClientRect returns the post-transform AABB; when the
      // parent is rotated, swap width<->height to get logical (pre-rotation)
      // dimensions so clamping is computed in the same frame as overlayPos.
      const cvW = mldRotated ? cvR.height : cvR.width;
      const cvH = mldRotated ? cvR.width : cvR.height;
      const ovW = mldRotated ? ovR.height : ovR.width;
      const ovH = mldRotated ? ovR.width : ovR.height;
      const maxLeft = Math.max(0, cvW - ovW);
      const maxTop = Math.max(0, cvH - ovH);
      nextLeft = Math.min(nextLeft, maxLeft);
      nextTop = Math.min(nextTop, maxTop);
    }
    setOverlayPos({ top: nextTop, left: nextLeft });
  };
  const handleOverlayDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (overlayDragRef.current?.pointerId === e.pointerId) {
      overlayDragRef.current = null;
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  // Reference-image overlay resize. CSS `resize: both` was the only way
  // to scale the box, but iOS/iPadOS Safari can't trigger that with
  // touch — the handle accepts only mouse drags. We add a pointer-event
  // handle at the bottom-right corner so iPad users can resize too.
  // Ratio is stored as fraction of canvas width (0.1 ~ 0.8).
  const [overlayWidthRatio, setOverlayWidthRatio] = useState(0.3);
  const overlayResizeRef = useRef<{ startX: number; startY: number; startRatio: number; canvasW: number; pointerId: number } | null>(null);
  const handleOverlayResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cvR = containerRef.current?.getBoundingClientRect();
    // Logical canvas width = BCR.height when the parent is CSS-rotated CW,
    // since BCR returns the post-transform AABB.
    const canvasW = mldRotated ? (cvR?.height || 1) : (cvR?.width || 1);
    overlayResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRatio: overlayWidthRatio,
      canvasW,
      pointerId: e.pointerId,
    };
  };
  const handleOverlayResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = overlayResizeRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    // Rotation un-mapping mirrors the drag handler: screen-Y delta is the
    // canvas-frame X delta when MLD is rotated. Without this the resize
    // felt inverted on phones — dragging right shrunk, dragging left grew.
    const dx = mldRotated ? (e.clientY - r.startY) : (e.clientX - r.startX);
    const next = Math.max(0.1, Math.min(0.8, r.startRatio + dx / r.canvasW));
    setOverlayWidthRatio(next);
  };
  const handleOverlayResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (overlayResizeRef.current?.pointerId === e.pointerId) {
      overlayResizeRef.current = null;
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  // Guesser-only card lookup modal — search/UI lives in the shared
  // <CardSearchModal>; this just toggles its visibility.
  const [showCardSearch, setShowCardSearch] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  // "Guess-while-keyboard-open" compact mode: when a non-drawer focuses the
  // chat input on phone, we mount a top-pinned mini canvas (using the same
  // strokeBuf as the main canvas) so they can keep seeing the drawing while
  // typing. Drawer doesn't get this — they're drawing, not chatting.
  const [, setChatFocused] = useState(false);
  const [vv, setVv] = useState<{ height: number; offsetTop: number }>(() => ({
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    offsetTop: 0,
  }));
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const visualViewport = window.visualViewport;
    const update = () => setVv({ height: visualViewport.height, offsetTop: visualViewport.offsetTop });
    visualViewport.addEventListener("resize", update);
    visualViewport.addEventListener("scroll", update);
    update();
    return () => {
      visualViewport.removeEventListener("resize", update);
      visualViewport.removeEventListener("scroll", update);
    };
  }, []);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniContainerRef = useRef<HTMLDivElement>(null);
  const [miniDims, setMiniDims] = useState({ w: 400, h: 250 });

  const amDrawer = !!(
    drawing
    && drawing.drawer_id
    && selfPlayerId != null
    && String(selfPlayerId) === drawing.drawer_id
  );
  // "Mobile drawing focus" mode: on phones (NOT tablets) the chat panel +
  // player strip collapse out so the canvas can fill the entire viewport
  // while it's the viewer's turn to draw. In portrait the layout is
  // CSS-rotated 90° CW so the canvas always presents itself as landscape
  // (user rotates phone CCW to view it naturally). `useIsPhone` keys off
  // the short viewport side, so it stays true through a rotation — the
  // landscape canvas doesn't snap back to the small layout.
  // Treats iPad portrait the same as phone portrait per user spec — the
  // compact/MLD UX is engaged on any narrow portrait viewport.
  const isPhone = useIsCompactPortrait();
  const orientation = useOrientation();
  // Mobile fullscreen drawing mode (MLD = rotated portrait → landscape).
  // Default OFF — some users find rotating the phone uncomfortable. The
  // drawer opts in via the 📱 button in the status bar; the normal page
  // layout stays the default. Session-only state (resets on reload).
  const [fullscreenDrawing, setFullscreenDrawing] = useState(false);
  const isMLD = amDrawer && !!drawing && isPhone && fullscreenDrawing;
  // CSS rotation only fires when the phone is held in portrait. Landscape
  // already maps to the layout's natural axes — rotating again would
  // double-rotate and feel wrong.
  const mldRotated = isMLD && orientation === "portrait";

  // Guess-compact mode — the default mobile layout whenever the user
  // ISN'T actively drawing themselves. Always-on for phones outside MLD
  // so the chat + buttons stay reachable through choosing/reveal/idle
  // states too (the mini canvas inside only mounts when a drawing turn
  // is live, otherwise that space goes to chat).
  // Compact guessing UI is for everyone on mobile EXCEPT the drawer when
  // they're actively drawing (they need palette + canvas, which lives in
  // the desktop branch). With the fullscreen-drawing toggle off, mobile
  // drawer falls into the desktop layout — that's where the 📱 enter-
  // fullscreen button lives.
  const isCompactGuessing = isPhone && !isMLD && !(amDrawer && !!drawing);
  // Height of the soft keyboard (or zero when closed) — derived from the
  // visualViewport position so the fixed chat input lands flush against
  // the keyboard's top edge instead of bouncing through the browser's
  // auto-scroll-into-view dance.
  const keyboardOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  // Robust "keyboard is up" detection — visualViewport shrinkage works
  // on iOS Safari but not always on Android Chrome (the layout viewport
  // shrinks too, so window.innerHeight - vv.height ≈ 0). Fall back to
  // checking whether an input or textarea owns focus.
  const [focusedInputActive, setFocusedInputActive] = useState(false);
  useEffect(() => {
    const check = () => {
      const ae = document.activeElement;
      const tag = ae?.tagName || "";
      setFocusedInputActive(tag === "INPUT" || tag === "TEXTAREA");
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  // iPadOS Safari often leaves `visualViewport.offsetTop` (and sometimes
  // `height`) stale after the soft keyboard dismisses — the visualViewport
  // `resize`/`scroll` events fail to fire on blur, so the fixed-positioned
  // compact-view overlays stay anchored to keyboard-up coordinates and the
  // natural-flow canvas behind them peeks through as a ghost band.
  //
  // Strategy: trust `focusedInputActive` (which DOES flip reliably via
  // focusin/focusout) as the source of truth. When no input is focused,
  // force vv state to fresh "no keyboard" values regardless of what
  // visualViewport reports — iPadOS may never get around to firing the
  // event, but we KNOW the keyboard is going away because the input lost
  // focus. Once focus returns, the listener picks up the real values
  // again.
  const keyboardLikelyOpen = focusedInputActive;
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    if (!focusedInputActive) {
      setVv({ height: window.innerHeight, offsetTop: 0 });
    } else {
      const vp = window.visualViewport;
      const pull = () => setVv({ height: vp.height, offsetTop: vp.offsetTop });
      pull();
      const t1 = setTimeout(pull, 250);
      const t2 = setTimeout(pull, 500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [focusedInputActive]);
  const safeOffsetTop = keyboardLikelyOpen ? vv.offsetTop : 0;
  const safeKeyboardOffset = keyboardLikelyOpen ? keyboardOffset : 0;
  // Compact-mode layout constants. Top status strip is always shown
  // (drawing or not); the mini canvas only takes its slot during a live
  // drawing turn. The two together drive where the chat history starts.
  const compactStatusH = 36;
  // Icon-only player strip — fits below the status row when there's
  // room, hides when the soft keyboard is up so chat reclaims that
  // ~44px back instead of compressing further.
  const compactPlayerStripH = isCompactGuessing && !keyboardLikelyOpen ? 44 : 0;
  // Mini canvas slot is ALWAYS reserved while compact is active so the
  // layout doesn't reflow between phases or during the brief window
  // after a refresh while state events are still arriving from the
  // server. Strokes get filled in whenever they exist; otherwise the
  // canvas just renders empty white.
  const showCompactMiniCanvas = isCompactGuessing;
  // Mini canvas sizing.
  //   Idle (keyboard down): prefer width-derived height (1.6:1 box at full
  //     viewport width). On iPad portrait this gives a roomy ~640px-tall
  //     canvas; on phone it gives a ~234px strip, both with no gray sides.
  //   Keyboard up: aggressive cap (~35% of visualViewport.height) so chat
  //     keeps useful real estate. Canvas shrinks → gray bars appear on
  //     the sides (user accepts the trade — they're typing, not staring
  //     at the drawing).
  const miniContentW = typeof window === "undefined" ? 360 : window.innerWidth;
  const widthDerivedMiniH = miniContentW / 1.6;
  // When the keyboard is down we don't trust vv.height (iPadOS sometimes
  // leaves it stale at the shrunken value), so use window.innerHeight as a
  // bigger-of fallback. With keyboard up, vv.height IS what we want
  // (visualViewport reliably shrinks on focusin).
  const stableHeight = keyboardLikelyOpen ? vv.height : Math.max(vv.height, window.innerHeight);
  const maxMiniBoxH = keyboardLikelyOpen
    ? Math.max(80, stableHeight * 0.35)
    : Math.max(160, stableHeight * 0.6);
  const miniBoxH = showCompactMiniCanvas ? Math.min(widthDerivedMiniH, maxMiniBoxH) : 0;
  const miniBoxW = miniBoxH * 1.6;
  const miniHeight = miniBoxH;
  // Lock the page while compact mode is active so the browser can't
  // auto-scroll the canvas off-screen. The mini overlay + fixed input
  // both reference visualViewport coords directly.
  useEffect(() => {
    if (!isCompactGuessing) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      h: html.style.overflow,
      b: body.style.overflow,
      p: body.style.position,
      i: body.style.inset,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.inset = "0";
    return () => {
      html.style.overflow = prev.h;
      body.style.overflow = prev.b;
      body.style.position = prev.p;
      body.style.inset = prev.i;
    };
  }, [isCompactGuessing]);

  // Resize observer for the mini canvas — DPR-scaled like the main one.
  useEffect(() => {
    if (!isCompactGuessing) return;
    const el = miniContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      // Mini canvas is a passive viewer (non-drawer), so we cap DPR at 2
      // even on DPR=3 phones. Visually nearly identical, but halves the
      // bitmap area → faster fullReplay on stroke end (the big mobile
      // hotspot) and lighter GPU work for `fill`-heavy brushes.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(160, Math.floor(r.width));
      const cssH = Math.max(100, Math.floor(r.height));
      setMiniDims({ w: Math.floor(cssW * dpr), h: Math.floor(cssH * dpr) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isCompactGuessing]);

  // Replay the full stroke buffer onto the mini canvas whenever it
  // (re)mounts or resizes, and incrementally on each new stroke event so
  // the mini stays live with the main canvas without round-tripping
  // through React state.
  useEffect(() => {
    if (!isCompactGuessing) return;
    const cv = miniCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const fullReplay = () => dmReplayStrokes(ctx, cv.width, cv.height, strokeBufRef.current, {
      curve: pressureCurveRef.current,
    });
    fullReplay();

    // The old code did `fullReplay()` on every dm-add-stroke event, which
    // with the new perfect-freehand engine costs O(stroke_length) per
    // event — at 120Hz pointer × 200-point strokes that's enough to peg
    // a phone CPU mid-game and freeze the page. We now do cheap O(1)
    // line-segment rendering during the active stroke (acceptable visual
    // approximation), then do one rAF-throttled fullReplay on stroke
    // `end` to upgrade the just-finished stroke to perfect-freehand
    // variable-width. Fill ops still need a full replay.
    let scheduledFullReplay = false;
    const scheduleFullReplay = () => {
      if (scheduledFullReplay) return;
      scheduledFullReplay = true;
      requestAnimationFrame(() => {
        scheduledFullReplay = false;
        fullReplay();
      });
    };

    // Per-stroke transient state for the incremental path.
    let activeColor = "#000000";
    let activeSize = 4;
    let activeTool: "pen" | "eraser" = "pen";
    let lastPoint: { x: number; y: number } | null = null;

    const onStroke = (e: Event) => {
      const detail = (e as CustomEvent).detail as DmStrokePayload | undefined;
      if (!detail) { scheduleFullReplay(); return; }
      if (detail.op === "fill") { scheduleFullReplay(); return; }
      if (detail.op === "start") {
        activeColor = detail.color || "#000000";
        activeSize = detail.size || 4;
        activeTool = (detail.tool === "fill" ? "pen" : detail.tool) || "pen";
        lastPoint = { x: detail.x * cv.width, y: detail.y * cv.height };
        // Seed dot — cheap.
        ctx.save();
        ctx.fillStyle = activeTool === "eraser" ? "#ffffff" : activeColor;
        const r = activeSize * (cv.width / DM_BRUSH_REF_WIDTH) / 2;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      if (detail.op === "move" && lastPoint) {
        const x = detail.x * cv.width;
        const y = detail.y * cv.height;
        ctx.save();
        ctx.strokeStyle = activeTool === "eraser" ? "#ffffff" : activeColor;
        ctx.lineWidth = activeSize * (cv.width / DM_BRUSH_REF_WIDTH);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
        lastPoint = { x, y };
        return;
      }
      if (detail.op === "end") {
        lastPoint = null;
        // Upgrade just-finished stroke to perfect-freehand look (rAF
        // throttled so back-to-back ends collapse to one redraw).
        scheduleFullReplay();
        return;
      }
    };

    const onClear = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      lastPoint = null;
    };
    window.addEventListener("dm-add-stroke", onStroke);
    window.addEventListener("dm-clear-canvas", onClear);
    return () => {
      window.removeEventListener("dm-add-stroke", onStroke);
      window.removeEventListener("dm-clear-canvas", onClear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompactGuessing, miniDims]);

  // Hide site chrome (navbar / footer / mobile bottom bar) while it's our
  // turn to draw — applies on desktop too, not just the MLD phone layout.
  useEffect(() => {
    setDrawingMode(amDrawer && !!drawing);
    return () => setDrawingMode(false);
  }, [amDrawer, drawing]);

  // Toast queue (MLD-only): we surface `correct` and `given_up` chat events
  // here because the chat panel is hidden while drawing in landscape.
  const [mldToasts, setMldToasts] = useState<{ id: number; text: string; tone: "correct" | "give_up" }[]>([]);
  const lastToastIndexRef = useRef<number>(chatLog.length);
  useEffect(() => {
    if (!isMLD) {
      // Reset baseline so leaving and re-entering MLD doesn't replay old events.
      lastToastIndexRef.current = chatLog.length;
      return;
    }
    const fromIdx = lastToastIndexRef.current;
    const fresh = chatLog.slice(fromIdx).filter((m: any) => m?.kind === "correct" || m?.kind === "given_up");
    lastToastIndexRef.current = chatLog.length;
    if (fresh.length === 0) return;
    const stamp = Date.now();
    setMldToasts((prev) => [
      ...prev,
      ...fresh.map((m: any, i: number) => ({
        id: stamp + i,
        tone: m.kind === "correct" ? "correct" as const : "give_up" as const,
        text: m.kind === "correct"
          ? `${m.display_name || "익명"} 정답!`
          : `${m.display_name || "익명"} 포기`,
      })),
    ]);
  }, [chatLog, isMLD]);
  // Auto-fade individual toasts after 3.5s.
  useEffect(() => {
    if (mldToasts.length === 0) return;
    const oldest = mldToasts[0];
    const t = setTimeout(() => {
      setMldToasts((prev) => prev.filter((x) => x.id !== oldest.id));
    }, 3500);
    return () => clearTimeout(t);
  }, [mldToasts]);

  // Chat modal (MLD-only) + unread counter.
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const lastSeenChatLenRef = useRef<number>(chatLog.length);
  useEffect(() => {
    if (!isMLD || chatModalOpen) {
      lastSeenChatLenRef.current = chatLog.length;
      setChatUnread(0);
      return;
    }
    const grew = chatLog.length - lastSeenChatLenRef.current;
    if (grew > 0) setChatUnread((u) => u + grew);
    lastSeenChatLenRef.current = chatLog.length;
  }, [chatLog, isMLD, chatModalOpen]);

  // Hard-lock viewport scroll for ANY mobile drawer — the MLD rotated full-
  // screen AND the regular portrait drawer who didn't tap 📱 전체화면. The
  // earlier gate (`isMLD` only) left a gap: the non-MLD portrait drawer had
  // no scroll lock, so a stroke drifting past the canvas edge yanked the
  // page. position:fixed on body + overflow:hidden on html stops rubber-band
  // bounce and accidental scroll from canvas pointer events.
  useEffect(() => {
    if (!(amDrawer && !!drawing && isPhone)) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevBodyPos = body.style.position;
    const prevBodyInset = body.style.inset;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.inset = "0";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      body.style.position = prevBodyPos;
      body.style.inset = prevBodyInset;
    };
  }, [amDrawer, drawing, isPhone]);
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

  // Who's drawing next. The server sends `drawer_order` + `turn_index`
  // with each dm_choosing / dm_drawing event; we derive the next-in-line
  // by indexing the rotation. The earlier per-player "#N" badge was
  // dropped because users read "#" as a ranking — instead we now mark
  // just the upcoming drawer in the player list, which is what people
  // actually wanted to know ("who's next?").
  const drawerOrderArr = drawing?.drawer_order ?? choosing?.drawer_order ?? [];
  const currentTurnIdx = drawing?.turn_index ?? choosing?.turn_index ?? -1;
  const nextDrawerId = (() => {
    if (drawerOrderArr.length === 0) return null;
    // During an active turn the drawer at turn_index is currently drawing;
    // "next" is the one immediately after. Wraps around at end of round.
    const ni = (currentTurnIdx + 1) % drawerOrderArr.length;
    return drawerOrderArr[ni] ?? null;
  })();
  const isNextDrawer = (playerId: string | number): boolean => {
    return nextDrawerId != null && String(playerId) === String(nextDrawerId);
  };

  // Match canvas intrinsic resolution to its actual displayed size so the
  // bitmap is crisp at any breakpoint. Display sizing is now CSS-driven —
  // mobile uses `w-full` (height auto via canvas aspect attrs), lg+ uses
  // `aspect-[1.6/1] max-w-full max-h-full` so the canvas fits any column
  // height without clipping the palette below it. The observer just
  // measures whatever the layout settled on and feeds it back.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        // Scale the bitmap buffer by device pixel ratio so the canvas
        // draws at the screen's physical resolution — without this, a
        // 400px-CSS-wide canvas on a 3x-DPR phone displays a 400px
        // buffer upscaled to 1200 physical pixels, which is what was
        // showing up as the staircase jaggies on mobile strokes. Cap at
        // 2 to keep memory + GPU work bounded (4x area at DPR=2 is a
        // big enough leap; DPR=3 phones still look noticeably crisper).
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const cssW = Math.max(200, Math.floor(r.width));
        const cssH = Math.max(150, Math.floor(r.height || r.width * 0.625));
        setCanvasDims({ w: Math.floor(cssW * dpr), h: Math.floor(cssH * dpr) });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // isMLD swap unmounts one canvas wrapper and mounts another — the
    // existing observer would silently keep watching the orphaned node
    // (and canvas dims stayed stuck at the MLD-shape long after the round
    // ended). Re-running on isMLD re-attaches to the live containerRef.
  }, [isMLD]);

  // Reset pinch-zoom on any layout change (MLD swap or canvas resize) so the
  // transform anchor can't go stale against the new layout.
  useEffect(() => {
    zoomRef.current = { scale: 1, tx: 0, ty: 0 };
    gestureActiveRef.current = false;
    gestureRef.current = null;
    touchPointersRef.current.clear();
    setZoomBadgeOn(false);
    const zt = zoomTargetRef.current;
    if (zt) zt.style.transform = "";
  }, [isMLD, canvasDims.w, canvasDims.h]);

  // Replay a stroke buffer onto an arbitrary canvas context. Thin wrapper
  // around the shared renderer so the mini canvas, post-reconnect main
  // canvas, and stored-drawing replays all go through the same path.
  const replayBufferTo = (
    ctx: CanvasRenderingContext2D, w: number, h: number, buf: DmStrokePayload[],
  ) => {
    dmReplayStrokes(ctx, w, h, buf, { curve: pressureCurveRef.current });
  };

  // Render strokes from buffer onto the main canvas + clear the overlay so
  // any in-progress stroke doesn't ghost across redraws.
  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    replayBufferTo(ctx, cv.width, cv.height, strokeBufRef.current);
    const ov = overlayRef.current;
    if (ov) {
      const oc = ov.getContext("2d");
      oc?.clearRect(0, 0, ov.width, ov.height);
    }
    activeStrokeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-shot retry for card/illustration images that occasionally come
  // back as broken (transient nginx hiccup or media-cache miss). Adds a
  // cache-buster query and re-assigns src once; subsequent errors fall
  // through to the broken-image icon so we don't loop forever.
  const onImgErrorRetry = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.retried) return;
    img.dataset.retried = "1";
    const src = img.src || "";
    if (!src) return;
    img.src = src + (src.includes("?") ? "&" : "?") + "_retry=" + Date.now();
  };

  // Shared chat row renderer — used both inline in the right-side chat
  // panel AND in the compact-guess overlay so the two views look identical
  // (avatars, spectator coloring, "정답!" green pill, solved red dot,
  // restricted_to_solved spoiler hiding, etc).
  // O(1) display_name → player lookup, refreshed when the players prop ref
  // changes. Matches `players.find` semantics (first-match wins) for the
  // rare case of duplicate display_names.
  const playersByName = useMemo(() => {
    const map = new Map<string, DmPlayerLite>();
    for (const p of players) {
      if (!map.has(p.display_name)) map.set(p.display_name, p);
    }
    return map;
  }, [players]);
  // Same value for every chat row, so compute once instead of per-row.
  const iAmSolvedNow = useMemo(() => {
    const myId = selfPlayerId != null
      ? String(selfPlayerId)
      : (playersByName.get(selfDisplayName ?? "")?.id?.toString() || "");
    return !!myId && correctGuesserIds.has(myId);
  }, [selfPlayerId, selfDisplayName, playersByName, correctGuesserIds]);
  const renderPendingRow = (p: { tempId: number; text: string }) => {
    const sender = selfPlayerId != null
      ? players.find((pp) => pp.id === selfPlayerId)
      : players.find((pp) => pp.display_name === selfDisplayName);
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
  };

  // Redraw on canvas resize
  useEffect(() => { redraw(); }, [canvasDims, redraw]);
  // Catch-up redraw when the user transitions OUT of compact view —
  // drawIncrement was skipped during compact mode, so the main+overlay
  // canvases are blank/stale and need a one-shot full replay from the
  // (correctly maintained) strokeBufRef.
  useEffect(() => {
    if (!isCompactGuessing) redraw();
  }, [isCompactGuessing, redraw]);

  // When server sends a replay (reconnect / undo), reset buffer
  useEffect(() => {
    if (replayStrokes !== undefined) {
      strokeBufRef.current = [...replayStrokes];
      redraw();
      // Also refresh the compact mini canvas if it's mounted — without
      // this, refreshing during reveal showed an empty mini even though
      // the server had just replayed the drawing into strokeBufRef.
      const mini = miniCanvasRef.current;
      if (mini) {
        const ctx = mini.getContext("2d");
        if (ctx) replayBufferTo(ctx, mini.width, mini.height, strokeBufRef.current);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Also wipe the compact-view mini canvas — it has its own bitmap
      // and is only auto-refreshed on dm-add-stroke / dm-clear-canvas
      // events, neither of which fire on a local turn-key flip. Without
      // this, mobile/iPad-portrait viewers kept the previous turn's
      // drawing visible until the next stroke arrived.
      const mini = miniCanvasRef.current;
      if (mini) {
        const mctx = mini.getContext("2d");
        if (mctx) {
          mctx.fillStyle = "#ffffff";
          mctx.fillRect(0, 0, mini.width, mini.height);
        }
      }
      setDesktopOverlayVisible(true);
      // Stale stroke state from a previous turn must not bleed into the
      // new canvas. Drop active flags + any pointerCapture left on the
      // canvas element (release loop covers all currently-captured ids).
      drawingActiveRef.current = false;
      activePointerIdRef.current = null;
      staleUpsToIgnoreRef.current = 0;
      lastPosRef.current = null;
      const cv = canvasRef.current;
      const ov = overlayRef.current;
      for (const el of [cv, ov]) {
        if (!el) continue;
        // Release whatever pointer ids the canvas currently has captured.
        // setPointerCapture/releasePointerCapture is per-pointerId and
        // there's no list API, so we sweep a small range — every active
        // id we'd realistically have on a canvas (mouse=1, primary touch=2,
        // multi-finger up to ~10).
        for (let id = 0; id < 16; id++) {
          try { if (el.hasPointerCapture(id)) el.releasePointerCapture(id); } catch {}
        }
      }
      // Reset palette state so the previous turn's tool/brush/color choice
      // doesn't carry over (e.g. stuck-in-eraser-mode complaint).
      setTool("pen");
      setBrushSize(getDefaultBrushSize());
      setColor("#000000");
      // Suppress canvas pointerdown for ~300ms so the modal click's
      // trailing pointer event doesn't auto-start a stroke.
      pointerIgnoreUntilRef.current = Date.now() + 300;
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

  // Capture the canvas snapshot once per turn when reveal lands. Dedup'd
  // by drawer + word + first stroke timestamp so a mid-game reconnect
  // (which re-fires reveal) doesn't duplicate. The parent collects
  // these into the end-of-game gallery.
  const lastCapturedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal || !onTurnCaptured) return;
    const key = `${reveal.drawer_id}-${reveal.word}-${(strokeBufRef.current[0] as any)?.x ?? "x"}-${(strokeBufRef.current[0] as any)?.y ?? "y"}`;
    if (lastCapturedKeyRef.current === key) return;
    lastCapturedKeyRef.current = key;
    const cv = canvasRef.current;
    if (!cv) return;
    let drawingDataUrl = "";
    try { drawingDataUrl = cv.toDataURL("image/png"); } catch { /* CORS / blank canvas */ }
    if (!drawingDataUrl) return;
    const drawer = players.find((p) => String(p.id) === String(reveal.drawer_id));
    onTurnCaptured({
      id: key,
      word: reveal.word,
      drawerId: String(reveal.drawer_id),
      drawerName: drawer?.display_name || "익명",
      drawerAvatarIcon: drawer?.avatar_icon ?? null,
      drawerBorder: drawer?.border ?? null,
      drawingDataUrl,
      cardImageUrl: reveal.image_url ?? null,
      capturedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

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

  // Auto-scroll behavior (Discord/Slack-style):
  //   - User scrolls up → unpin (leave them reading history).
  //   - User scrolls back to bottom → re-pin.
  //   - While pinned, a ResizeObserver on the chat content keeps us at
  //     the bottom whenever its height grows — handles multi-line
  //     wrapping, image loads, late reflow that the old
  //     `useLayoutEffect[chatLog.length]` was missing. (Setting scrollTop
  //     from that effect ran before wrapping reflow finished, leaving us
  //     ~one line off bottom → the scroll handler then unpinned us.)
  const [chatPinnedToBottom, setChatPinnedToBottom] = useState(true);
  const pinnedRef = useRef(true);
  useEffect(() => { pinnedRef.current = chatPinnedToBottom; }, [chatPinnedToBottom]);
  useEffect(() => {
    const el = chatScrollRef.current;
    const content = chatContentRef.current;
    if (!el || !content) return;
    const snap = () => { if (pinnedRef.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(snap);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  // Explicit scroll trigger on each new chat message. The ResizeObserver
  // alone misses the at-cap case: with stable uid keys, an arriving message
  // unmounts the oldest row and mounts the new one in the same frame, so
  // the observed content height comes out unchanged and the observer
  // doesn't fire. Use the trailing uid as the dep — fires once per arrival.
  const lastChatUid = chatLog.length > 0 ? chatLog[chatLog.length - 1]._uid : undefined;
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lastChatUid]);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // Tolerance ≈ one wrapped row so subpixel reflow doesn't unpin us.
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setChatPinnedToBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const scrollChatToBottom = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setChatPinnedToBottom(true);
  };

  // Compact chat: same pinned-to-bottom + content ResizeObserver pattern
  // as the main chat panel. Tracked independently so scrolling one
  // doesn't fight the other when both happen to be mounted.
  const [compactChatPinned, setCompactChatPinned] = useState(true);
  const compactPinnedRef = useRef(true);
  useEffect(() => { compactPinnedRef.current = compactChatPinned; }, [compactChatPinned]);
  useEffect(() => {
    if (!isCompactGuessing) return;
    const el = compactChatScrollRef.current;
    const content = compactChatContentRef.current;
    if (!el || !content) return;
    // Snap to bottom on initial mount + any time content grows while pinned.
    el.scrollTop = el.scrollHeight;
    const snap = () => { if (compactPinnedRef.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(snap);
    ro.observe(content);
    return () => ro.disconnect();
  }, [isCompactGuessing]);
  // Explicit scroll trigger on each new chat message — see the main panel's
  // version above for the rationale.
  useEffect(() => {
    if (!isCompactGuessing) return;
    const el = compactChatScrollRef.current;
    if (el && compactPinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lastChatUid, isCompactGuessing]);
  useEffect(() => {
    if (!isCompactGuessing) return;
    const el = compactChatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setCompactChatPinned(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isCompactGuessing]);
  // Re-snap to bottom when the container itself resizes — keyboard open/
  // close shrinks/grows the chat strip, and the browser preserves
  // scrollTop on size change, which makes a pinned-at-bottom view look
  // like it jumped to the top once the container shortened.
  useEffect(() => {
    if (!isCompactGuessing) return;
    const el = compactChatScrollRef.current;
    if (!el) return;
    if (compactPinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [isCompactGuessing, keyboardOffset, miniHeight, compactPlayerStripH]);

  // Brush preview cursor — small ring that follows the pointer while the
  // drawer is interacting with the canvas. Shows the brush radius so the
  // user can tell exactly where the next stroke will land + how thick it
  // will be (especially helpful on phones where the finger covers the
  // strike point). Position is in canvas-LOCAL CSS px so it inherits any
  // parent CSS rotation cleanly.

  // Active stroke (in-progress) buffer. One shared between the local drawer
  // path (pointer events) and the remote-replay path (dm-add-stroke events)
  // — only one stroke is ever active at a time on this canvas. Holds
  // stabilizer-applied points so the overlay can be re-rendered every move
  // via perfect-freehand with consistent variable-width tapering.
  const activeStrokeRef = useRef<{
    stabilized: StrokePoint[];
    color: string;
    brush: BrushKind;
    tool: "pen" | "eraser";
    size: number;
    stab: StabilizerLevel;
  } | null>(null);

  // rAF coalescing — pointermove on iPad Pro / modern Android can fire up
  // to 240Hz, but we only need one paint per frame. Points are still
  // collected from every event (so the wire keeps full precision); only
  // the overlay paint is throttled. Big perf win on mobile, no
  // perceptible difference (60fps is still smooth).
  const renderScheduledRef = useRef<number | null>(null);
  const scheduleOverlayRender = () => {
    if (renderScheduledRef.current !== null) return;
    renderScheduledRef.current = requestAnimationFrame(() => {
      renderScheduledRef.current = null;
      renderActiveStrokeToOverlay();
    });
  };
  const flushOverlayRender = () => {
    if (renderScheduledRef.current !== null) {
      cancelAnimationFrame(renderScheduledRef.current);
      renderScheduledRef.current = null;
    }
    renderActiveStrokeToOverlay();
  };

  const renderActiveStrokeToOverlay = () => {
    const ov = overlayRef.current;
    const s = activeStrokeRef.current;
    if (!ov) return;
    const oc = ov.getContext("2d");
    if (!oc) return;
    oc.clearRect(0, 0, ov.width, ov.height);
    if (!s || s.stabilized.length === 0) return;
    const pixelSize = s.size * (ov.width / DM_BRUSH_REF_WIDTH);
    dmRenderStroke(oc, s.stabilized, {
      brush: s.brush,
      tool: s.tool,
      color: s.color,
      pixelSize,
      curve: pressureCurveRef.current,
      isPenDown: true,
    });
  };

  const commitActiveStrokeToMain = () => {
    const cv = canvasRef.current;
    const ov = overlayRef.current;
    if (!cv || !ov) return;
    const mc = cv.getContext("2d");
    if (!mc) return;
    mc.drawImage(ov, 0, 0);
    const oc = ov.getContext("2d");
    oc?.clearRect(0, 0, ov.width, ov.height);
    activeStrokeRef.current = null;
  };

  /** Per-payload incremental render. Used by both the local drawer
   *  (their own pointer events) and remote viewers (wire events
   *  dispatched through the dm-add-stroke window event). Re-applies the
   *  drawer-chosen stabilizer (carried on the "start" payload) so all
   *  clients render identical pixels. */
  const drawIncrement = (p: DmStrokePayload) => {
    // Skip the hidden main + overlay canvas work when the compact-view
    // mini canvas owns the visible drawing. Otherwise every received
    // stroke point burns perfect-freehand cycles on canvases nobody
    // sees — the dominant source of mobile lag during long games.
    // strokeBufRef is already populated by the caller, so transitioning
    // out of compact view (e.g., role change) recovers via the
    // canvasDims-driven redraw effect.
    if (isCompactGuessing) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    if (p.op === "fill") {
      dmFloodFill(
        ctx, cv.width, cv.height,
        Math.floor(p.x * cv.width), Math.floor(p.y * cv.height),
        p.color || "#000000",
      );
      return;
    }
    if (p.op === "start") {
      // If the previous stroke wasn't terminated (e.g. drawer disconnect),
      // commit it before starting a new one so it isn't lost.
      if (activeStrokeRef.current) commitActiveStrokeToMain();
      const rawX = p.x * cv.width, rawY = p.y * cv.height;
      const rawP = p.pressure ?? 0.5;
      const stab = (p.stab ?? 0) as StabilizerLevel;
      const raw: StrokePoint = { x: rawX, y: rawY, pressure: rawP };
      const stabilized = dmStabilizePoint(null, raw, stab);
      activeStrokeRef.current = {
        stabilized: [stabilized],
        color: p.color || "#000000",
        brush: p.brush || "pen",
        tool: (p.tool === "fill" ? "pen" : p.tool) || "pen",
        size: p.size || 4,
        stab,
      };
      scheduleOverlayRender();
    } else if (p.op === "move") {
      const s = activeStrokeRef.current;
      if (!s) return;
      const raw: StrokePoint = {
        x: p.x * cv.width, y: p.y * cv.height,
        pressure: p.pressure ?? 0.5,
      };
      const prev = s.stabilized[s.stabilized.length - 1];
      s.stabilized.push(dmStabilizePoint(prev, raw, s.stab));
      scheduleOverlayRender();
    } else if (p.op === "end") {
      // Drain any pending rAF render before committing — otherwise the
      // overlay→main blit can miss the last batch of coalesced points.
      flushOverlayRender();
      commitActiveStrokeToMain();
    }
  };

  // Pointer events (drawer only).
  //
  // When the MLD container is CSS-rotated 90° CW (portrait phone), the
  // canvas's getBoundingClientRect is the post-transform AABB — naively
  // dividing clientX/Y by rect.width/height gives a *screen*-relative
  // normalized coord rather than the canvas's pre-rotation local coord.
  // The (x, y) → (y, 1-x) swap below undoes the rotation so strokes land
  // where the user's finger pointed.
  const normalizePointerCoords = (clientX: number, clientY: number, rect: DOMRect) => {
    if (mldRotated) {
      return {
        x: (clientY - rect.top) / rect.height,
        y: 1 - (clientX - rect.left) / rect.width,
      };
    }
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  /** PointerEvent.pressure is 0 for mouse and 0.5 for touch without
   *  pressure hardware (per spec). Treat 0 (mouse) as "no pressure" → mid
   *  0.5 so strokes don't vanish on desktop. Real pen / pressure touch
   *  passes through. */
  const extractPointerPressure = (e: React.PointerEvent): number => {
    if (e.pointerType === "mouse") return 0.5;
    if (e.pressure === 0) return 0.5;
    return e.pressure;
  };

  // ----- Two-finger pinch-zoom / pan (drawer, non-MLD layout only) -----
  // MLD (rotated full-screen) is already large, so it stays excluded. The
  // gesture writes its transform straight to zoomTargetRef — no re-render.

  /** Finalize the in-progress stroke as a normal (short) stroke — used when a
   *  second finger lands mid-draw. Unlike the solo game we can't silently drop
   *  it: every point was already streamed to the server, so we just send the
   *  matching "end" and let the partial mark stand. */
  const finalizeActiveStroke = () => {
    if (!drawingActiveRef.current) return;
    drawingActiveRef.current = false;
    activePointerIdRef.current = null;
    lastPosRef.current = null;
    const p: DmStrokePayload = { op: "end", x: 0, y: 0 };
    strokeBufRef.current.push(p);
    drawIncrement(p);
    onStroke(p);
    winCleanupRef.current?.();
  };

  /** Snapshot the gesture baseline: the untransformed origin + size of the
   *  zoom target (back-computed from its live, possibly-transformed rect) plus
   *  the current finger midpoint + spread. */
  const beginPinch = () => {
    const zt = zoomTargetRef.current;
    if (!zt) return;
    const pts = [...touchPointersRef.current.values()];
    if (pts.length < 2) return;
    const M = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const D = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const z = zoomRef.current;
    const rect = zt.getBoundingClientRect();
    // transformOrigin is "0 0", so the transformed top-left sits at O + (tx,ty).
    gestureRef.current = {
      O: { x: rect.left - z.tx, y: rect.top - z.ty },
      baseW: rect.width / z.scale,
      baseH: rect.height / z.scale,
      prevM: M,
      prevD: D,
    };
    gestureActiveRef.current = true;
    setZoomBadgeOn(true);
  };

  /** One pinch step: scale by the finger-spread ratio, anchored so the content
   *  under the finger midpoint stays put, then pan-clamp against the canvas
   *  frame so it can't be flung off-screen. Snaps back to identity near 1x. */
  const updatePinch = () => {
    const g = gestureRef.current;
    const zt = zoomTargetRef.current;
    if (!g || !zt) return;
    const pts = [...touchPointersRef.current.values()];
    if (pts.length < 2) return;
    const M = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const D = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const z = zoomRef.current;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let s = clamp(z.scale * (D / g.prevD), 1, 4);
    // Local (untransformed) content point that sat under the previous midpoint.
    const lx = (g.prevM.x - g.O.x - z.tx) / z.scale;
    const ly = (g.prevM.y - g.O.y - z.ty) / z.scale;
    let tx = M.x - g.O.x - s * lx;
    let ty = M.y - g.O.y - s * ly;
    if (s <= 1.02) {
      s = 1; tx = 0; ty = 0;   // fully zoomed out → recenter
    } else {
      const frame = containerRef.current?.getBoundingClientRect();
      if (frame) {
        // Keep the canvas covering the frame centre so it can't be lost.
        const cx = frame.left + frame.width / 2;
        const cy = frame.top + frame.height / 2;
        tx = clamp(tx, cx - g.O.x - s * g.baseW, cx - g.O.x);
        ty = clamp(ty, cy - g.O.y - s * g.baseH, cy - g.O.y);
      }
    }
    zoomRef.current = { scale: s, tx, ty };
    g.prevM = M;
    g.prevD = D;
    // Live badge readout — written straight to the DOM so the per-frame
    // pinch loop never triggers a React re-render.
    if (zoomNumRef.current) zoomNumRef.current.textContent = `${Math.round(s * 100)}%`;
    zt.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  /** Snap back to 100% — used by the corner zoom badge's tap handler. */
  const resetZoom = () => {
    zoomRef.current = { scale: 1, tx: 0, ty: 0 };
    const zt = zoomTargetRef.current;
    if (zt) zt.style.transform = "";
    setZoomBadgeOn(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!amDrawer) return;
    // Drop pointer events for the brief window after a turn flips —
    // see pointerIgnoreUntilRef above. Without this the word-choice
    // modal click would auto-start a stroke on the new canvas.
    if (Date.now() < pointerIgnoreUntilRef.current) return;

    // Pen takes priority. Stamp the lockout and drop any tracked touch points
    // + abort any gesture: on a tablet the palm resting on the screen fires
    // touch events that otherwise get mistaken for a pinch and lock the pen
    // out ("펜이 씹히는" regression).
    if (e.pointerType === "pen") {
      lastPenEventAtRef.current = Date.now();
      if (touchPointersRef.current.size > 0 || gestureActiveRef.current) {
        touchPointersRef.current.clear();
        gestureActiveRef.current = false;
        gestureRef.current = null;
      }
    }

    // Two-finger pinch-zoom / pan — non-rotated layout only. Gated behind the
    // pen-lockout window so a palm resting on the screen mid-drawing can't
    // register as a pinch. To pinch, lift the pen briefly then use two fingers.
    if (
      e.pointerType === "touch" && !isMLD &&
      Date.now() - lastPenEventAtRef.current >= PEN_LOCKOUT_MS
    ) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size >= 2) {
        finalizeActiveStroke();   // close out any one-finger stroke in progress
        beginPinch();
        return;
      }
    }
    if (gestureActiveRef.current) return;

    if (e.pointerType === "touch") {
      // Pen-only mode: touch always ignored. Otherwise apply the short
      // auto-lockout after recent pen use. Mouse is always allowed.
      if (penOnlyModeRef.current) return;
      if (Date.now() - lastPenEventAtRef.current < PEN_LOCKOUT_MS) return;
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const { x, y } = normalizePointerCoords(e.clientX, e.clientY, rect);
    if (tool === "fill") {
      const p: DmStrokePayload = { op: "fill", x, y, color, tool: "fill" };
      strokeBufRef.current.push(p);
      drawIncrement(p);
      onStroke(p);
      return;
    }
    // No setPointerCapture — on iOS Safari capturing a pen pointer can swallow
    // the NEXT pen pointerdown entirely, which kills fast consecutive strokes.
    // The overlay fills the canvas area, so moves still arrive without it.
    // Out-of-order events on fast consecutive strokes (e.g. drawing an X) can
    // deliver the previous stroke's pointerup AFTER this pointerdown. Finalize
    // any still-open stroke now so it's preserved + serialized on the wire,
    // then bind this one to its pointerId so a stale event from the previous
    // stroke can't cut it short.
    if (drawingActiveRef.current) {
      finalizeActiveStroke();
      // That stroke's pointerup is still in flight — mark it to be swallowed.
      staleUpsToIgnoreRef.current = Math.min(staleUpsToIgnoreRef.current + 1, 3);
    }
    drawingActiveRef.current = true;
    activePointerIdRef.current = e.pointerId;
    lastPosRef.current = { x, y };
    // Window-level fallback: an off-canvas release still ends the stroke.
    {
      const captureId = e.pointerId;
      const onWinEnd = (we: PointerEvent) => {
        if (we.pointerId !== captureId) return;
        if (drawingActiveRef.current) finalizeActiveStroke();
        winCleanupRef.current?.();
      };
      winCleanupRef.current?.();   // safety: clear any prior
      window.addEventListener("pointerup", onWinEnd);
      window.addEventListener("pointercancel", onWinEnd);
      winCleanupRef.current = () => {
        window.removeEventListener("pointerup", onWinEnd);
        window.removeEventListener("pointercancel", onWinEnd);
        winCleanupRef.current = null;
      };
    }
    const pressure = extractPointerPressure(e);
    const p: DmStrokePayload = {
      op: "start", x, y, color, size: brushSize, tool,
      pressure, brush: "pen", stab: stabilizerRef.current,
    };
    strokeBufRef.current.push(p);
    drawIncrement(p);
    onStroke(p);
  };

  /** Raw-PointerEvent variant of extractPointerPressure (for coalesced events,
   *  which the browser delivers as native PointerEvents, not React synthetic). */
  const extractPointerPressureRaw = (e: PointerEvent): number => {
    if (e.pointerType === "mouse") return 0.5;
    if (e.pressure === 0) return 0.5;
    return e.pressure;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gestureActiveRef.current) { updatePinch(); return; }
    }
    if (gestureActiveRef.current) return;
    if (!amDrawer || !drawingActiveRef.current) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    // Drain coalesced events so high-refresh-rate devices keep their full
    // stroke precision even though the canvas paint is rAF-throttled.
    const native = e.nativeEvent as PointerEvent;
    const events: PointerEvent[] = native.getCoalescedEvents
      ? native.getCoalescedEvents()
      : [native];
    if (events.length === 0) events.push(native);
    for (const ev of events) {
      const { x, y } = normalizePointerCoords(ev.clientX, ev.clientY, rect);
      const last = lastPosRef.current;
      if (last) {
        const dx = (x - last.x) * cv.width;
        const dy = (y - last.y) * cv.height;
        if (dx * dx + dy * dy < 1) continue;  // skip sub-pixel duplicate
      }
      lastPosRef.current = { x, y };
      const pressure = extractPointerPressureRaw(ev);
      const p: DmStrokePayload = { op: "move", x, y, pressure };
      strokeBufRef.current.push(p);
      drawIncrement(p);
      onStroke(p);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.delete(e.pointerId);
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      if (gestureActiveRef.current) {
        // A finger lifted: re-baseline if 2+ remain, else end the gesture.
        if (touchPointersRef.current.size >= 2) beginPinch();
        else {
          gestureActiveRef.current = false;
          gestureRef.current = null;
          if (zoomRef.current.scale <= 1.02) setZoomBadgeOn(false);
        }
        return;
      }
    }
    if (!amDrawer) return;
    if (!drawingActiveRef.current) return;
    // Swallow the straggler pointerup of a stroke already finalized by the
    // next pointerdown — otherwise it ends the stroke that's now live.
    if (staleUpsToIgnoreRef.current > 0) {
      staleUpsToIgnoreRef.current -= 1;
      try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch {}
      try { overlayRef.current?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    drawingActiveRef.current = false;
    activePointerIdRef.current = null;
    lastPosRef.current = null;
    const p: DmStrokePayload = { op: "end", x: 0, y: 0 };
    strokeBufRef.current.push(p);
    drawIncrement(p);
    onStroke(p);
    // Release capture from both canvases — handle both the legacy "captured
    // on the main canvas" case (pre-engine-rewrite buffer) and the new
    // "captured on the overlay" case so neither element ends up perma-
    // eating subsequent pointer events on the palette.
    const cv = canvasRef.current;
    const ov = overlayRef.current;
    if (cv) { try { cv.releasePointerCapture(e.pointerId); } catch {} }
    if (ov) { try { ov.releasePointerCapture(e.pointerId); } catch {} }
    winCleanupRef.current?.();
  };

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const t = chatInput.trim();
    if (!t) return;
    // Optimistic: render instantly, then dedupe when server broadcasts back.
    // Cap at 20 — pending entries that the server intentionally drops
    // (e.g., suppressed under duchmind_hide_winner_chat) never get a
    // matching echo and would otherwise accumulate for the whole game.
    setPendingChats((prev) => [...prev.slice(-19), { tempId: Date.now() + Math.random(), text: t, sentAt: Date.now() }]);
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

  // Countdown ticks live in <TimerText> and <TimerBar> below — each owns
  // its own 500ms interval so the seconds-remaining update doesn't force
  // the whole game view (chat list + player strip + avatars) to re-render
  // twice a second. That was the dominant source of mobile lag.

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
  // Phase totals — drawing duration is server-provided; choosing is the
  // hard-coded 15s drawer-decision window. Used by <TimerBar>/<TimerText>
  // to colorize green→yellow→red against the elapsed fraction.
  const drawingTotalSeconds = drawing ? (drawing.duration || 80) : 0;
  const choosingTotalSeconds = 15;

  // ==== Layout ====
  const wordHint = drawerWord && amDrawer ? drawerWord : (hint || "");

  // Brush preview ring sizing — translate the abstract brushSize into a
  // CSS-px diameter based on the canvas's display width. Floor at 12px so
  // tiny brushes still show a visible cursor.
  // Brush preview ring was removed — users on pressure-sensitive devices
  // (Apple Pencil etc.) found it obstructive of the canvas.
  const cursorRing: React.ReactNode = null;

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

  // Whether any phase has a live countdown — used to gate the progress bar
  // and text wrappers below. Colors/values are computed inside the leaf
  // <TimerBar>/<TimerText> components so the parent doesn't tick.
  const timerActive = !!(drawing || (choosing && !reveal));
  // Deadline + total for the currently-active phase. drawing wins over
  // choosing when both happen to be present (mid-transition payload).
  const activeDeadline = drawing ? drawingLocalDeadline : (choosing && !reveal ? choosingLocalDeadline : null);
  const activeTotalSeconds = drawing ? drawingTotalSeconds : (choosing && !reveal ? choosingTotalSeconds : 0);

  // Brush-engine settings modal (stabilizer + pressure curve). Rendered
  // inside both the MLD and desktop branches below so it stays visible
  // regardless of layout. Defined once here to keep the two render paths
  // in sync.
  const settingsModal = settingsOpen && (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold mb-3">그림 설정</h3>
        <div className="mb-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            손떨림 보정 <span className="text-gray-400">— 강할수록 부드럽지만 펜 끝이 늦게 따라옵니다</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {STABILIZER_LABELS.map((lbl, i) => (
              <button
                key={lbl}
                onClick={() => setStabilizer(i as StabilizerLevel)}
                className={`px-2 py-1.5 text-xs rounded border ${stabilizer === i ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >{lbl}</button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            압력 민감도 <span className="text-gray-400">— 펜 압력 → 굵기 변화 곡선</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["low", "mid", "high"] as PressureCurve[]).map((c) => (
              <button key={c} onClick={() => setPressureCurve(c)}
                className={`px-2 py-1.5 text-xs rounded border ${pressureCurve === c ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              >{PRESSURE_CURVE_LABELS[c]}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 mb-3 p-2 rounded border border-gray-300 dark:border-gray-600 cursor-pointer">
          <span className="text-xs">
            <span className="font-semibold">펜 전용 모드</span>
            <span className="block text-gray-500 dark:text-gray-400">손가락 입력 항상 무시 (Apple Pencil 등)</span>
          </span>
          <input
            type="checkbox"
            checked={penOnlyMode}
            onChange={(e) => setPenOnlyMode(e.target.checked)}
            className="w-5 h-5"
          />
        </label>
        <button onClick={() => setSettingsOpen(false)} className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold">닫기</button>
      </div>
    </div>
  );

  // ==== Mobile drawer focus mode ====
  // Replaces the full layout with a fullscreen "always-landscape-style" view:
  //   [palette stripe | top status row + canvas filling rest]
  // The chat panel + player strip are hidden — important events surface as
  // toasts and the full chat is reachable via the 💬 modal. The whole thing
  // is position:fixed inset-0 h:100svh so nothing can produce a scrollbar
  // (the iPad rubber-band fix pattern).
  if (isMLD && drawing) {
    // Portrait phone: position+size as a landscape rectangle, then rotate
    // 90° CW around center so it ends up filling the actual portrait
    // viewport. The user then physically rotates their phone CCW to
    // landscape to read it right-side-up (the canvas's "top" sits on the
    // right edge of the portrait phone, matching the spec).
    // Landscape phone: no rotation; the landscape layout already aligns.
    // Suppress text-selection / iOS callout so a stray drag on a button or
    // label can't start a selection mid-game.
    const noDragStyle: React.CSSProperties = {
      touchAction: "none", overscrollBehavior: "none",
      WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
    };
    const mldStyle: React.CSSProperties = mldRotated
      ? {
          top: "50%",
          left: "50%",
          width: "100svh",
          height: "100vw",
          transform: "translate(-50%, -50%) rotate(90deg)",
          transformOrigin: "center",
          ...noDragStyle,
        }
      : {
          inset: 0,
          height: "100svh",
          ...noDragStyle,
        };
    return (
      <div
        className="fixed z-30 flex flex-row bg-gray-100 dark:bg-gray-900 overflow-hidden select-none"
        style={mldStyle}
      >
        {/* Left palette stripe. Sections flex-grow with `gridAutoRows: 1fr`
            so colors+tools split the remaining vertical space evenly,
            stretching their cells to fill the aside top-to-bottom. Aspect
            ratio is dropped on the buttons — taller-than-wide is fine; the
            point is that no dead space sits below the last tool. */}
        <aside className="shrink-0 w-[120px] sm:w-[132px] bg-white dark:bg-gray-800 p-1 flex flex-col gap-1 overflow-hidden">
          <div
            className="grid grid-cols-3 gap-1 flex-[6] min-h-0"
            style={{ gridAutoRows: "1fr" }}
          >
            {COLORS.map((c) => {
              const pick = () => { setColor(c); if (tool === "eraser") setTool("pen"); };
              return (
                <button
                  key={c}
                  onPointerDown={pick}
                  onClick={pick}
                  className={`w-full h-full rounded border-2 ${color === c && tool !== "eraser" ? "!border-[3px] border-blue-500 ring-2 ring-white dark:ring-gray-800 relative z-10" : "border-gray-300 dark:border-gray-600"}`}
                  style={{ background: c, touchAction: "manipulation", transition: "none", minHeight: 0 }}
                />
              );
            })}
            <button
              onClick={handleWheelButton}
              className={`w-full h-full rounded border-2 ${tool !== "eraser" && !COLORS.includes(color) ? "border-blue-500" : "border-gray-300 dark:border-gray-600"}`}
              style={{
                background: customColor
                  ? customColor
                  : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                touchAction: "manipulation",
                transition: "none",
                minHeight: 0,
              }}
              title="색상환"
            />
          </div>
          <div
            className="grid grid-cols-4 gap-1 shrink-0"
            style={{ gridAutoRows: "minmax(0, 24px)" }}
          >
            {BRUSH_SIZES.map((s) => (
              <button
                key={s}
                onPointerDown={() => setBrushSize(s)}
                onClick={() => setBrushSize(s)}
                className={`w-full h-full rounded border flex items-center justify-center ${brushSize === s ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                style={{ touchAction: "manipulation", transition: "none" }}
                title={`굵기 ${s}px`}
              >
                <span className="rounded-full bg-black dark:bg-white" style={{ width: Math.min(s, 10), height: Math.min(s, 10) }} />
              </button>
            ))}
          </div>
          <div
            className="grid grid-cols-1 gap-1 flex-[5] min-h-0"
            style={{ gridAutoRows: "1fr" }}
          >
            <button
              onPointerDown={() => setTool("pen")}
              onClick={() => setTool("pen")}
              className={`w-full h-full rounded border text-[10px] leading-tight ${tool === "pen" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >🖊 펜</button>
            <button
              onPointerDown={() => setTool("fill")}
              onClick={() => setTool("fill")}
              className={`w-full h-full rounded border text-[10px] leading-tight ${tool === "fill" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >🪣 채우기</button>
            <button
              onPointerDown={() => setTool("eraser")}
              onClick={() => setTool("eraser")}
              className={`w-full h-full rounded border text-[10px] leading-tight ${tool === "eraser" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >지우개</button>
            <button
              onClick={() => onUndo()}
              className="w-full h-full rounded border border-gray-300 dark:border-gray-600 text-[10px] leading-tight"
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >↶ 되돌리기</button>
            <button
              onClick={() => onClear()}
              className="w-full h-full rounded border border-red-300 text-red-600 text-[10px] leading-tight"
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >🗑 전체</button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full h-full rounded border border-gray-300 dark:border-gray-600 text-[10px] leading-tight"
              style={{ touchAction: "manipulation", minHeight: 0 }}
            >⚙️ 설정</button>
          </div>
        </aside>

        {/* Right side: top status row + canvas */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Top time bar — thick enough (h-2) to be readable at a glance
              after the layout has been rotated into the phone's landscape
              orientation. Was h-1 before and users couldn't see it. */}
          <div className="h-2 bg-gray-200 dark:bg-gray-700 overflow-hidden shrink-0">
            {timerActive && (
              <TimerBar
                deadline={activeDeadline}
                totalSeconds={activeTotalSeconds}
                className="h-full transition-[width] duration-200 ease-linear"
              />
            )}
          </div>
          <div className="shrink-0 h-9 px-2 flex items-center justify-between bg-white dark:bg-gray-800 text-xs gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold whitespace-nowrap">R{drawing.round}/{drawing.total_rounds}</span>
              <TimerText deadline={drawingLocalDeadline} totalSeconds={drawingTotalSeconds} className="font-mono whitespace-nowrap" />
              <span className="truncate font-bold">
                {drawing.word_length > 0 ? `${wordHint} (${drawing.word_length})` : wordHint}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {amDrawer && drawerImageUrl && !desktopOverlayVisible && (
                <button
                  type="button"
                  onClick={() => setDesktopOverlayVisible(true)}
                  className="px-2 py-1 rounded bg-blue-600 text-white text-[10px]"
                  style={{ touchAction: "manipulation" }}
                  title="원본 이미지 다시 띄우기"
                >🖼️</button>
              )}
              <button
                onClick={() => setFullscreenDrawing(false)}
                className="px-2 py-1 rounded bg-gray-600 text-white text-[10px]"
                style={{ touchAction: "manipulation" }}
                title="원본 비율로 돌아가기"
              >↙ 원본</button>
              <button
                onClick={() => { setChatModalOpen(true); }}
                className="relative px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs"
                style={{ touchAction: "manipulation" }}
                aria-label="채팅 열기"
              >
                💬
                {chatUnread > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full px-1 leading-none py-0.5 min-w-[14px] text-center">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
              </button>
              {onLeave && (
                <button
                  onClick={() => onLeave()}
                  className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                  style={{ touchAction: "manipulation" }}
                >나가기</button>
              )}
            </div>
          </div>

          {/* Canvas area — outer flex centers a 1.6:1 letterboxed canvas
              into whatever leftover rectangle the layout hands us. The
              aspect lock guarantees the canvas's strokes look the same
              shape to viewers regardless of device (no stretching), and
              the gray bars take up any spare space without producing a
              scrollbar. */}
          <div className="flex-1 min-h-0 bg-gray-300 dark:bg-gray-700 relative overflow-hidden flex items-center justify-center">
            <div
              ref={containerRef}
              className={`bg-white relative overflow-hidden ${amDrawer ? "touch-none" : ""}`}
              style={{ aspectRatio: "1.6 / 1", maxWidth: "100%", maxHeight: "100%", width: "100%" }}
            >
              <canvas
                ref={canvasRef}
                width={canvasDims.w}
                height={canvasDims.h}
                className="block w-full h-full absolute inset-0"
              />
              <canvas
                ref={overlayRef}
                width={canvasDims.w}
                height={canvasDims.h}
                className="block w-full h-full absolute inset-0"
                style={{
                  cursor: amDrawer ? (tool === "fill" ? "cell" : "crosshair") : "default",
                  touchAction: amDrawer ? "none" : "auto",
                  WebkitTouchCallout: "none",
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  pointerEvents: amDrawer ? "auto" : "none",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
              {cursorRing}
              {/* Reference image — same draggable + resizable overlay the
                  desktop view uses, so position/size carries across modes
                  (overlayPos + overlayWidthRatio are shared React state). */}
              {amDrawer && drawerImageUrl && desktopOverlayVisible && (
                <div
                  className="absolute z-30 bg-white rounded-lg shadow-lg border-2 border-blue-300 dark:border-blue-700"
                  style={{
                    top: overlayPos.top,
                    left: overlayPos.left,
                    overflow: "hidden",
                    width: `${overlayWidthRatio * 100}%`,
                    aspectRatio: "1 / 1",
                    minWidth: "70px",
                    minHeight: "70px",
                    maxWidth: "80%",
                    maxHeight: "85%",
                  }}
                >
                  <div
                    onPointerDown={handleOverlayDragStart}
                    onPointerMove={handleOverlayDragMove}
                    onPointerUp={handleOverlayDragEnd}
                    onPointerCancel={handleOverlayDragEnd}
                    className="absolute top-0 left-0 right-0 h-8 bg-blue-100 dark:bg-blue-900/40 cursor-move flex items-center justify-center select-none touch-none"
                    title="드래그해서 이동"
                  >
                    <span className="text-[10px] text-blue-600 dark:text-blue-300 leading-none">⋮⋮ 드래그</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDesktopOverlayVisible(false)}
                    className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-white text-gray-900 font-bold text-xs shadow border border-gray-300 z-10 flex items-center justify-center"
                    aria-label="닫기"
                    style={{ touchAction: "manipulation" }}
                  >✕</button>
                  <img
                    src={drawerImageUrl}
                    alt="원본 일러스트"
                    className="block w-full object-contain pointer-events-none"
                    style={{ height: "calc(100% - 32px)", marginTop: 32 }}
                    draggable={false}
                    onError={onImgErrorRetry}
                  />
                  <div
                    onPointerDown={handleOverlayResizeStart}
                    onPointerMove={handleOverlayResizeMove}
                    onPointerUp={handleOverlayResizeEnd}
                    onPointerCancel={handleOverlayResizeEnd}
                    className="absolute bottom-0 right-0 w-10 h-10 cursor-nwse-resize bg-blue-200 dark:bg-blue-800/60 rounded-tl-lg flex items-end justify-end p-1 select-none touch-none z-10"
                    title="드래그해서 크기 조절"
                    style={{ touchAction: "none" }}
                    aria-label="크기 조절"
                  >
                    <span className="text-sm text-blue-700 dark:text-blue-300 leading-none font-bold">↘</span>
                  </div>
                </div>
              )}
              {/* Toast stack — correct / give-up events only, since the full
                  chat is hidden in this mode. Auto-fade 3.5s. */}
              {mldToasts.length > 0 && (
                <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
                  {mldToasts.map((t) => (
                    <div
                      key={t.id}
                      className={`px-3 py-1 rounded-full text-xs font-semibold shadow ${
                        t.tone === "correct"
                          ? "bg-green-600 text-white"
                          : "bg-orange-500 text-white"
                      }`}
                    >
                      {t.tone === "correct" ? "✓ " : "🏳️ "}{t.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Chat modal + color wheel live INSIDE the rotated container so
            they share the same orientation as the canvas — when the user
            holds the phone portrait, opening chat shouldn't snap them out
            of landscape mode. The CSS transform on the parent reinterprets
            their `fixed inset-0` as "fill the rotated landscape rectangle"
            which is exactly what we want here. */}
        {chatModalOpen && (
          <div
            className="absolute inset-0 z-40 flex items-stretch justify-end bg-black/50"
            onClick={() => setChatModalOpen(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 w-[min(360px,80%)] h-full flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="font-semibold text-sm">채팅</span>
                <button
                  onClick={() => setChatModalOpen(false)}
                  className="text-sm text-gray-500"
                >닫기</button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 text-sm space-y-0.5">
                {chatLog.slice(-200).map((m, i) => (
                  <div key={i} className="break-words">
                    <span className="font-semibold">{(m as any).display_name || "익명"}</span>
                    <span className="text-gray-500"> · </span>
                    <span>{(m as any).text || (m as any).message || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {wheelOpen && (
          <div className="absolute inset-0 z-40">
            <ColorWheelPicker
              value={customColor || "#ffffff"}
              onChange={(c) => { setColor(c); setCustomColor(c); if (tool === "eraser") setTool("pen"); }}
              onClose={() => setWheelOpen(false)}
              rotated={mldRotated}
            />
          </div>
        )}
        {settingsModal}
      </div>
    );
  }

  return (
    <div className={`bg-gray-100 dark:bg-gray-900 lg:rounded-xl lg:shadow p-0 lg:p-3 ${
      // On iPad portrait (Safari desktop mode → innerWidth ≥ 1024), the
      // lg: flex/min-h-0 wrapper would let inner flex-1 children claim a
      // bounded height, forcing the canvas's aspect-ratio to height-fit
      // and shrink horizontally. Skip the lg flex behavior in compact
      // portrait — pages just scroll naturally.
      isPhone ? "" : "lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"
    }`}>
      {/* Compact mode — always-on phone layout when the user isn't
          actively drawing. Renders as a stack of fixed-positioned
          panels in visualViewport space:
            [status strip] [mini canvas if drawing] [chat history]
            [action row] [input]
          The action row + input get their fixed positioning via inline
          styles on their own elements further down the JSX. */}
      {isCompactGuessing && (
        <>
          {/* Top status strip — laid out as a 3-column grid
              (1fr | auto | 1fr) so the centered word hint stays put even
              when the timer text changes width. */}
          <div
            className="fixed left-0 right-0 z-40 px-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 text-[11px]"
            style={{ top: `${safeOffsetTop}px`, height: `${compactStatusH}px` }}
          >
            {/* Thin progress bar across the bottom — same colors as the
                desktop top bar (green→yellow→red as time runs down). 2px
                tall so it's instantly readable without eating layout
                space (just overlays the existing 1px border). */}
            {timerActive && (
              <TimerBar
                deadline={activeDeadline}
                totalSeconds={activeTotalSeconds}
                className="absolute left-0 bottom-0 h-[2px] transition-[width] duration-200 ease-linear"
              />
            )}
            <div className="min-w-0 text-left truncate">
              {drawing ? (
                <span className="font-mono tabular-nums whitespace-nowrap">
                  R{drawing.round}/{drawing.total_rounds} ·{" "}
                  <TimerText deadline={drawingLocalDeadline} totalSeconds={drawingTotalSeconds} />
                </span>
              ) : choosing ? (
                <span className="font-semibold truncate">🎨 {choosing.drawer_name} 선택 중</span>
              ) : reveal ? (
                <span className="font-semibold truncate">✓ 결과</span>
              ) : (
                <span className="text-gray-500">대기 중</span>
              )}
            </div>
            <div className="font-bold whitespace-nowrap text-center">
              {drawing && drawing.word_length > 0 && wordHint
                ? `${wordHint.split("").join(" ")} (${drawing.word_length})`
                : ""}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <button
                type="button"
                onClick={handleCaptureCanvas}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                title="캡처"
                aria-label="캡처"
              >📸</button>
              <button
                type="button"
                onClick={() => setShowPlayersModal(true)}
                className="px-1.5 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                title="참가자"
                aria-label="참가자"
              >👥</button>
              {onLeave && (
                <button
                  type="button"
                  onClick={() => onLeave()}
                  className="px-1.5 py-0.5 text-xs rounded bg-red-600 text-white"
                >나가기</button>
              )}
            </div>
          </div>

          {/* Player strip — icon-only horizontal scroll, tap opens the
              full players modal. Hidden when the keyboard is up so the
              chat panel can claim its slot. */}
          {compactPlayerStripH > 0 && (
            <button
              type="button"
              onClick={() => setShowPlayersModal(true)}
              className="fixed left-0 right-0 z-40 flex gap-1.5 overflow-x-auto bg-white dark:bg-gray-800 px-2 py-1.5 text-left border-b border-gray-200 dark:border-gray-700"
              style={{ top: `${safeOffsetTop + compactStatusH}px`, height: `${compactPlayerStripH}px` }}
            >
              {orderedDisplayPlayers.map((p) => {
                const isDrawer = drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id);
                const guessed = correctGuesserIds.has(String(p.id));
                const gaveUp = givenUpIds.has(String(p.id));
                const isSelf = selfPlayerId != null ? p.id === selfPlayerId : p.display_name === selfDisplayName;
                const isSpec = p.is_spectator;
                const isNext = !isSpec && !isDrawer && isNextDrawer(p.id);
                return (
                  <div key={p.id} className={`shrink-0 flex flex-col items-center ${isSpec ? "opacity-60" : ""}`}>
                    <div className={`rounded-full relative ${
                      isSpec ? "" :
                      isDrawer ? "ring-2 ring-yellow-400" :
                      isNext ? "ring-2 ring-blue-400 ring-dashed" :
                      guessed ? "ring-2 ring-green-400" :
                      gaveUp ? "ring-2 ring-orange-400 opacity-60" : ""
                    }`}>
                      <Avatar icon={p.avatar_icon} border={p.border} size={26} />
                      {!isSpec && gaveUp && <span className="absolute -top-1 -right-1 text-[10px]">🏳️</span>}
                      {!isSpec && rankMedal(String(p.id)) && (
                        <span className="absolute -top-1 -left-1 text-[10px]">{rankMedal(String(p.id))}</span>
                      )}
                      {isNext && (
                        <span className="absolute -bottom-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full bg-blue-600 text-white font-bold">다음</span>
                      )}
                    </div>
                    {isSelf && !isSpec && (
                      <div className="text-[9px] leading-none mt-0.5 text-blue-600 dark:text-blue-400 font-bold">나</div>
                    )}
                  </div>
                );
              })}
              <div className="shrink-0 self-center text-xs text-gray-400 ml-auto">탭 ▸</div>
            </button>
          )}

          {/* Mini canvas — mounts during a live drawing turn AND while
              the reveal is showing, so the drawing + answer stay
              visible until the next dm_choosing arrives. */}
          {showCompactMiniCanvas && (
            <div
              className="fixed left-0 right-0 z-40 bg-gray-200 dark:bg-gray-700 shadow-lg border-b-2 border-blue-300 dark:border-blue-700 flex items-center justify-center overflow-hidden"
              style={{ top: `${safeOffsetTop + compactStatusH + compactPlayerStripH}px`, height: `${miniHeight}px` }}
            >
              <div
                ref={miniContainerRef}
                className="bg-white relative overflow-hidden"
                style={{ width: `${miniBoxW}px`, height: `${miniBoxH}px` }}
              >
                <canvas
                  ref={miniCanvasRef}
                  width={miniDims.w}
                  height={miniDims.h}
                  className="block w-full h-full"
                />
                {/* 👍 / 👎 floating reactions — same source list as the
                    main canvas, just rendered into the compact mini so
                    they're visible while compact mode covers the main. */}
                {reactions && reactions.length > 0 && (
                  <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                    {reactions.map((r) => (
                      <span
                        key={r.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${r.x}%`, top: `${r.y}%` }}
                      >
                        <span className="block text-2xl sm:text-3xl dm-react-float select-none leading-none">
                          {r.emoji === "up" ? "👍" : "👎"}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {/* Reveal panel — small card-image thumb + answer word in
                    the top-left of the mini canvas, so guessers can see
                    what the drawing was supposed to be. */}
                {reveal && reveal.image_url && (
                  <div className="absolute top-1 left-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-green-400 dark:border-green-600 p-1 z-10" style={{ width: "30%", minWidth: "70px", maxWidth: "120px" }}>
                    <p className="text-[10px] text-center text-green-700 dark:text-green-300 font-semibold leading-none mb-0.5 truncate">정답: {reveal.word}</p>
                    <img
                      src={reveal.image_url}
                      alt={reveal.word || ""}
                      className="block w-full aspect-square object-cover rounded"
                      draggable={false}
                      onError={onImgErrorRetry}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chat history — fills the slot between status (+ optional
              player strip + mini canvas) and the keyboard-pinned action
              row + input. */}
          <div
            ref={compactChatScrollRef}
            className="fixed left-0 right-0 z-40 bg-white dark:bg-gray-900 overflow-y-auto overscroll-contain px-1 py-1 text-sm border-t border-gray-200 dark:border-gray-700"
            style={{
              top: `${safeOffsetTop + compactStatusH + compactPlayerStripH + miniHeight}px`,
              // 84 = action-row (~34) + input form (~50); slight underlap
              // is safer than overshoot — was 94 which left an 8-10px
              // strip of the regular layout's chat peeking through right
              // above the input.
              bottom: `${safeKeyboardOffset + 84}px`,
            }}
          >
            <div ref={compactChatContentRef} className="space-y-0.5">
              {chatLog.slice(-200).map((m, i) => {
                const sender = playersByName.get(m.display_name);
                const senderSolved = !!sender && correctGuesserIds.has(String(sender.id));
                return (
                  <ChatRow
                    key={m._uid ?? `idx-${i}`}
                    m={m}
                    sender={sender}
                    iAmSolved={iAmSolvedNow}
                    senderSolved={senderSolved}
                    amDrawer={amDrawer}
                    amSpectator={amSpectator}
                  />
                );
              })}
              {pendingChats.map((p) => renderPendingRow(p))}
            </div>
          </div>
        </>
      )}

      {/* Time gauge — single thin bar at the very top, color shifts from
          green → yellow → red as the clock runs down. */}
      <div className="h-1 bg-gray-200 dark:bg-gray-700 mb-1 rounded-full overflow-hidden">
        {timerActive && (
          <TimerBar
            deadline={activeDeadline}
            totalSeconds={activeTotalSeconds}
            className="h-full transition-[width] duration-200 ease-linear"
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
            {drawing ? (
              <TimerText deadline={drawingLocalDeadline} totalSeconds={drawingTotalSeconds} className="font-mono text-sm" />
            ) : choosing && !reveal ? (
              <TimerText deadline={choosingLocalDeadline} totalSeconds={choosingTotalSeconds} className="font-mono text-sm" />
            ) : reveal ? (
              <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
                정답자 {Object.keys(reveal.correct_guessers).length}명 +{reveal.drawer_bonus}
              </span>
            ) : null}
            <button
              onClick={handleCaptureCanvas}
              title="캔버스 캡처 (PNG 다운로드)"
              className="px-2 py-0.5 text-xs font-semibold rounded border border-gray-300 dark:border-gray-600"
              style={{ touchAction: "manipulation" }}
            >
              📸 캡처
            </button>
            {amDrawer && !!drawing && isPhone && (
              <button
                onClick={() => setFullscreenDrawing(true)}
                title="전체화면 (가로 회전)"
                className="px-2 py-0.5 text-xs font-semibold rounded bg-gray-700 text-white"
                style={{ touchAction: "manipulation" }}
              >
                📱 전체화면
              </button>
            )}
            {onLeave && (
              <button
                onClick={onLeave}
                title="방 나가기"
                aria-label="방 나가기"
                className="px-2 py-0.5 text-xs font-semibold rounded bg-red-500 text-white hover:bg-red-600"
                style={{ touchAction: "manipulation" }}
              >
                나가기
              </button>
            )}
          </div>
        </div>
        {/* Hint row size scales down for long words so the spaced-out
            underscores ("_ _ _ _ ...") don't overflow the fixed-height
            status bar on phones. word_length 0 means the host disabled
            length reveal — we render a plain ❓ string and don't shrink. */}
        <div
          className={`font-bold text-center break-words flex-1 flex items-center justify-center gap-2 overflow-hidden ${
            reveal ? "text-green-700 dark:text-green-300" :
            drawing && !amDrawer ? "font-mono tracking-wider" : ""
          } ${(() => {
            const len = drawing?.word_length ?? 0;
            // Most words fit at text-base up through ~15 chars. Only kick
            // in shrinking for the rare 16+ outlier so normal turns aren't
            // visually nerfed.
            if (len >= 20) return "text-xs";
            if (len >= 16) return "text-sm";
            return "text-base";
          })()}`}
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
                      : "❓ 그림만 보고 맞혀보세요"))
              : choosing ? `🎨 ${choosing.drawer_name} 단어 선택 중...` : ""}
          </span>
          {/* Restore the in-canvas reference overlay if the drawer dismissed
              it via its ✕ button. */}
          {drawing && amDrawer && drawerImageUrl && !desktopOverlayVisible && (
            <button
              type="button"
              onClick={() => setDesktopOverlayVisible(true)}
              className="shrink-0 px-2 py-0.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 active:bg-blue-800"
              style={{ touchAction: "manipulation" }}
              title="참고 이미지 다시 띄우기"
            >
              🖼️ 다시 띄우기
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
          const isNext = !isSpec && !isDrawer && isNextDrawer(p.id);
          return (
            <div key={p.id} className={`shrink-0 flex flex-col items-center ${isSpec ? "opacity-60" : ""}`}>
              <div className={`rounded-full relative ${
                isSpec ? "" :
                isDrawer ? "ring-2 ring-yellow-400" :
                isNext ? "ring-2 ring-blue-400 ring-dashed" :
                guessed ? "ring-2 ring-green-400" :
                gaveUp ? "ring-2 ring-orange-400 opacity-60" : ""
              }`}>
                <Avatar icon={p.avatar_icon} border={p.border} size={28} />
                {!isSpec && gaveUp && <span className="absolute -top-1 -right-1 text-[10px]">🏳️</span>}
                {!isSpec && rankMedal(String(p.id)) && (
                  <span className="absolute -top-1 -left-1 text-[10px]">{rankMedal(String(p.id))}</span>
                )}
                {isNext && (
                  <span className="absolute -bottom-1 -right-1 text-[9px] leading-none px-1 py-0.5 rounded-full bg-blue-600 text-white font-bold">다음</span>
                )}
              </div>
              {isSpec ? (
                <div className={`text-[9px] leading-none mt-0.5 ${p.reserved_for_next ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-400"}`}>
                  {p.reserved_for_next ? "🕐예약" : "관전"}
                </div>
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
          squeezed. At lg+, the grid stretches both columns to the same
          height so the chat fills any empty vertical space below the
          canvas — no more dead band on tall monitors. */}
      <div className={`flex flex-col gap-2 ${
        // Skip the lg:grid two-column layout on iPad portrait. Safari's
        // "request desktop site" mode reports innerWidth ≥ 1024 even in
        // portrait, which trips lg: and shrinks the canvas column to
        // ~1fr - 360px = ~650px wide instead of letting it use the full
        // viewport width. Phone & compact-portrait → stack via the base
        // flex-col.
        isPhone ? "" : "lg:grid lg:gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,32%)] lg:flex-1 lg:min-h-0"
      }`}>
        {/* Left column: canvas + tools. select-none on the column avoids
            mobile text-selection drags spilling into adjacent labels when a
            stroke starts near the canvas edge. The chat column stays
            selectable so users can copy chat history. */}
        <div className="flex flex-col gap-2 mb-2 lg:mb-0 select-none relative lg:min-h-0">
          {/* Canvas-area wrapper. At lg+, the canvas takes the full
              column width at its native 1.6 aspect (no horizontal
              letterbox eating space next to chat) and the palette is
              positioned absolutely below it. If the column is shorter
              than canvas+palette, the palette overlays the canvas
              bottom — user accepted that trade-off in exchange for the
              wider canvas. */}
          <div className="lg:flex-1 lg:min-h-0 lg:relative">
          <div ref={containerRef} className={`bg-white lg:rounded-lg overflow-hidden lg:border-2 lg:border-gray-300 lg:dark:border-gray-600 relative w-full aspect-[1.6/1] ${amDrawer ? "touch-none" : ""}`}>
            {/* Zoom target — only the canvases scale under pinch-zoom; the
                reference / reveal panels below stay at their normal size. */}
            <div ref={zoomTargetRef} className="absolute inset-0" style={{ transformOrigin: "0 0", willChange: "transform" }}>
            <canvas
              ref={canvasRef}
              width={canvasDims.w}
              height={canvasDims.h}
              className="block w-full h-full absolute inset-0"
            />
            <canvas
              ref={overlayRef}
              width={canvasDims.w}
              height={canvasDims.h}
              className="block w-full h-full absolute inset-0"
              style={{
                cursor: amDrawer ? (tool === "fill" ? "cell" : "crosshair") : "default",
                // Drawer needs touch-action:none to claim every gesture
                // for drawing. Non-drawers leave it 'auto' so a swipe
                // over the canvas just scrolls the page normally on
                // mobile — useful since most of the screen is canvas.
                touchAction: amDrawer ? "none" : "auto",
                // Prevent iOS long-press callout / image-save menu over the
                // canvas — mobile drawers were getting interrupted mid-stroke.
                WebkitTouchCallout: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
                pointerEvents: amDrawer ? "auto" : "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {cursorRing}
            </div>
            {zoomBadgeOn && (
              <button
                type="button"
                onClick={resetZoom}
                className="absolute top-2 right-2 z-30 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-semibold shadow flex items-center gap-1"
                style={{ touchAction: "manipulation" }}
                title="원래 크기로"
              >
                🔍 <span ref={zoomNumRef}>{Math.round(zoomRef.current.scale * 100)}%</span> <span className="opacity-70">↺</span>
              </button>
            )}
            {!drawing && !choosing && !reveal && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm bg-white/70">
                게임 준비 중...
              </div>
            )}
            {/* Floating 👍/👎 reactions — scattered across the canvas at
                random spots, each drifts up + fades (dm-react-float in
                index.css). pointer-events:none so they never block drawing. */}
            {reactions && reactions.length > 0 && (
              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                {reactions.map((r) => (
                  // Wrapper does the (x,y) anchoring; inner span runs the
                  // float animation so its transform doesn't fight the
                  // centering offset.
                  <span
                    key={r.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${r.x}%`, top: `${r.y}%` }}
                  >
                    <span className="block text-3xl sm:text-4xl dm-react-float select-none leading-none">
                      {r.emoji === "up" ? "👍" : "👎"}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {/* Reveal overlay — small panel at top-left of canvas so the
                drawing remains mostly visible AND chat stays unblocked. */}
            {reveal && reveal.image_url && (
              <div className="absolute top-2 left-2 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-green-400 dark:border-green-600 p-1" style={{ width: "30%", minWidth: "90px" }}>
                <p className="text-[10px] sm:text-xs text-center text-green-700 dark:text-green-300 font-semibold leading-none mb-1">정답</p>
                <img
                  src={reveal.image_url}
                  alt={reveal.word}
                  className="block rounded object-contain w-full"
                  onError={onImgErrorRetry}
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
                  overflow: "hidden",
                  // Width tracked in React state as a ratio of canvas
                  // width — drives both CSS resize fallback and the
                  // touch-friendly bottom-right handle below.
                  width: `${overlayWidthRatio * 100}%`,
                  aspectRatio: "1 / 1",
                  minWidth: "90px",
                  minHeight: "90px",
                  maxWidth: "80%",
                  maxHeight: "85%",
                }}
              >
                {/* Drag handle bar — taller so touch users can grab it
                    without slipping onto the canvas (which would start a
                    stroke). 40px hit area is roughly Apple HIG min. */}
                <div
                  onPointerDown={handleOverlayDragStart}
                  onPointerMove={handleOverlayDragMove}
                  onPointerUp={handleOverlayDragEnd}
                  onPointerCancel={handleOverlayDragEnd}
                  className="absolute top-0 left-0 right-0 h-10 bg-blue-100 dark:bg-blue-900/40 cursor-move flex items-center justify-center select-none touch-none"
                  title="드래그해서 이동"
                >
                  <span className="text-xs text-blue-600 dark:text-blue-300 leading-none">⋮⋮ 드래그</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDesktopOverlayVisible(false)}
                  className="absolute top-1 right-1 w-8 h-8 rounded-full bg-white text-gray-900 font-bold text-sm shadow border border-gray-300 hover:bg-gray-100 z-10 flex items-center justify-center"
                  aria-label="닫기"
                  title="닫기"
                  style={{ touchAction: "manipulation" }}
                >
                  ✕
                </button>
                <img
                  src={drawerImageUrl}
                  alt="원본 일러스트"
                  className="block w-full object-contain pointer-events-none"
                  style={{ height: "calc(100% - 40px)", marginTop: 40 }}
                  onError={onImgErrorRetry}
                />
                {/* Touch-friendly resize handle (bottom-right corner).
                    iOS/iPadOS Safari can't trigger the CSS resize:both
                    affordance with a finger; this is the manual one. */}
                <div
                  onPointerDown={handleOverlayResizeStart}
                  onPointerMove={handleOverlayResizeMove}
                  onPointerUp={handleOverlayResizeEnd}
                  onPointerCancel={handleOverlayResizeEnd}
                  className="absolute bottom-0 right-0 w-10 h-10 cursor-nwse-resize bg-blue-200 dark:bg-blue-800/60 rounded-tl-lg flex items-end justify-end p-1 select-none touch-none z-10"
                  title="드래그해서 크기 조절"
                  style={{ touchAction: "none" }}
                  aria-label="크기 조절"
                >
                  <span className="text-sm text-blue-700 dark:text-blue-300 leading-none font-bold">↘</span>
                </div>
              </div>
            )}
          </div>
          </div>

          {/* Tool palette — desktop keeps it always reserved (so the canvas
              column doesn't shift when the user becomes the drawer). Mobile
              hides it entirely when not drawing — its 60-80px would otherwise
              push chat below the viewport on short phones. At lg+ it floats
              absolutely at the bottom of the column so the canvas above can
              span the full column width without losing height to it. */}
          <div
            aria-hidden={!(amDrawer && drawing)}
            className={`bg-white dark:bg-gray-800 rounded-lg p-1.5 flex-col gap-1.5 text-sm lg:text-xs lg:absolute lg:z-10 lg:shadow-lg lg:border-2 lg:border-gray-500 dark:lg:border-gray-300 ${
              paletteVertical
                ? "lg:left-0 lg:top-0 lg:bottom-0 lg:right-auto lg:w-auto"
                : "lg:bottom-0 lg:left-0 lg:right-0"
            } ${
              amDrawer && drawing
                ? "flex"
                : "hidden lg:flex lg:invisible lg:pointer-events-none"
            }`}
          >
              {/* Orientation toggle (lg+ only). Bottom-bar mode covers
                  canvas bottom; vertical mode covers a thin left strip
                  instead — wide-monitor users found the bottom bar
                  swallowed too much drawable area. Hidden below lg
                  because the palette there is in normal flow, not
                  absolute. */}
              <button
                onPointerDown={() => setPaletteVertical((v) => !v)}
                onClick={() => setPaletteVertical((v) => !v)}
                className="hidden lg:flex self-end items-center justify-center w-7 h-6 rounded border border-gray-300 dark:border-gray-600 text-xs"
                title={paletteVertical ? "팔레트 가로로" : "팔레트 세로로"}
                aria-label={paletteVertical ? "팔레트 가로 정렬" : "팔레트 세로 정렬"}
                style={{ touchAction: "manipulation", transition: "none" }}
              >
                {paletteVertical ? "⇕" : "⇔"}
              </button>
              {/* Row 1: colors. Explicit row so wrap behavior is
                  predictable across browsers (Safari iPad was rendering
                  wrap result inconsistently — second row would not show). */}
              {/* lg+ forces a single line per row — buttons flex-shrink to
                  whatever fits the column width. Mobile/iPad portrait
                  keeps wrap so 17 colors don't get squished too small.
                  Color picks fire on pointerdown (not click) so a slight
                  finger drag during tap doesn't make iOS cancel the
                  click — the #1 reason the previous version's color
                  taps "didn't register". transition:none cuts the 250ms
                  global button border-color fade so the highlight flips
                  instantly and users get visual confirmation. */}
              {/* Colors. Horizontal mode: single nowrap row at lg+ that
                  shrinks each button to fit. Vertical mode: 2-col grid so
                  17 buttons stack neatly in 9 rows on the side strip. */}
              <div className={paletteVertical
                ? "flex flex-wrap gap-1 lg:grid lg:grid-cols-2 lg:gap-1"
                : "flex flex-wrap lg:flex-nowrap gap-1 lg:gap-1"
              }>
                {COLORS.map((c) => {
                  const pickColor = () => { setColor(c); if (tool === "eraser") setTool("pen"); };
                  return (
                    <button
                      key={c}
                      onPointerDown={pickColor}
                      onClick={pickColor}
                      className={`w-7 h-7 sm:w-10 sm:h-10 ${paletteVertical ? "lg:w-full lg:h-auto lg:aspect-square" : "lg:w-auto lg:h-auto lg:flex-1 lg:min-w-0 lg:max-w-[44px] lg:aspect-square"} rounded border-2 ${color === c && tool !== "eraser" ? "!border-[3px] border-blue-500 ring-2 ring-white dark:ring-gray-800 relative z-10" : "border-gray-300 dark:border-gray-600"}`}
                      style={{ background: c, touchAction: "manipulation", transition: "none" }}
                    />
                  );
                })}
                {/* Custom color picker — opens HSV wheel popup. Border lights up
                    when the current color isn't one of the presets. */}
                <button
                  onClick={handleWheelButton}
                  className={`w-7 h-7 sm:w-10 sm:h-10 ${paletteVertical ? "lg:w-full lg:h-auto lg:aspect-square" : "lg:w-auto lg:h-auto lg:flex-1 lg:min-w-0 lg:max-w-[44px] lg:aspect-square"} rounded border-2 flex items-center justify-center text-base sm:text-lg ${tool !== "eraser" && !COLORS.includes(color) ? "border-blue-500" : "border-gray-300 dark:border-gray-600"}`}
                  style={{
                    background: customColor
                      ? customColor
                      : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                    touchAction: "manipulation",
                    transition: "none",
                  }}
                  title="색상환"
                  aria-label="색상환 열기"
                />
              </div>
              {/* Row 2: brush sizes + tool/undo/clear buttons. */}
              <div className={paletteVertical
                ? "flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch lg:gap-1"
                : "flex flex-wrap lg:flex-nowrap items-center gap-1.5 lg:gap-1"
              }>
                <div className={paletteVertical ? "flex gap-1 shrink-0 lg:grid lg:grid-cols-2" : "flex gap-1 shrink-0"}>
                  {BRUSH_SIZES.map((s) => {
                    const pickSize = () => setBrushSize(s);
                    return (
                      <button
                        key={s}
                        onPointerDown={pickSize}
                        onClick={pickSize}
                        className={`w-8 h-8 sm:w-11 sm:h-11 ${paletteVertical ? "lg:w-full lg:h-auto lg:aspect-square" : "lg:w-9 lg:h-9"} rounded border flex items-center justify-center ${brushSize === s ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                        title={`굵기 ${s}px`}
                        style={{ touchAction: "manipulation", transition: "none" }}
                      >
                        <span className="rounded-full bg-current" style={{ width: s, height: s }} />
                      </button>
                    );
                  })}
                </div>
                <button
                  onPointerDown={() => setTool("pen")}
                  onClick={() => setTool("pen")}
                  className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border text-sm sm:text-base lg:text-xs ${tool === "pen" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                  style={{ touchAction: "manipulation", transition: "none" }}
                >🖊 펜</button>
                <button
                  onPointerDown={() => setTool("fill")}
                  onClick={() => setTool("fill")}
                  className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border text-sm sm:text-base lg:text-xs ${tool === "fill" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                  style={{ touchAction: "manipulation", transition: "none" }}
                >🪣 채우기</button>
                <button
                  onPointerDown={() => setTool("eraser")}
                  onClick={() => setTool("eraser")}
                  className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border text-sm sm:text-base lg:text-xs ${tool === "eraser" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600"}`}
                  style={{ touchAction: "manipulation", transition: "none" }}
                >지우개</button>
                <button onClick={() => onUndo()} className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border border-gray-300 dark:border-gray-600 text-sm sm:text-base lg:text-xs`} style={{ touchAction: "manipulation" }}>↶ 되돌리기</button>
                <button onClick={() => onClear()} className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border border-red-300 text-red-600 text-sm sm:text-base lg:text-xs`} style={{ touchAction: "manipulation" }}>🗑 전체</button>
                <button onClick={() => setSettingsOpen(true)} className={`px-2.5 py-1 sm:px-3.5 sm:py-2 lg:px-2 lg:py-1 ${paletteVertical ? "lg:w-full" : "lg:flex-1 lg:min-w-0"} rounded border border-gray-300 dark:border-gray-600 text-sm sm:text-base lg:text-xs`} style={{ touchAction: "manipulation" }}>⚙️ 설정</button>
              </div>
          </div>
          {wheelOpen && (
            <ColorWheelPicker
              value={customColor || "#ffffff"}
              onChange={(c) => { setColor(c); setCustomColor(c); if (tool === "eraser") setTool("pen"); }}
              onClose={() => setWheelOpen(false)}
              rotated={mldRotated}
            />
          )}
          {settingsModal}
        </div>

        {/* Mobile: players=horizontal strip on top + chat full-width below.
            Desktop: vertical stack in the right column. On phones (sm 미만)
            this column flex-1's into the wrapper's leftover height so the
            chat panel + action row sit right above the bottom tab bar
            without page scroll. lg:min-h-0 is the critical bit at the
            grid level: without it, grid items default to min-height:auto
            and the column was growing past the wrapper as chat history
            accumulated. */}
        <div className="flex flex-col gap-2 min-w-0 lg:min-h-0">
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
                      <div className={`text-[10px] md:hidden leading-tight mt-0.5 ${p.reserved_for_next ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-400"}`}>
                        {p.reserved_for_next ? "🕐예약" : "관전"}
                      </div>
                    )}
                    <div className="hidden lg:block flex-1 min-w-0">
                      <div className="text-xs truncate text-left">
                        {!isSpec && isNextDrawer(p.id) && !(drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id)) && (
                          <span className="text-[10px] mr-1 px-1 py-0.5 rounded bg-blue-600 text-white font-semibold align-middle">다음</span>
                        )}
                        {!isSpec && rankMedal(String(p.id)) && `${rankMedal(String(p.id))} `}{!isSpec && isDrawer && "🎨 "}{!isSpec && guessed && "✓ "}{!isSpec && gaveUp && !guessed && "🏳️ "}{p.display_name}
                        {isSpec && (
                          p.reserved_for_next
                            ? <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">(🕐 예약)</span>
                            : <span className="ml-1 text-gray-400">(관전자)</span>
                        )}
                      </div>
                      {!isSpec && <div className="text-[11px] text-gray-500 text-left">{score}점</div>}
                    </div>
                    {/* Host-only kick button — surfaces during in-game so afk
                        players can be removed without ending the round. */}
                    {isHost && onKickPlayer && p.id !== selfPlayerId && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onKickPlayer(p.id); }}
                        title={`${p.display_name} 강퇴`}
                        className="hidden lg:inline-flex shrink-0 w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 items-center justify-center text-xs font-bold hover:bg-red-200 dark:hover:bg-red-900/50"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chat is always visible — reveal illustration shows as a small
              panel inside the canvas area instead of replacing chat, so the
              10-second break gives players actual chat time. */}
          <div
            className={`bg-white dark:bg-gray-800 rounded-lg p-2 flex flex-col min-w-0 relative lg:h-auto lg:flex-1 lg:min-h-0 ${
              amDrawer && drawing ? "h-[min(28svh,260px)]" : "h-[min(36svh,340px)]"
            }`}
          >
            {!chatPinnedToBottom && (
              <button
                type="button"
                onClick={scrollChatToBottom}
                className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-lg hover:bg-blue-700"
              >
                ↓ 맨 아래로
              </button>
            )}
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain text-sm md:text-base pr-1 break-words text-left">
              <div ref={chatContentRef} className="space-y-0.5">
              {chatLog.slice(-200).map((m, i) => {
                const sender = playersByName.get(m.display_name);
                const senderSolved = !!sender && correctGuesserIds.has(String(sender.id));
                return (
                  <ChatRow
                    key={m._uid ?? `idx-${i}`}
                    m={m}
                    sender={sender}
                    iAmSolved={iAmSolvedNow}
                    senderSolved={senderSolved}
                    amDrawer={amDrawer}
                    amSpectator={amSpectator}
                  />
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
                    ? (amReservedForNext
                        ? "입장 예약됨 — 다음 판부터 참여합니다"
                        : spectatorPlaceholder)
                    : iAmCorrect
                      ? "수다 떨기 (이미 정답)"
                      : iGaveUp
                        ? "수다 떨기 (포기함)"
                        : guesserPlaceholder;
              return (
                <>
                  {/* On phones (sm 미만), the drawer can't chat anyway and
                      the lookup/give-up actions are also disabled — hide
                      both rows so the chat history claims that ~80px of
                      space. sm+ keeps them visible (just disabled) for
                      layout consistency on bigger screens. */}
                  <form
                    onSubmit={handleSubmitChat}
                    className={`gap-1 min-w-0 ${amDrawer && drawing ? "hidden sm:flex" : "flex"} ${
                      isCompactGuessing
                        ? "fixed left-0 right-0 z-50 m-0 px-2 py-2 bg-white dark:bg-gray-800 border-t-2 border-blue-300 dark:border-blue-700"
                        : "mt-2"
                    }`}
                    style={isCompactGuessing ? { bottom: `${safeKeyboardOffset}px` } : undefined}
                  >
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onFocus={() => setChatFocused(true)}
                      onBlur={() => setChatFocused(false)}
                      placeholder={placeholder}
                      disabled={chatLocked}
                      className="flex-1 min-w-0 px-2 py-1 md:py-2 border rounded bg-white dark:bg-gray-800 text-base sm:text-sm md:text-base"
                    />
                    <button type="submit" disabled={chatLocked || !chatInput.trim()} className="shrink-0 px-3 py-1 md:py-2 bg-blue-600 text-white rounded text-sm md:text-base font-semibold disabled:opacity-40">
                      전송
                    </button>
                  </form>
                  {/* Action row — slots always rendered (invisible when
                      inactive) so toggling between guess states doesn't
                      resize the chat panel. On phones the drawer has no
                      use for these buttons, so they're hidden along with
                      the chat input row to give chat ~80px more height.
                      In compact mode it floats up to sit just above the
                      fixed input so 카드 검색 / 포기 stay reachable. */}
                  <div
                    className={`gap-1.5 ${amDrawer && drawing ? "hidden sm:flex" : "flex"} ${
                      isCompactGuessing
                        ? "fixed left-0 right-0 z-50 m-0 px-2 py-1 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700"
                        : "mt-1.5"
                    }`}
                    style={isCompactGuessing ? { bottom: `${safeKeyboardOffset + 50}px` } : undefined}
                  >
                    {/* Slot 1: 🔍 카드 검색 — visible whenever the local user
                        is not the active drawer. */}
                    {(() => {
                      const cardSearchActive = !amDrawer;
                      return (
                        <button
                          type="button"
                          onClick={() => setShowCardSearch(true)}
                          disabled={!cardSearchActive}
                          aria-hidden={!cardSearchActive}
                          className={`flex-1 text-xs py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                            cardSearchActive ? "" : "invisible pointer-events-none"
                          }`}
                        >
                          🔍 {packSeries === "pokemon" ? "포켓몬 검색" : "카드 검색"}
                        </button>
                      );
                    })()}
                    {/* Slot 2: 👍/👎 reactions take over when this client
                        has nothing actionable left here — i.e. they've
                        already guessed correctly (during drawing) or it's
                        the reveal pause (open to everyone, spectators too).
                        Otherwise it's the usual 🎮 입장예약 / 🏳️ 포기. */}
                    {onReact && ((iAmCorrect && !!drawing) || !!reveal) ? (
                      <div className="flex-1 flex gap-1">
                        <button
                          type="button"
                          onPointerDown={() => onReact("up")}
                          onClick={() => onReact("up")}
                          className="flex-1 text-xs py-1 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          style={{ touchAction: "manipulation", transition: "none" }}
                          title="추천"
                        >👍</button>
                        <button
                          type="button"
                          onPointerDown={() => onReact("down")}
                          onClick={() => onReact("down")}
                          className="flex-1 text-xs py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                          style={{ touchAction: "manipulation", transition: "none" }}
                          title="비추천"
                        >👎</button>
                      </div>
                    ) : amSpectator ? (() => {
                      // Already reserved → button becomes a disabled status
                      // pill ("🕐 입장 예약됨"). One-shot reservation, no
                      // cancel.
                      if (amReservedForNext) {
                        return (
                          <div
                            aria-disabled="true"
                            className="flex-1 text-xs py-1 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-semibold text-center"
                          >
                            🕐 입장 예약됨
                          </div>
                        );
                      }
                      const joinActive = !!onJoinGame;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (!onJoinGame) return;
                            if (confirm("다음 판부터 참여하시겠습니까? 이번 판은 관전을 유지합니다.")) onJoinGame();
                          }}
                          disabled={!joinActive}
                          aria-hidden={!joinActive}
                          className={`flex-1 text-xs py-1 rounded border border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 font-semibold ${
                            joinActive ? "" : "invisible pointer-events-none"
                          }`}
                        >
                          🎮 다음 판 입장 예약
                        </button>
                      );
                    })() : (() => {
                      const giveUpActive = !!drawing && !amDrawer && !iAmCorrect && !iGaveUp;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("정말 이번 라운드를 포기하시겠습니까?")) onGiveUp();
                          }}
                          disabled={!giveUpActive}
                          aria-hidden={!giveUpActive}
                          className={`flex-1 text-xs py-1 rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 ${
                            giveUpActive ? "" : "invisible pointer-events-none"
                          }`}
                        >
                          🏳️ 포기
                        </button>
                      );
                    })()}
                  </div>
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
                        {!isSpec && isNextDrawer(p.id) && !(drawing?.drawer_id === String(p.id) || choosing?.drawer_id === String(p.id)) && (
                          <span className="text-[10px] mr-1 px-1 py-0.5 rounded bg-blue-600 text-white font-semibold align-middle">다음</span>
                        )}
                        {!isSpec && rankMedal(String(p.id)) && `${rankMedal(String(p.id))} `}{!isSpec && isDrawer && "🎨 "}{!isSpec && guessed && "✓ "}{!isSpec && gaveUp && !guessed && "🏳️ "}{p.display_name}{!isSpec && isSelf && <span className="text-blue-600 dark:text-blue-400 ml-1">(나)</span>}{isSpec && (p.reserved_for_next ? <span className="text-amber-600 dark:text-amber-400 ml-1 font-semibold">(🕐 예약)</span> : <span className="text-gray-400 ml-1">(관전자)</span>)}
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

      {/* Tiny-phone reference image popup. Resizable via CSS resize:both
          (touch-friendly resize handle in the bottom-right corner) so
          drawers can shrink it to peek at the canvas underneath. */}
      {isVerySmall && showCardImage && drawerImageUrl && (
        <div
          className="fixed inset-0 bg-black/60 z-[55] flex items-center justify-center p-4"
          onClick={() => setShowCardImage(false)}
        >
          <div
            className="relative bg-white rounded-lg shadow-xl border-2 border-blue-300 dark:border-blue-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "70vw",
              maxWidth: "90vw",
              aspectRatio: "1 / 1",
              maxHeight: "80vh",
              resize: "both",
            }}
          >
            <button
              type="button"
              onClick={() => setShowCardImage(false)}
              className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white text-gray-900 font-bold text-base shadow border border-gray-300 hover:bg-gray-100 active:bg-gray-200 z-10 flex items-center justify-center"
              aria-label="닫기"
              style={{ touchAction: "manipulation" }}
            >
              ✕
            </button>
            <img
              src={drawerImageUrl}
              alt="원본 일러스트"
              className="w-full h-full object-contain pointer-events-none"
              onError={onImgErrorRetry}
            />
          </div>
        </div>
      )}

      <CardSearchModal
        open={showCardSearch}
        onClose={() => setShowCardSearch(false)}
        onPick={(name) => {
          setChatInput(name);
          setTimeout(() => chatInputRef.current?.focus(), 0);
        }}
        series={packSeries}
        copyTargetLabel="채팅창"
      />

      {showWordChoiceModal && myWordChoices && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 sm:p-5 w-full max-w-lg max-h-[95vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-2 text-center">🎨 단어 선택 (<TimerText deadline={choosingLocalDeadline} totalSeconds={choosingTotalSeconds} suffix="초" />)</h3>
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
                      onError={onImgErrorRetry}
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
