import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { getRoom, leaveRoom, kickPlayer, updateRoom, startGame, endGame, joinRoom, setGuestSession, closeRoom, toggleSpectator, reserveForNext, transferHost, type RoomDetail } from "@/api/multiplayerApi";
import { getUserInfo, isAuthenticated } from "@/api/accountApi";
import { getGuestSession } from "@/api/multiplayerApi";
import { listPacks, type WordPackSummary } from "@/api/duchmindPackApi";
import { getGameInfo, AVAILABLE_GAMES, type GameId } from "@/lib/multiplayerGames";
import { useIsCompactPortrait } from "@/lib/useViewport";
import Avatar from "@/components/Avatar";
import QuizGameView, {
  type QuizProgressEvent,
  type QuizQuestionEvent,
  type QuizMyResult,
  type QuizRoundReveal,
  type QuizGameEnd,
} from "@/components/multiplayer/QuizGameView";
import DuchMindGameView, {
  type DmChoosingEvent,
  type DmWordChoicesEvent,
  type DmDrawingEvent,
  type DmStrokePayload,
  type DmChatEvent,
  type DmTurnReveal,
  type DmGameEnd,
  type CapturedTurn,
} from "@/components/multiplayer/DuchMindGameView";
import TwentyGameView from "@/components/multiplayer/TwentyGameView";
import GameResultScreen from "@/components/multiplayer/GameResultScreen";
import RoomRulesPanel from "@/components/multiplayer/RoomRulesPanel";

const STATUS_LABEL: Record<string, string> = {
  waiting: "대기 중",
  in_game: "게임 중",
  closed: "종료됨",
};

export default function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const id = roomId ? Number(roomId) : null;
  // Phone-style stacked layout for iPad portrait + phone portrait. Bypasses
  // the md:grid two-column split so the canvas can use the full viewport
  // width instead of being locked to 640px.
  const isCompactPortrait = useIsCompactPortrait();
  const inviteCode = searchParams.get("invite") || "";
  const stealthMode = searchParams.get("stealth") === "1";

  const [initialRoom, setInitialRoom] = useState<RoomDetail | null>(null);
  // For invite-link entry we must finish the auto-join (and persist the
  // returned guest_token to localStorage) BEFORE the WebSocket attempts to
  // connect — otherwise the WS handshake has no auth and gets rejected.
  // Stealth mode also defers WS until after the stealth join lands.
  const [wsReady, setWsReady] = useState(!inviteCode && !stealthMode);
  // When the URL has an invite code, we DON'T auto-join — chat-link preview
  // bots (KakaoTalk, Slack, Discord, …) execute the page and would otherwise
  // each spawn a zombie guest. Show a confirm-to-enter step so only real
  // users with a click create a player record.
  // Stealth mode skips the gate entirely (admin-only path).
  const [pendingInvite, setPendingInvite] = useState<boolean>(!!inviteCode && !stealthMode);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Host-only leave dialog: end the game outright vs. transfer host first
  // and then leave. Non-hosts get the plain confirm path.
  const [hostLeaveModalOpen, setHostLeaveModalOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  // Re-join flow state: when the WS closes with a terminal code we leave
  // the modal up until the user picks an action.
  const [rejoinAttempting, setRejoinAttempting] = useState(false);
  const [rejoinError, setRejoinError] = useState("");

  // Quiz game state
  const [quizQuestion, setQuizQuestion] = useState<QuizQuestionEvent | null>(null);
  const [quizMyResult, setQuizMyResult] = useState<QuizMyResult | null>(null);
  const [quizReveal, setQuizReveal] = useState<QuizRoundReveal | null>(null);
  // Public progress count ("X/N답함") — broadcast by the server every time
  // a player locks in an answer. Reset on each new question.
  const [quizProgress, setQuizProgress] = useState<QuizProgressEvent | null>(null);
  const [quizFinal, setQuizFinal] = useState<QuizGameEnd | null>(null);
  const [quizLiveScores, setQuizLiveScores] = useState<Record<string, number>>({});
  const [quizChatLog, setQuizChatLog] = useState<{ player_id: string; display_name: string; text: string; ts: number }[]>([]);
  const [myDisplayName, setMyDisplayName] = useState<string>("");

  // === DuchMind state ===
  const [dmChoosing, setDmChoosing] = useState<DmChoosingEvent | null>(null);
  const [dmWordChoices, setDmWordChoices] = useState<DmWordChoicesEvent | null>(null);
  const [dmDrawing, setDmDrawing] = useState<DmDrawingEvent | null>(null);
  const [dmDrawerWord, setDmDrawerWord] = useState<string | null>(null);
  const [dmDrawerImage, setDmDrawerImage] = useState<string | null>(null);
  const [dmHint, setDmHint] = useState<string>("");
  const [dmReveal, setDmReveal] = useState<DmTurnReveal | null>(null);
  const [dmFinal, setDmFinal] = useState<DmGameEnd | null>(null);
  const [dmChatLog, setDmChatLog] = useState<DmChatEvent[]>([]);
  // Monotonic id assigned to each chat message on arrival — used as React
  // list key downstream so a slice-window shift (cap at 200) doesn't force
  // the renderer to update every row's DOM content. Stable per message for
  // its lifetime in chatLog.
  const dmChatUidRef = useRef(1);
  const [dmLiveScores, setDmLiveScores] = useState<Record<string, number>>({});
  const [dmCorrectGuessers, setDmCorrectGuessers] = useState<Set<string>>(new Set());
  const [dmGivenUp, setDmGivenUp] = useState<Set<string>>(new Set());
  const [dmReplayStrokes, setDmReplayStrokes] = useState<DmStrokePayload[] | undefined>(undefined);
  // Per-turn capture gallery for DuchMind. Accumulates as each reveal arrives;
  // shown on the game-end result screen with a per-image download. Cleared
  // when the user clicks "로비로 돌아가기" (data is only kept in memory).
  const [dmCapturedTurns, setDmCapturedTurns] = useState<CapturedTurn[]>([]);
  // Transient 👍/👎 reactions floating on the canvas. Each gets a random
  // position (x/y as % of the canvas box) so a burst scatters across the
  // drawing instead of stacking in a corner. Auto-expires after ~1.6s;
  // capped at 20 concurrent so a spammer can't flood.
  const [dmReactions, setDmReactions] = useState<{ id: number; emoji: "up" | "down"; x: number; y: number }[]>([]);
  const dmReactionIdRef = useRef(0);
  // Increments on dm_close_hint so DuchMindGameView can clear the optimistic
  // chat for the close attempt (server doesn't broadcast it, on purpose).
  const [dmCloseHintTick, setDmCloseHintTick] = useState(0);

  // === Twenty Questions state ===
  const [twChoosing, setTwChoosing] = useState<import("@/components/multiplayer/TwentyGameView").TwChoosingEvent | null>(null);
  const [twTurn, setTwTurn] = useState<import("@/components/multiplayer/TwentyGameView").TwTurnEvent | null>(null);
  const [twCurrentQuestion, setTwCurrentQuestion] = useState<import("@/components/multiplayer/TwentyGameView").TwQuestionEvent | null>(null);
  const [twDrawerCardId, setTwDrawerCardId] = useState<number | null>(null);
  const [twDrawerCardName, setTwDrawerCardName] = useState<string | null>(null);
  const [twDrawerImage, setTwDrawerImage] = useState<string | null>(null);
  const [twQALog, setTwQALog] = useState<import("@/components/multiplayer/TwentyGameView").TwQALogEntry[]>([]);
  const [twChatLog, setTwChatLog] = useState<import("@/components/multiplayer/TwentyGameView").TwChatEvent[]>([]);
  const [twLiveScores, setTwLiveScores] = useState<Record<string, number>>({});
  const [twQuestionsRemaining, setTwQuestionsRemaining] = useState<number>(20);
  const [twTotalQuestions, setTwTotalQuestions] = useState<number>(20);
  const [twReveal, setTwReveal] = useState<import("@/components/multiplayer/TwentyGameView").TwTurnReveal | null>(null);
  const [twFinal, setTwFinal] = useState<import("@/components/multiplayer/TwentyGameView").TwGameEnd | null>(null);
  const [twGuessWindow, setTwGuessWindow] = useState<import("@/components/multiplayer/TwentyGameView").TwGuessWindowEvent | null>(null);
  const [twHandRaiseWindow, setTwHandRaiseWindow] = useState<import("@/components/multiplayer/TwentyGameView").TwHandRaiseWindowEvent | null>(null);

  // Lobby chat (visible only when not in_game)
  const [lobbyChat, setLobbyChat] = useState<{ player_id: string; display_name: string; text: string; ts: number }[]>([]);
  const [lobbyChatInput, setLobbyChatInput] = useState("");
  const lobbyChatScrollRef = useRef<HTMLDivElement>(null);
  // Lobby ready state — set of player_id strings currently flagged as ready
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  // Players currently within their disconnect grace window — show a "끊김"
  // indicator next to their name. Cleared when they reconnect or get auto-
  // removed (player_left clears via the server-side broadcast).
  const [offlineIds, setOfflineIds] = useState<Set<number>>(new Set());

  const sendRef = useRef<((data: unknown) => void) | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      getUserInfo().then((d) => { if (d?.username) setMyDisplayName(d.username); });
    } else {
      const g = getGuestSession();
      if (g && id && g.room_id === id) {
        setMyDisplayName(g.nickname);
      }
    }
    // wsReady is in deps so this effect re-runs after invite-link auto-join
    // persists the guest session to localStorage. Otherwise the guest's
    // display_name stays empty and ready/spectator buttons don't render.
  }, [id, wsReady]);

  const { status, closeReason, room: liveRoom, send, applyPlayerUpdate, myPlayerId, myIsSpectator, reconnect } = useRoomSocket({
    roomId: wsReady ? id : null,
    onMessage: (msg) => {
      if (msg.type === "quiz_question") {
        const q = msg as unknown as QuizQuestionEvent;
        setQuizQuestion(q);
        setQuizMyResult(null);
        setQuizReveal(null);
        // Seed progress from the question payload so a mid-round reconnect
        // already shows "답함 X/N" instead of nothing until the next answer.
        const seed = (msg as any).progress;
        setQuizProgress(seed ? { round: q.round, answered: seed.answered, total: seed.total } : null);
        setQuizFinal(null);
      } else if (msg.type === "quiz_my_result") {
        setQuizMyResult(msg as unknown as QuizMyResult);
      } else if (msg.type === "quiz_progress") {
        setQuizProgress(msg as unknown as QuizProgressEvent);
      } else if (msg.type === "quiz_round_reveal") {
        const ev = msg as unknown as QuizRoundReveal;
        setQuizReveal(ev);
        setQuizLiveScores(ev.scores || {});
      } else if (msg.type === "quiz_game_end") {
        setQuizFinal(msg as unknown as QuizGameEnd);
        setQuizQuestion(null);
        setQuizReveal(null);
        setQuizProgress(null);
        // Tell the Navbar (and other listeners) to refetch points balance.
        window.dispatchEvent(new Event("user-points-updated"));
      } else if (msg.type === "quiz_chat") {
        setQuizChatLog((prev) => [...prev.slice(-99), msg as any]);
      } else if (msg.type === "quiz_chat_history") {
        setQuizChatLog(((msg as any).messages || []) as any[]);
      } else if (msg.type === "game_started") {
        setQuizQuestion(null);
        setQuizMyResult(null);
        setQuizReveal(null);
        setQuizProgress(null);
        setQuizFinal(null);
        setQuizLiveScores({});
        setQuizChatLog([]);
        // also reset DuchMind
        setDmChoosing(null);
        setDmWordChoices(null);
        setDmDrawing(null);
        setDmDrawerWord(null);
        setDmDrawerImage(null);
        setDmHint("");
        setDmReveal(null);
        setDmFinal(null);
        setDmChatLog([]);
        setDmLiveScores({});
        setDmCorrectGuessers(new Set());
        setDmGivenUp(new Set());
        setDmCapturedTurns([]);
        // Force-wipe the canvas in case the previous game's strokes are
        // still in DuchMindGameView's stroke buffer (the per-turn wipe
        // effect can miss this if the new game's first key happens to
        // collide with the prior game's last key).
        window.dispatchEvent(new Event("dm-clear-canvas"));
        // also reset Twenty
        setTwChoosing(null);
        setTwTurn(null);
        setTwCurrentQuestion(null);
        setTwDrawerCardId(null);
        setTwDrawerCardName(null);
        setTwDrawerImage(null);
        setTwQALog([]);
        setTwChatLog([]);
        setTwLiveScores({});
        setTwQuestionsRemaining(20);
        setTwReveal(null);
        setTwFinal(null);
        setTwGuessWindow(null);
        setTwHandRaiseWindow(null);
      }
      // === DuchMind events ===
      else if (msg.type === "dm_choosing") {
        setDmChoosing(msg as unknown as DmChoosingEvent);
        setDmWordChoices(null);
        setDmDrawing(null);
        setDmDrawerWord(null);
        setDmDrawerImage(null);
        setDmHint("");
        setDmReveal(null);
        setDmCorrectGuessers(new Set());
        setDmGivenUp(new Set());
      } else if (msg.type === "dm_word_choices") {
        setDmWordChoices(msg as unknown as DmWordChoicesEvent);
      } else if (msg.type === "dm_drawing") {
        const ev = msg as unknown as DmDrawingEvent;
        setDmDrawing(ev);
        setDmHint(ev.hint || "");
        setDmReveal(null);
        setDmChoosing(null);
        setDmCorrectGuessers(new Set());
        setDmGivenUp(new Set());
      } else if (msg.type === "dm_deadline") {
        // Server-side deadline mutation (first-correct speedup option).
        // Patch the current drawing event so the local timer re-captures
        // via useDrawingLocalDeadline's identity hash.
        //
        // Prefer server-supplied `seconds_remaining` (computed at broadcast
        // time on the server clock) — falling back to a local subtraction
        // breaks for clients whose wall-clock runs ahead of the server,
        // floor-clamping the timer to 0 even though the round is still live.
        const newDeadline = Number((msg as any).deadline);
        const newSecondsRemaining = Number((msg as any).seconds_remaining);
        if (Number.isFinite(newDeadline)) {
          const secs = Number.isFinite(newSecondsRemaining)
            ? Math.max(0, newSecondsRemaining)
            : Math.max(0, newDeadline - Date.now() / 1000);
          setDmDrawing((d) => d ? { ...d, deadline: newDeadline, seconds_remaining: secs } : d);
        }
      } else if (msg.type === "dm_drawer_word") {
        console.log("[DEBUG] dm_drawer_word received:", msg);
        setDmDrawerWord((msg as any).word || null);
        setDmDrawerImage((msg as any).image_url || null);
      } else if (msg.type === "dm_hint") {
        setDmHint((msg as any).hint || "");
      } else if (msg.type === "dm_stroke") {
        const payload = (msg as any).payload as DmStrokePayload;
        if (payload) {
          window.dispatchEvent(new CustomEvent("dm-add-stroke", { detail: payload }));
        }
      } else if (msg.type === "dm_clear") {
        window.dispatchEvent(new Event("dm-clear-canvas"));
      } else if (msg.type === "dm_canvas_replay") {
        setDmReplayStrokes((msg as any).strokes || []);
      } else if (msg.type === "dm_resolved_replay") {
        const ev = msg as any;
        setDmCorrectGuessers(new Set((ev.correct_guesser_ids || []).map(String)));
        setDmGivenUp(new Set((ev.given_up_ids || []).map(String)));
      } else if (msg.type === "dm_chat") {
        const ev = msg as unknown as DmChatEvent;
        setDmChatLog((prev) => [...prev.slice(-199), { ...ev, _uid: dmChatUidRef.current++ }]);
        if (ev.kind === "correct") {
          setDmCorrectGuessers((prev) => new Set(prev).add(ev.player_id));
          if (ev.total_score !== undefined) {
            setDmLiveScores((prev) => ({ ...prev, [ev.player_id]: ev.total_score! }));
          }
        }
      } else if (msg.type === "dm_scores") {
        setDmLiveScores((msg as any).scores || {});
      } else if (msg.type === "dm_turn_reveal") {
        const ev = msg as unknown as DmTurnReveal;
        setDmReveal(ev);
        setDmDrawing(null);
        setDmLiveScores(ev.scores || {});
      } else if (msg.type === "dm_game_end") {
        console.log("[DEBUG] dm_game_end received:", msg);
        const ev = msg as unknown as DmGameEnd;
        setDmFinal(ev);
        setDmDrawing(null);
        setDmReveal(null);
        window.dispatchEvent(new Event("user-points-updated"));
      } else if (msg.type === "dm_given_up") {
        const ev = msg as any;
        setDmGivenUp((prev) => new Set(prev).add(String(ev.player_id)));
        setDmChatLog((prev) => [...prev.slice(-199), {
          player_id: String(ev.player_id),
          display_name: String(ev.display_name),
          kind: "wrong" as const,
          text: "🏳️ 포기했습니다",
          _uid: dmChatUidRef.current++,
        } as any]);
      } else if (msg.type === "dm_reaction") {
        const emoji = (msg as any).emoji;
        if (emoji === "up" || emoji === "down") {
          const id = ++dmReactionIdRef.current;
          // Random spot on the canvas, kept a bit inside the edges so the
          // glyph + its float animation stays visible.
          const x = 6 + Math.random() * 80;   // 6%–86%
          const y = 8 + Math.random() * 72;   // 8%–80%
          setDmReactions((prev) => [...prev.slice(-19), { id, emoji, x, y }]);
          setTimeout(() => setDmReactions((prev) => prev.filter((r) => r.id !== id)), 1600);
        }
      } else if (msg.type === "dm_my_correct") {
        // personal ack — already reflected via dm_chat; nothing to render extra
      } else if (msg.type === "dm_close_hint") {
        setDmChatLog((prev) => [...prev.slice(-199), {
          player_id: "_system",
          display_name: "[힌트]",
          kind: "wrong" as const,
          text: "정답에 가까워요!",
          _uid: dmChatUidRef.current++,
        } as any]);
        setDmCloseHintTick((n) => n + 1);
      } else if (msg.type === "dm_error") {
        const errMsg = (msg as any).message || "듀치마인드 오류가 발생했습니다.";
        setError(errMsg);
        setDmChoosing(null);
        setDmDrawing(null);
        setDmReveal(null);
      }
      // === Twenty Questions events ===
      else if (msg.type === "tw_choosing") {
        const ev = msg as any;
        setTwChoosing(ev);
        setTwTurn(null);
        setTwCurrentQuestion(null);
        setTwReveal(null);
        setTwQALog([]);
        const total = Number(ev.total_questions) || 20;
        setTwTotalQuestions(total);
        setTwQuestionsRemaining(total);
        setTwDrawerCardId(null);
        setTwDrawerCardName(null);
        setTwDrawerImage(null);
        setTwGuessWindow(null);
        setTwHandRaiseWindow(null);
      } else if (msg.type === "tw_turn") {
        setTwHandRaiseWindow(null);
        setTwTurn(msg as any);
        setTwCurrentQuestion(null);
        setTwChoosing(null);
        setTwQuestionsRemaining((msg as any).questions_remaining ?? twTotalQuestions);
      } else if (msg.type === "tw_question") {
        const ev = msg as any;
        setTwCurrentQuestion(ev);
        setTwQuestionsRemaining(twTotalQuestions - (ev.questions_used ?? 0));
        // Mirror the question into the unified chat stream so players don't
        // have to track it in two places.
        setTwChatLog((prev) => [...prev, {
          player_id: String(ev.asker_id || ""),
          display_name: String(ev.asker_name || ""),
          text: String(ev.text || ""),
          ts: Date.now() / 1000,
          kind: "question",
          question_text: String(ev.text || ""),
        }]);
      } else if (msg.type === "tw_answer") {
        const ev = msg as any;
        setTwCurrentQuestion(null);
        // Competitive: server sends a guess_window for the same asker; pause
        // the asker rotation UI until they guess or pass.
        if (ev.guess_window) {
          setTwGuessWindow(ev.guess_window);
          setTwTurn(null);
        } else if (ev.next_asker) {
          setTwTurn(ev.next_asker);
          setTwGuessWindow(null);
        }
        if (typeof ev.questions_remaining === "number") setTwQuestionsRemaining(ev.questions_remaining);
        // Append the resolved Q+A pair to the QA log AND the chat stream
        // (so the chat shows both the asked question and its answer in
        // context without forcing a side-panel jump).
        const cq = twCurrentQuestion;
        if (cq) {
          setTwQALog((prev) => [...prev, {
            asker_id: cq.asker_id, asker_name: cq.asker_name, text: cq.text, answer: ev.answer,
          }]);
          setTwChatLog((prev) => [...prev, {
            player_id: String(cq.asker_id || ""),
            display_name: String(cq.asker_name || ""),
            text: String(cq.text || ""),
            ts: Date.now() / 1000,
            kind: "qa_pair",
            question_text: String(cq.text || ""),
            answer: String(ev.answer || ""),
          }]);
        }
      } else if (msg.type === "tw_pass_guess") {
        const ev = msg as any;
        setTwGuessWindow(null);
        if (ev.hand_raise) {
          setTwHandRaiseWindow(ev.hand_raise);
          setTwTurn(null);
        } else if (ev.next_asker) {
          setTwHandRaiseWindow(null);
          setTwTurn(ev.next_asker);
        }
      } else if (msg.type === "tw_hand_raised") {
        const ev = msg as any;
        setTwHandRaiseWindow(null);
        if (ev.guess_window) setTwGuessWindow(ev.guess_window);
        const gw = ev.guess_window || {};
        setTwChatLog((prev) => [...prev, {
          player_id: String(gw.asker_id || ""),
          display_name: String(gw.asker_name || ""),
          text: "",
          ts: Date.now() / 1000,
          kind: "raise",
        }]);
      } else if (msg.type === "tw_pass_hand_guess") {
        const ev = msg as any;
        setTwGuessWindow(null);
        if (ev.hand_raise) {
          setTwHandRaiseWindow(ev.hand_raise);
          setTwTurn(null);
        } else if (ev.next_asker) {
          setTwHandRaiseWindow(null);
          setTwTurn(ev.next_asker);
        }
      } else if (msg.type === "tw_hand_raise_timeout") {
        const ev = msg as any;
        setTwHandRaiseWindow(null);
        if (ev.next_asker) setTwTurn(ev.next_asker);
      } else if (msg.type === "tw_guess") {
        const ev = msg as any;
        setTwQALog((prev) => [...prev, {
          asker_id: ev.guesser_id,
          asker_name: ev.guesser_name,
          text: `[정답 시도] ${ev.card_name}`,
          answer: ev.correct ? "correct" : "wrong",
        }]);
        setTwChatLog((prev) => [...prev, {
          player_id: String(ev.guesser_id || ""),
          display_name: String(ev.guesser_name || ""),
          text: String(ev.card_name || ""),
          ts: Date.now() / 1000,
          kind: "guess",
          card_name: String(ev.card_name || ""),
          correct: !!ev.correct,
        }]);
        setTwGuessWindow(null);
        if (ev.hand_raise) {
          setTwHandRaiseWindow(ev.hand_raise);
          setTwTurn(null);
        } else if (ev.next_asker) {
          setTwHandRaiseWindow(null);
          setTwTurn(ev.next_asker);
        }
        if (typeof ev.questions_used === "number") setTwQuestionsRemaining(twTotalQuestions - ev.questions_used);
      } else if (msg.type === "tw_pass") {
        const ev = msg as any;
        if (ev.next_asker) setTwTurn(ev.next_asker);
        setTwQALog((prev) => [...prev, {
          asker_id: twTurn?.asker_id || "",
          asker_name: twTurn?.asker_name || "",
          text: "[시간 초과 - 패스]",
          answer: "skip",
        }]);
      } else if (msg.type === "tw_round_skipped") {
        setTwChoosing(null);
        setTwTurn(null);
        setTwGuessWindow(null);
        setTwHandRaiseWindow(null);
      } else if (msg.type === "tw_turn_reveal") {
        const ev = msg as any;
        setTwReveal(ev);
        setTwTurn(null);
        setTwCurrentQuestion(null);
        setTwGuessWindow(null);
        setTwHandRaiseWindow(null);
        setTwLiveScores(ev.scores || {});
      } else if (msg.type === "tw_game_end") {
        setTwFinal(msg as any);
        setTwReveal(null);
        setTwChoosing(null);
        setTwTurn(null);
        setTwGuessWindow(null);
        setTwHandRaiseWindow(null);
        window.dispatchEvent(new Event("user-points-updated"));
      } else if (msg.type === "tw_chat") {
        setTwChatLog((prev) => [...prev.slice(-99), msg as any]);
      } else if (msg.type === "tw_chat_history") {
        setTwChatLog(((msg as any).messages || []) as any[]);
      } else if (msg.type === "tw_scores") {
        setTwLiveScores((msg as any).scores || {});
      } else if (msg.type === "tw_qa_log") {
        setTwQALog(((msg as any).entries || []) as any);
      } else if (msg.type === "tw_drawer_card") {
        const ev = msg as any;
        setTwDrawerCardId(ev.card_id ?? null);
        setTwDrawerCardName(ev.card_name ?? null);
        setTwDrawerImage(ev.image_url ?? null);
      } else if (msg.type === "tw_error") {
        setError((msg as any).message || "딱무고개 오류");
      }
      else if (msg.type === "player_offline") {
        const pid = Number((msg as any).player_id);
        if (!Number.isNaN(pid)) {
          setOfflineIds((prev) => { const next = new Set(prev); next.add(pid); return next; });
        }
      } else if (msg.type === "player_online") {
        const pid = Number((msg as any).player_id);
        if (!Number.isNaN(pid)) {
          setOfflineIds((prev) => { const next = new Set(prev); next.delete(pid); return next; });
        }
      } else if (msg.type === "player_left" || msg.type === "player_kicked") {
        const pid = Number((msg as any).player_id);
        if (!Number.isNaN(pid)) {
          setOfflineIds((prev) => { const next = new Set(prev); next.delete(pid); return next; });
        }
      } else if (msg.type === "ready_update") {
        const ids = ((msg as any).ready_ids || []) as string[];
        setReadyIds(new Set(ids.map(String)));
      } else if (msg.type === "lobby_chat") {
        const ev = msg as any;
        setLobbyChat((prev) => [...prev.slice(-49), {
          player_id: String(ev.player_id),
          display_name: String(ev.display_name),
          text: String(ev.text),
          ts: Number(ev.ts) || Date.now() / 1000,
          is_system: !!ev.is_system,
        } as any]);
      } else if (msg.type === "lobby_chat_history") {
        const msgs = ((msg as any).messages || []) as any[];
        setLobbyChat(msgs.map((m) => ({
          player_id: String(m.player_id),
          display_name: String(m.display_name),
          text: String(m.text),
          ts: Number(m.ts) || Date.now() / 1000,
          is_system: !!m.is_system,
        } as any)));
      } else if (msg.type === "dm_chat_history") {
        // Cap the replay-on-reconnect backlog at 200 — without this, a long
        // game's full chat history floods the client and bypasses the
        // streaming-side slice(-199) caps, causing progressive lag.
        const msgs = ((msg as any).messages || []) as any[];
        setDmChatLog(msgs.slice(-200).map((m) => ({ ...m, _uid: dmChatUidRef.current++ })) as any);
      } else if (msg.type === "room_closed") {
        const reasonMsg = (msg as any).message || "방이 종료되었습니다.";
        alert(reasonMsg);
        navigate("/multiplayer");
      }
    },
  });
  sendRef.current = send;
  const room = liveRoom || initialRoom;
  // Prefer the WS-supplied player id (always trustworthy). Before the WS
  // connect event arrives we fall back to the value baked into the REST
  // payloads (server-derived from auth) and finally the guest session
  // (set after a successful join). Without this fallback the spectator/
  // ready buttons stay hidden on first render in anonymous rooms because
  // display_name lookups don't match the user's real nickname.
  const fallbackPlayerId = (() => {
    if (initialRoom?.your_player_id != null) return initialRoom.your_player_id;
    if (id) {
      const g = getGuestSession();
      if (g && g.room_id === id) return g.player_id;
    }
    return null;
  })();
  const effectiveMyPlayerId = myPlayerId ?? fallbackPlayerId;

  // Initial REST fetch (so we have something even before WS connects). When
  // we arrive via an invite link (?invite=<room_code>), auto-join with the
  // invite token so the user bypasses the password prompt.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        if (stealthMode) {
          // Admin-only stealth join — server validates `is_staff` and creates
          // a hidden spectator. Non-admins get an `allow_guests`-style error
          // (they're treated as a normal join attempt without the stealth
          // bypass).
          const r = await joinRoom(id, "", "", false, true);
          if (!cancelled) {
            setInitialRoom(r);
            setSearchParams({}, { replace: true });
            setWsReady(true);
          }
          return;
        }
        // Always start with a read-only fetch — never POST until the user
        // has explicitly accepted the invite. This blocks chat-preview bots
        // from spawning ghost guests by simply rendering the page.
        const r = await getRoom(id);
        if (!cancelled) setInitialRoom(r);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "방 입장 실패");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleAcceptInvite = async (asSpectator: boolean = false) => {
    if (!id) return;
    setAcceptingInvite(true);
    setError("");
    try {
      const r = await joinRoom(id, "", inviteCode, asSpectator);
      if (r._guest) {
        setGuestSession({ ...r._guest, room_id: id });
      }
      setInitialRoom(r);
      setSearchParams({}, { replace: true });
      setPendingInvite(false);
      setWsReady(true);
    } catch (e: any) {
      setError(e?.message || "방 입장 실패");
    } finally {
      setAcceptingInvite(false);
    }
  };

  // Re-join after the server dropped us past grace (closeReason === "removed").
  // Reuses the existing inviteCode + last known role; if the room has a
  // password we never stored, the request will fail and the user should
  // navigate out and re-enter manually.
  const handleRejoin = async () => {
    if (!id) return;
    setRejoinAttempting(true);
    setRejoinError("");
    try {
      const r = await joinRoom(id, "", inviteCode, !!myIsSpectator);
      if (r._guest) {
        setGuestSession({ ...r._guest, room_id: id });
      }
      setInitialRoom(r);
      reconnect();
    } catch (e: any) {
      setRejoinError(e?.message || "재입장 실패");
    } finally {
      setRejoinAttempting(false);
    }
  };

  // Scroll to top when the result screen activates so the rank list is in view.
  const showResultScreenForScroll = !!(
    room && room.status !== "in_game" && (quizFinal || dmFinal || twFinal)
  );
  useEffect(() => {
    if (showResultScreenForScroll) {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
  }, [showResultScreenForScroll]);

  // Auto-scroll the lobby chat to the bottom whenever a new message arrives.
  useLayoutEffect(() => {
    if (lobbyChatScrollRef.current) {
      lobbyChatScrollRef.current.scrollTop = lobbyChatScrollRef.current.scrollHeight;
    }
  }, [lobbyChat.length]);


  // Detect kick: if I'm no longer in the player list while connected, redirect
  const myUserId = (() => {
    try {
      const token = localStorage.getItem("access_token") || "";
      const payload = JSON.parse(atob(token.split(".")[1] || ""));
      return payload.user_id as number | undefined;
    } catch { return undefined; }
  })();

  useEffect(() => {
    if (!room || !myUserId) return;
    if (status !== "connected") return;
    const stillIn = room.players.some(p => !p.is_guest && /* heuristic via host_id check below */ true);
    // Simpler check: if the player list doesn't include any matching identity, kick happened.
    // Backend doesn't expose user IDs per player to non-host; we can rely on display_name match.
    if (!stillIn) {
      // ignore for now; reliable kick handling needs user_id in player serializer
    }
  }, [room, status, myUserId]);

  const handleLeave = async () => {
    if (!id) return;
    try { await leaveRoom(id); } catch {}
    navigate("/multiplayer");
  };

  const handleLeaveDuringGame = async () => {
    if (!id || !room) return;
    const meIsActive = !!meInRoom && !meInRoom.is_spectator;
    const activeCount = room.players.filter((p) => !p.is_spectator).length;
    // If I'm one of exactly two participants, my leaving will trigger the
    // backend's auto-end-game path. Warn explicitly so it's not a surprise.
    const willEndGame = room.status === "in_game" && meIsActive && activeCount === 2;
    const msg = willEndGame
      ? "퇴장 시 참가자가 부족해 게임이 종료됩니다.\n정말 나가시겠습니까?"
      : "게임이 진행 중입니다. 정말 나가시겠습니까?";
    if (!confirm(msg)) return;
    try { await leaveRoom(id); } catch {}
    navigate("/multiplayer");
  };

  // Host-only "end game" path triggered from the leave-modal. Just
  // finalizes the game (status → waiting, score payout, result screen)
  // and keeps the host in the room so everyone can see the scoreboard
  // together and return to the lobby.
  const handleEndGameAndLeave = async () => {
    if (!id) return;
    setHostLeaveModalOpen(false);
    try { await endGame(id); } catch (e: any) { setError(e.message); }
  };

  // Host-only "exit (just leave)" path. Backend auto-transfers host on
  // leave. If only 2 active players are in-game, leaving auto-ends the
  // game — warn the host explicitly so it's not a surprise.
  const handleHostExit = async () => {
    if (!id || !room) return;
    setHostLeaveModalOpen(false);
    const meIsActive = !!meInRoom && !meInRoom.is_spectator;
    const activeCount = room.players.filter((p) => !p.is_spectator).length;
    const willEndGame = room.status === "in_game" && meIsActive && activeCount <= 2;
    if (willEndGame) {
      if (!confirm("퇴장 시 참가자가 부족해 게임이 종료됩니다.\n정말 나가시겠습니까?")) return;
    }
    try { await leaveRoom(id); } catch {}
    navigate("/multiplayer");
  };

  const handleCloseRoom = async () => {
    if (!id) return;
    if (!confirm("방을 종료하시겠습니까? 모든 플레이어가 즉시 쫓겨납니다.")) return;
    try {
      await closeRoom(id);
      navigate("/multiplayer");
    } catch (e: any) {
      setError(e.message || "방 종료 실패");
    }
  };

  const handleKick = async (playerId: number) => {
    if (!id) return;
    if (!confirm("이 플레이어를 강퇴하시겠습니까?")) return;
    try { await kickPlayer(id, playerId); } catch (e: any) { setError(e.message); }
  };

  const handleToggleSpectator = async () => {
    if (!id) return;
    try {
      const updated = await toggleSpectator(id);
      // Manually merge the response into liveRoom — don't wait for the
      // broadcast (which can race the local re-render and leave the ready
      // button hidden after a spectator→player switch).
      applyPlayerUpdate(updated);
    } catch (e: any) { setError(e.message || "전환 실패"); }
  };

  // In-game spectators reserve a seat for the next turn instead of being
  // spliced into the running rotation immediately. One-way action — once
  // reserved the button becomes a disabled status indicator.
  const handleReserveForNext = async () => {
    if (!id) return;
    try {
      const updated = await reserveForNext(id);
      applyPlayerUpdate(updated);
    } catch (e: any) { setError(e.message || "예약 실패"); }
  };

  const handleTransferHost = async (playerId: number, name: string) => {
    if (!id) return;
    if (!confirm(`${name}님에게 방장을 넘기시겠습니까?`)) return;
    try { await transferHost(id, playerId); } catch (e: any) { setError(e.message || "방장 위임 실패"); }
  };

  const handleSaveSettings = async (
    formName: string,
    formGame: GameId,
    formMaxPlayers: number,
    formIsPublic: boolean,
    pwAction: "keep" | "clear" | "set",
    pwValue: string,
    formQuizRounds: number,
    formQuizPack: number | null,
    formDmRounds: number,
    formDmPack: number | null,
    formSpectatorsCanChat: boolean,
    formAllowGuests: boolean,
    formDmDrawSeconds: number,
    formDmWordOptions: number,
    formDmShowWordLength: boolean,
    formDmShowHints: boolean,
    formDmHideWinnerChat: boolean,
    formDmFirstCorrectSpeedup: boolean,
    formTwRounds: number,
    formTwMode: "competitive" | "cooperative",
    formTwAttempts: number,
  ) => {
    if (!id) return;
    setSavingSettings(true);
    setError("");
    try {
      const data: any = {
        name: formName.trim(),
        current_game: formGame,
        max_players: formMaxPlayers,
        is_listed: formIsPublic,
        spectators_can_chat: formSpectatorsCanChat,
        allow_guests: formAllowGuests,
      };
      if (formGame === "quiz") {
        data.quiz_total_rounds = formQuizRounds;
        data.quiz_word_pack = formQuizPack;
      }
      if (formGame === "duchmind") {
        data.duchmind_total_rounds = formDmRounds;
        data.duchmind_word_pack = formDmPack;
        data.duchmind_draw_seconds = formDmDrawSeconds;
        data.duchmind_word_options = formDmWordOptions;
        data.duchmind_show_word_length = formDmShowWordLength;
        data.duchmind_show_hints = formDmShowHints;
        data.duchmind_hide_winner_chat = formDmHideWinnerChat;
        data.duchmind_first_correct_speedup = formDmFirstCorrectSpeedup;
      }
      if (formGame === "twenty") {
        data.twenty_total_rounds = formTwRounds;
        data.twenty_mode = formTwMode;
        data.twenty_guess_attempts = formTwAttempts;
      }
      if (pwAction === "clear") data.password = "";
      else if (pwAction === "set") data.password = pwValue;
      // "keep" → omit
      await updateRoom(id, data);
      setShowSettings(false);
    } catch (e: any) {
      setError(e.message || "설정 변경 실패");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleStartGame = async () => {
    if (!id) return;
    try { await startGame(id); } catch (e: any) { setError(e.message); }
  };

  const handleEndGame = async () => {
    if (!id) return;
    if (!confirm("게임을 종료하시겠습니까?")) return;
    try { await endGame(id); } catch (e: any) { setError(e.message); }
  };

  const handleCopyCode = () => {
    if (!room) return;
    const url = `${window.location.origin}/multiplayer/rooms/${room.id}?invite=${encodeURIComponent(room.code)}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Hide global site chrome (navbar/footer/tabbar) while a canvas-style
  // game is active so the layout can claim the full viewport without
  // anything pushing it past 100svh and triggering a page scroll. CSS
  // hooks into body.mp-in-game in index.css. Placed before any early
  // return so React's hook ordering stays consistent across renders.
  const _isCanvasGame = !!(
    liveRoom && liveRoom.status === "in_game" &&
    (liveRoom.current_game === "duchmind" || liveRoom.current_game === "twenty")
  );
  useEffect(() => {
    const cls = "mp-in-game";
    if (_isCanvasGame) {
      document.body.classList.add(cls);
    } else {
      document.body.classList.remove(cls);
    }
    return () => { document.body.classList.remove(cls); };
  }, [_isCanvasGame]);

  // Track on-screen-keyboard state via JS instead of CSS :has(input:focus).
  // iPadOS Safari sometimes drops the :has() match during phase
  // transitions (e.g. when the opponent starts choosing a card and a
  // re-render briefly disturbs focus tracking), leaving the input
  // trapped under the keyboard. focusin/focusout + visualViewport are
  // more reliable signals.
  useEffect(() => {
    if (!_isCanvasGame) return;
    const isInput = (el: EventTarget | null) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const t = el.tagName;
      return t === "INPUT" || t === "TEXTAREA" || el.isContentEditable;
    };
    const setKbd = (on: boolean) => {
      document.body.classList.toggle("mp-kbd-up", on);
    };
    const onFocusIn = (e: FocusEvent) => { if (isInput(e.target)) setKbd(true); };
    const onFocusOut = (e: FocusEvent) => {
      // Use the related target to detect cross-input refocus without flicker
      if (!isInput((e as any).relatedTarget)) setKbd(false);
    };
    const onViewportResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      // Treat any meaningful shrink (>120px) vs window height as keyboard.
      const shrunk = window.innerHeight - vv.height > 120;
      setKbd(shrunk);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      document.body.classList.remove("mp-kbd-up");
    };
  }, [_isCanvasGame]);

  if (error && !room) {
    return (
      <div className="min-h-screen px-0 sm:px-4 py-6 max-w-lg mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
          <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          <button
            onClick={() => navigate("/multiplayer")}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
          >
            방 목록으로
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen px-0 sm:px-4 py-6 max-w-lg mx-auto">
        <p className="text-center text-gray-500">로딩 중...</p>
      </div>
    );
  }

  // Invite-link confirm gate — blocks bot previews from auto-spawning guests.
  if (pendingInvite) {
    const game = getGameInfo(room.current_game);
    return (
      <div className="min-h-screen px-4 py-10 max-w-md mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 text-center">
          <h1 className="text-xl font-bold mb-2">방 입장</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            아래 방에 입장하시겠습니까?
          </p>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-5 text-left space-y-1">
            <p className="font-bold">{room.name}</p>
            <p className="text-sm text-gray-500">방장: {room.host_name}</p>
            {game && <p className="text-sm text-gray-500">{game.icon} {game.label}</p>}
            <p className="text-sm text-gray-500">
              {STATUS_LABEL[room.status]} · 인원 {room.players.filter((p) => !p.is_spectator).length}/{room.max_players}
            </p>
          </div>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleAcceptInvite(false)}
              disabled={acceptingInvite}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {acceptingInvite ? "입장 중..." : "참가자로 입장"}
            </button>
            <button
              onClick={() => handleAcceptInvite(true)}
              disabled={acceptingInvite}
              className="w-full py-3 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 disabled:opacity-50"
            >
              관전자로 입장
            </button>
            <button
              onClick={() => navigate("/multiplayer")}
              disabled={acceptingInvite}
              className="w-full py-3 bg-gray-200 dark:bg-gray-700 rounded-lg font-semibold disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isHost = myUserId !== undefined && room.host === myUserId;
  const game = getGameInfo(room.current_game);

  const inGame = room.status === "in_game";
  const isDuchMindInGame = inGame && room.current_game === "duchmind";
  const isTwentyInGame = inGame && room.current_game === "twenty";
  // Prefer player_id (server-provided on connect, anon-room safe). Fall back
  // to display_name match for code paths that haven't received the id yet.
  const meInRoom = room.players.find((p) =>
    effectiveMyPlayerId != null ? p.id === effectiveMyPlayerId : p.display_name === myDisplayName
  );
  // Stealth (운영진 유령입장) players are excluded from the public players
  // list, so meInRoom is undefined for them. Fall back to the server-supplied
  // myIsSpectator ONLY in that case — for normal players we trust meInRoom,
  // because myIsSpectator comes from the initial `connected` event and
  // doesn't refresh when a reservation gets promoted (causing the
  // "🕐 입장 예약됨" pill to stay until page reload).
  const amSpectator = meInRoom ? !!meInRoom.is_spectator : !!myIsSpectator;
  const chatLockedForMe = amSpectator && !room.spectators_can_chat;
  const showResultScreen = !inGame && (quizFinal || dmFinal || twFinal);

  // === Standalone end-of-game result screen ===
  if (showResultScreen) {
    const ranked = (dmFinal?.ranked || quizFinal?.ranked || twFinal?.ranked || []) as any;
    const label = dmFinal ? "🎨 듀치마인드"
      : quizFinal ? "🐤 화질구지 퀴즈"
      : twFinal ? "❓ 딱무고개"
      : undefined;
    return (
      <div className="min-h-screen sm:px-4 sm:mx-auto sm:py-6 px-0 py-0 max-w-2xl mx-auto sm:max-w-2xl">
        <GameResultScreen
          ranked={ranked}
          gameLabel={label}
          gallery={dmFinal ? dmCapturedTurns : undefined}
          onBackToLobby={() => {
            setQuizFinal(null);
            setDmFinal(null);
            setTwFinal(null);
            setDmCapturedTurns([]);
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-wide-game={isDuchMindInGame || isTwentyInGame ? "true" : undefined}
      className={
        // DuchMind / Twenty in-game intentionally drops ALL sm padding so
        // the canvas can use the full viewport width (especially on iPad
        // portrait, where the default sm:px-4 ate 32px and made the canvas
        // noticeably smaller). The lg:* viewport-lock block is also gated
        // by !isCompactPortrait — without it, iPad portrait in Safari's
        // "request desktop site" mode (which reports innerWidth ≥ 1024)
        // gets h-svh + max-h-1080 + overflow-hidden, clamping the canvas
        // height. Other states keep sm padding for breathing room.
        (isDuchMindInGame || isTwentyInGame)
          ? `px-0 py-0 mx-auto ${isCompactPortrait ? "" : "lg:h-svh lg:max-w-[1920px] lg:max-h-[1080px] lg:overflow-hidden lg:flex lg:flex-col"}`
          : inGame
            ? "sm:px-4 sm:mx-auto sm:py-6 min-h-screen px-0 py-0 max-w-2xl mx-auto sm:max-w-2xl"
            : "sm:px-4 sm:mx-auto sm:py-6 min-h-screen px-0 py-6 max-w-2xl mx-auto sm:max-w-2xl md:max-w-7xl"
      }>
      {!inGame && (
        <button
          onClick={() => navigate("/multiplayer")}
          className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          ← 방 목록
        </button>
      )}
      <div className={isCompactPortrait ? "" : "md:grid md:grid-cols-[640px_1fr] md:gap-4 md:items-start"}>
      <div className="md:min-w-0">
      {!inGame && (
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{room.name}</h1>
            {game && (
              <div className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                <span>{game.icon}</span>
                <span>{game.label}</span>
              </div>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              방장: {room.host_name}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className={`inline-block text-xs px-2 py-1 rounded ${
              status === "connected" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
              : status === "connecting" ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700"
              : "bg-red-100 dark:bg-red-900/30 text-red-700"
            }`}>
              {status === "connected" ? "● 연결됨"
                : status === "connecting" ? "연결 중"
                : "연결 끊김"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 shrink-0">초대 링크:</span>
          <button
            onClick={handleCopyCode}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 shrink-0"
          >
            {copied ? "✓ 복사됨" : "🔗 링크 복사"}
          </button>
          <span className="text-xs text-gray-400 truncate min-w-0">비번 없이 입장 가능</span>
        </div>
      </div>
      )}

      {isHost && room.status === "waiting" && (
        <div className="mb-4">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-4 py-2 bg-white dark:bg-gray-800 rounded-xl shadow text-sm font-semibold flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <span>⚙ 방 설정</span>
            <span className="text-gray-400">{showSettings ? "▲" : "▼"}</span>
          </button>
          {showSettings && (
            <RoomSettingsForm
              room={room}
              saving={savingSettings}
              onSave={handleSaveSettings}
              onCancel={() => setShowSettings(false)}
            />
          )}
        </div>
      )}

      {!isHost && !inGame && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-4 py-1 mb-4">
          <RoomRulesPanel room={room} />
        </div>
      )}

      {!inGame && (() => {
        const activePlayers = room.players.filter((p) => !p.is_spectator);
        const spectators = room.players.filter((p) => p.is_spectator);
        const ordered = [...activePlayers, ...spectators];
        return (
          <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">
                플레이어 ({activePlayers.length}/{room.max_players})
                {spectators.length > 0 && (
                  <span className="text-xs text-gray-500 ml-2">+ 관전 {spectators.length}</span>
                )}
              </h2>
              <span className="text-xs text-gray-500">{STATUS_LABEL[room.status]}</span>
            </div>

            <div className="space-y-3">
              {ordered.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    p.is_spectator
                      ? "bg-gray-100 dark:bg-gray-900/40 opacity-80"
                      : "bg-gray-50 dark:bg-gray-900"
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="md:hidden">
                      <Avatar icon={p.avatar_icon} border={p.border} size={40} className="shrink-0" />
                    </div>
                    <div className="hidden md:block">
                      <Avatar icon={p.avatar_icon} border={p.border} size={60} className="shrink-0" />
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      {p.is_host && <span className="text-base shrink-0">👑</span>}
                      {!p.is_host && !p.is_spectator && readyIds.has(String(p.id)) && (
                        <span className="text-base shrink-0 text-green-600 dark:text-green-400" title="준비 완료">✅</span>
                      )}
                      <span className="font-medium truncate">{p.display_name}</span>
                      {offlineIds.has(p.id) && (
                        <span className="text-base shrink-0 text-orange-500" title="접속 끊김 (잠시 자리 비움)">📡</span>
                      )}
                      {p.is_spectator && (
                        <span className="text-xs text-gray-500 shrink-0">(관전)</span>
                      )}
                      {p.is_guest && <span className="text-xs text-gray-500">(게스트)</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isHost && !p.is_host && !p.is_spectator && !p.is_guest && (
                      <button
                        onClick={() => handleTransferHost(p.id, p.display_name)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        방장 위임
                      </button>
                    )}
                    {isHost && !p.is_host && (
                      <button
                        onClick={() => handleKick(p.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        강퇴
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {room.status === "waiting" && isHost && (() => {
        const activePlayers = room.players.filter((p) => !p.is_spectator);
        const nonHostActive = activePlayers.filter((p) => !p.is_host);
        const allReady = nonHostActive.length > 0 && nonHostActive.every((p) => readyIds.has(String(p.id)));
        const tooFew = activePlayers.length < 2;
        const noGame = !room.current_game;
        const disabled = tooFew || noGame || !allReady;
        let label = "게임 시작";
        if (tooFew) label += " (최소 2명 필요)";
        else if (!allReady) label += ` (${nonHostActive.filter((p) => readyIds.has(String(p.id))).length}/${nonHostActive.length} 준비됨)`;
        return (
          <button
            onClick={handleStartGame}
            disabled={disabled}
            className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {label}
          </button>
        );
      })()}

      {room.status === "waiting" && !isHost && (() => {
        const me = room.players.find((p) =>
          effectiveMyPlayerId != null ? p.id === effectiveMyPlayerId : p.display_name === myDisplayName
        );
        if (!me) return null;
        const myReady = readyIds.has(String(me.id));
        return (
          <div className="flex flex-col gap-2 mb-4">
            {!me.is_spectator && (
              <button
                onClick={() => sendRef.current?.({ type: "set_ready", ready: !myReady })}
                className={`w-full py-3 rounded-xl font-bold text-lg transition ${
                  myReady
                    ? "bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-600"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {myReady ? "⏳ 준비 취소" : "✅ 준비"}
              </button>
            )}
            <button
              onClick={handleToggleSpectator}
              className="w-full py-2 rounded-lg font-semibold text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50"
            >
              {me.is_spectator ? "↪ 플레이로 전환" : "👀 관전으로 전환"}
            </button>
          </div>
        );
      })()}


      {!inGame && (
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="flex-1 py-3 bg-gray-200 dark:bg-gray-700 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            방 나가기
          </button>
          {isHost && (
            <button
              onClick={handleCloseRoom}
              className="flex-1 py-3 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600"
            >
              방 닫기
            </button>
          )}
        </div>
      )}
      </div>
      <div className="md:min-w-0">
      {!inGame && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mt-4 md:mt-0">
          <h2 className="font-bold mb-2 text-sm">💬 로비 채팅</h2>
          <div ref={lobbyChatScrollRef} className="bg-gray-50 dark:bg-gray-900 rounded p-2 mb-2 text-sm md:text-lg overflow-y-auto h-40 md:h-96">
            {lobbyChat.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">아직 메시지가 없습니다.</p>
            ) : (
              lobbyChat.map((m, i) => {
                if ((m as any).is_system) {
                  return (
                    <div key={i} className="text-left font-semibold text-gray-500 dark:text-gray-400 break-words leading-tight mb-0.5">
                      [시스템] {m.text}
                    </div>
                  );
                }
                const sender = room.players.find((p) => String(p.id) === m.player_id);
                const isSpec = sender?.is_spectator;
                return (
                  <div key={i} className="flex items-center gap-1.5 break-words mb-0.5 leading-tight">
                    {sender && (
                      <>
                        <span className="md:hidden">
                          <Avatar icon={sender.avatar_icon} border={sender.border} size={20} className="shrink-0" />
                        </span>
                        <span className="hidden md:inline-flex">
                          <Avatar icon={sender.avatar_icon} border={sender.border} size={28} className="shrink-0" />
                        </span>
                      </>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className={`font-semibold ${isSpec ? "text-gray-500 dark:text-gray-400" : "text-blue-600 dark:text-blue-400"}`}>
                        {m.display_name}
                      </span>
                      <span className="text-gray-400 mx-1">:</span>
                      <span>{m.text}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (chatLockedForMe) return;
              const t = lobbyChatInput.trim();
              if (!t) return;
              sendRef.current?.({ type: "lobby_chat", text: t });
              setLobbyChatInput("");
            }}
            className="flex gap-1"
          >
            <input
              type="text"
              value={lobbyChatInput}
              onChange={(e) => setLobbyChatInput(e.target.value)}
              placeholder={chatLockedForMe ? "관전자 채팅이 비활성화되어 있습니다" : "메시지 입력..."}
              disabled={chatLockedForMe}
              maxLength={200}
              className="flex-1 min-w-0 px-2 py-1 md:py-2 border rounded bg-white dark:bg-gray-800 text-base sm:text-sm md:text-base disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!lobbyChatInput.trim() || chatLockedForMe}
              className="shrink-0 px-3 py-1 md:py-2 bg-blue-600 text-white rounded text-sm md:text-base font-semibold disabled:opacity-40"
            >
              전송
            </button>
          </form>
        </div>
      )}

      {!inGame && game && game.rules.length > 0 && (
        <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <h2 className="font-bold mb-2 text-blue-900 dark:text-blue-200 flex items-center gap-1">
            <span>{game.icon}</span>
            <span>{game.label} 규칙</span>
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-left text-gray-700 dark:text-gray-300">
            {game.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      </div>
      </div>

      {room.status === "in_game" && (
        <div className="flex-1 min-h-0 flex flex-col mb-0">
          {room.current_game === "quiz" ? (
            <QuizGameView
              question={quizQuestion}
              myResult={quizMyResult}
              reveal={quizReveal}
              progress={quizProgress}
              finalResult={quizFinal}
              onAnswer={(choice) => sendRef.current?.({ type: "submit_answer", choice })}
              onChat={(text) => sendRef.current?.({ type: "quiz_chat", text })}
              chatLog={quizChatLog}
              players={room.players}
              liveScores={quizLiveScores}
              selfDisplayName={myDisplayName}
              selfPlayerId={effectiveMyPlayerId}
              isHost={isHost}
              amSpectator={amSpectator}
              amReservedForNext={!!meInRoom?.reserved_for_next}
              onJoinGame={handleReserveForNext}
              onKickPlayer={handleKick}
              chatLocked={chatLockedForMe}
            />
          ) : room.current_game === "duchmind" ? (
            <DuchMindGameView
              choosing={dmChoosing}
              myWordChoices={dmWordChoices}
              drawing={dmDrawing}
              drawerWord={dmDrawerWord}
              drawerImageUrl={dmDrawerImage}
              hint={dmHint}
              reveal={dmReveal}
              finalResult={dmFinal}
              chatLog={dmChatLog}
              liveScores={dmLiveScores}
              correctGuesserIds={dmCorrectGuessers}
              givenUpIds={dmGivenUp}
              players={room.players}
              selfDisplayName={myDisplayName}
              selfPlayerId={effectiveMyPlayerId}
              onChooseWord={(cardId, name) => sendRef.current?.({ type: "dm_choose_word", card_id: cardId, word: name })}
              onStroke={(payload) => sendRef.current?.({ type: "dm_stroke", payload })}
              onClear={() => sendRef.current?.({ type: "dm_clear" })}
              onUndo={() => sendRef.current?.({ type: "dm_undo" })}
              onGiveUp={() => sendRef.current?.({ type: "dm_give_up" })}
              onChat={(text) => sendRef.current?.({ type: "dm_chat", text })}
              onReact={(emoji) => sendRef.current?.({ type: "dm_react", emoji })}
              onTurnCaptured={(cap) => setDmCapturedTurns((prev) =>
                prev.some((p) => p.id === cap.id) ? prev : [...prev, cap]
              )}
              reactions={dmReactions}
              replayStrokes={dmReplayStrokes}
              amSpectator={amSpectator}
              amReservedForNext={!!meInRoom?.reserved_for_next}
              chatLockedExternal={chatLockedForMe}
              closeHintTick={dmCloseHintTick}
              onJoinGame={handleReserveForNext}
              onLeave={() => {
                // Host always sees the chooser modal: 게임 종료 vs 퇴장.
                // The "퇴장" path itself prompts a 2-player end-game
                // warning when applicable. Non-hosts get the plain
                // confirm path.
                if (isHost && room.status === "in_game") {
                  setHostLeaveModalOpen(true);
                } else {
                  handleLeaveDuringGame();
                }
              }}
              isHost={isHost}
              onKickPlayer={handleKick}
              packSeries={room.duchmind_word_pack_series || "yugioh"}
            />
          ) : room.current_game === "twenty" ? (
            <TwentyGameView
              choosing={twChoosing}
              drawerCardId={twDrawerCardId}
              drawerCardName={twDrawerCardName}
              drawerImageUrl={twDrawerImage}
              turn={twTurn}
              currentQuestion={twCurrentQuestion}
              reveal={twReveal}
              finalResult={twFinal}
              qaLog={twQALog}
              chatLog={twChatLog}
              liveScores={twLiveScores}
              questionsRemaining={twQuestionsRemaining}
              totalQuestions={twTotalQuestions}
              players={room.players}
              selfDisplayName={myDisplayName}
              selfPlayerId={effectiveMyPlayerId}
              twentyMode={room.twenty_mode || "competitive"}
              guessWindow={twGuessWindow}
              handRaiseWindow={twHandRaiseWindow}
              onPassGuess={() => sendRef.current?.({ type: "tw_pass_guess" })}
              onRaiseHand={() => sendRef.current?.({ type: "tw_raise_hand" })}
              onPassHandGuess={() => sendRef.current?.({ type: "tw_pass_hand_guess" })}
              onChooseCard={(cardId, name) => {
                // Capture locally so drawer remembers their card.
                setTwDrawerCardId(cardId);
                setTwDrawerCardName(name);
                // Try to find image from the result the drawer just clicked.
                // Search results aren't kept here — fetch image if needed via search.
                sendRef.current?.({ type: "tw_choose_card", card_id: cardId, card_name: name });
              }}
              onSubmitQuestion={(text) => sendRef.current?.({ type: "tw_submit_question", text })}
              onSubmitAnswer={(answer) => sendRef.current?.({ type: "tw_submit_answer", answer })}
              onSubmitGuess={(cardId) => sendRef.current?.({ type: "tw_submit_guess", card_id: cardId })}
              onChat={(text) => sendRef.current?.({ type: "tw_chat", text })}
              amSpectator={amSpectator}
              chatLockedExternal={chatLockedForMe}
              onLeave={handleLeaveDuringGame}
              onEndGame={handleEndGame}
              isHost={isHost}
            />
          ) : (
            <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 text-center text-sm text-gray-500">
              🎮 게임이 진행 중입니다 — {game?.label || room.current_game}
            </div>
          )}
          {/* The standalone "게임 종료" + "방 나가기" footer buttons used
              to live here. Both are now reachable from the in-game status
              bar (🚪 icon). For host, the leave button opens a chooser
              modal (end game vs. transfer host) — see hostLeaveModal
              below. This frees ~50px of vertical space, which is the
              difference between chat being usable vs. invisible on small
              phones. */}
        </div>
      )}

      {hostLeaveModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setHostLeaveModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-5 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2">방장 동작</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              게임을 종료할지, 본인만 퇴장할지 선택하세요. 퇴장 시 방장은 자동으로 다른 사람에게 넘어갑니다.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleEndGameAndLeave}
                className="w-full py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600"
              >
                게임 종료
              </button>
              <button
                onClick={handleHostExit}
                className="w-full py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600"
              >
                퇴장
              </button>
              <button
                onClick={() => setHostLeaveModalOpen(false)}
                className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal-close prompt — server dropped us (grace expired / room
          closed / auth lost) and the WS layer surfaced a closeReason. We
          stay on the page until the user picks an action so they don't
          lose their place if rejoin succeeds. */}
      {(closeReason === "removed" || closeReason === "not_found" || closeReason === "auth") && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-5 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-2">
              {closeReason === "removed" && "방에서 나가졌습니다"}
              {closeReason === "not_found" && "방이 종료되었습니다"}
              {closeReason === "auth" && "로그인이 만료되었습니다"}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {closeReason === "removed" && "장기간 미접속으로 방에서 자동 퇴장 처리되었습니다. 다시 입장하시겠어요?"}
              {closeReason === "not_found" && "방이 닫혔거나 더 이상 존재하지 않습니다."}
              {closeReason === "auth" && "다시 로그인 후 방에 입장해주세요."}
            </p>
            {rejoinError && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">{rejoinError}</p>
            )}
            <div className="flex flex-col gap-2">
              {closeReason === "removed" && (
                <button
                  onClick={handleRejoin}
                  disabled={rejoinAttempting}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {rejoinAttempting ? "입장 중…" : "다시 입장"}
                </button>
              )}
              <button
                onClick={() => navigate("/multiplayer")}
                className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function RoomSettingsForm({
  room,
  saving,
  onSave,
  onCancel,
}: {
  room: RoomDetail;
  saving: boolean;
  onSave: (
    name: string,
    game: GameId,
    maxPlayers: number,
    isPublic: boolean,
    pwAction: "keep" | "clear" | "set",
    pwValue: string,
    quizRounds: number,
    quizPack: number | null,
    dmRounds: number,
    dmPack: number | null,
    spectatorsCanChat: boolean,
    allowGuests: boolean,
    dmDrawSeconds: number,
    dmWordOptions: number,
    dmShowWordLength: boolean,
    dmShowHints: boolean,
    dmHideWinnerChat: boolean,
    dmFirstCorrectSpeedup: boolean,
    twRounds: number,
    twMode: "competitive" | "cooperative",
    twAttempts: number,
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [game, setGame] = useState<GameId>((room.current_game as GameId) || AVAILABLE_GAMES[0].id);
  const [maxPlayers, setMaxPlayers] = useState(room.max_players);
  const [pwMode, setPwMode] = useState<"keep" | "clear" | "set">("keep");
  const [pwValue, setPwValue] = useState("");
  const [quizRounds, setQuizRounds] = useState<number>(room.quiz_total_rounds || 5);
  const [quizPack, setQuizPack] = useState<number | null>(room.quiz_word_pack ?? null);
  const [dmRounds, setDmRounds] = useState<number>(room.duchmind_total_rounds || 5);
  const [dmPack, setDmPack] = useState<number | null>(room.duchmind_word_pack ?? null);
  const [dmDrawSeconds, setDmDrawSeconds] = useState<number>(room.duchmind_draw_seconds || 80);
  const [dmWordOptions, setDmWordOptions] = useState<number>(room.duchmind_word_options || 3);
  const [spectatorsCanChat, setSpectatorsCanChat] = useState<boolean>(room.spectators_can_chat ?? true);
  const [allowGuests, setAllowGuests] = useState<boolean>(room.allow_guests ?? false);
  const [dmShowWordLength, setDmShowWordLength] = useState<boolean>(room.duchmind_show_word_length ?? true);
  const [dmShowHints, setDmShowHints] = useState<boolean>(room.duchmind_show_hints ?? true);
  const [dmHideWinnerChat, setDmHideWinnerChat] = useState<boolean>(room.duchmind_hide_winner_chat ?? false);
  const [dmFirstCorrectSpeedup, setDmFirstCorrectSpeedup] = useState<boolean>(room.duchmind_first_correct_speedup ?? false);
  const [twRounds, setTwRounds] = useState<number>(room.twenty_total_rounds || 4);
  const [twMode, setTwMode] = useState<"competitive" | "cooperative">(room.twenty_mode || "competitive");
  const [twAttempts, setTwAttempts] = useState<number>(room.twenty_guess_attempts ?? 3);
  const [packs, setPacks] = useState<WordPackSummary[]>([]);

  useEffect(() => {
    listPacks({ forGame: true }).then((d) => setPacks(d.packs)).catch(() => {});
  }, []);

  const handleSubmit = () => {
    onSave(name, game, maxPlayers, true, pwMode, pwValue, quizRounds, quizPack, dmRounds, dmPack, spectatorsCanChat, allowGuests, dmDrawSeconds, dmWordOptions, dmShowWordLength, dmShowHints, dmHideWinnerChat, dmFirstCorrectSpeedup, twRounds, twMode, twAttempts);
  };

  return (
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mt-2 space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">방 이름</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">게임</label>
        <div className="grid grid-cols-2 gap-2">
          {AVAILABLE_GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={!g.available}
              onClick={() => setGame(g.id)}
              className={`p-2 rounded-lg border text-left text-sm ${
                game === g.id
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-300 dark:border-gray-600"
              } ${!g.available ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span>{g.icon} {g.label}</span>
              {!g.available && <span className="ml-1 text-[10px] text-gray-500">(준비중)</span>}
            </button>
          ))}
        </div>
      </div>

      {game === "quiz" && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">문제 수</label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuizRounds(n)}
                  className={`py-2 rounded-lg border text-sm font-semibold transition ${
                    quizRounds === n
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  {n}문제
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">단어장</label>
              <a
                href="/duchmind-wordpacks"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                관리하러 가기 ↗
              </a>
            </div>
            <select
              value={quizPack === null ? "" : String(quizPack)}
              onChange={(e) => setQuizPack(e.target.value === "" ? null : Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">기본 (전체 카드 풀)</option>
              {packs.filter((p) => !p.is_default && (p.series ?? "yugioh") === "yugioh").map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.entry_count}개){p.is_mine ? " · 내 것" : p.is_public ? " · 공개" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">화질구지는 유희왕 단어장만 사용합니다.</p>
          </div>
        </>
      )}

      {game === "duchmind" && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">라운드 수 (한 사람당 그릴 횟수)</label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 15, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDmRounds(n)}
                  className={`py-2 rounded-lg border text-sm font-semibold transition ${
                    dmRounds === n
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">그리는 시간 (초)</label>
            <div className="grid grid-cols-4 gap-2">
              {[60, 80, 100, 120].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDmDrawSeconds(n)}
                  className={`py-2 rounded-lg border text-sm font-semibold transition ${
                    dmDrawSeconds === n
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  {n}초
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">선택지 개수</label>
            <div className="grid grid-cols-3 gap-2">
              {[3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDmWordOptions(n)}
                  className={`py-2 rounded-lg border text-sm font-semibold transition ${
                    dmWordOptions === n
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  {n}개
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-sm font-medium">정답 글자수 노출 <span className="text-xs text-gray-500 ml-1">(밑줄·숫자)</span></span>
              <input
                type="checkbox"
                checked={dmShowWordLength}
                onChange={(e) => setDmShowWordLength(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-sm font-medium">시간 경과 힌트 <span className="text-xs text-gray-500 ml-1">(글자수 노출 시에만)</span></span>
              <input
                type="checkbox"
                checked={dmShowHints}
                onChange={(e) => setDmShowHints(e.target.checked)}
                disabled={!dmShowWordLength}
                className="w-5 h-5 accent-blue-600 disabled:opacity-40"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-sm font-medium">정답자 채팅 가림 <span className="text-xs text-gray-500 ml-1">(스포일러 방지)</span></span>
              <input
                type="checkbox"
                checked={dmHideWinnerChat}
                onChange={(e) => setDmHideWinnerChat(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-sm font-medium">첫 정답 시 시간 60% <span className="text-xs text-gray-500 ml-1">(긴장감 ↑)</span></span>
              <input
                type="checkbox"
                checked={dmFirstCorrectSpeedup}
                onChange={(e) => setDmFirstCorrectSpeedup(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">단어장</label>
              <a
                href="/duchmind-wordpacks"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                관리하러 가기 ↗
              </a>
            </div>
            <select
              value={dmPack === null ? "" : String(dmPack)}
              onChange={(e) => setDmPack(e.target.value === "" ? null : Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">기본 단어장</option>
              {packs.filter((p) => !p.is_default).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.entry_count}개){p.is_mine ? " · 내 것" : p.is_public ? " · 공개" : ""}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {game === "twenty" && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">라운드 수 (한 사람당 출제 횟수)</label>
            <div className="grid grid-cols-4 gap-2">
              {[3, 5, 7, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTwRounds(n)}
                  className={`py-2 rounded-lg border text-sm font-semibold transition ${
                    twRounds === n
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">모드</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTwMode("competitive")}
                className={`p-2 rounded-lg border text-left text-sm ${
                  twMode === "competitive"
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-600"
                }`}
              >
                <div className="font-semibold">⚔️ 경쟁</div>
                <div className="text-xs text-gray-500">맞힌 사람만 점수, 질문자에게 즉시 정답 시도 기회</div>
              </button>
              <button
                type="button"
                onClick={() => setTwMode("cooperative")}
                className={`p-2 rounded-lg border text-left text-sm ${
                  twMode === "cooperative"
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-600"
                }`}
              >
                <div className="font-semibold">🤝 협력</div>
                <div className="text-xs text-gray-500">누가 맞히든 추측자 모두 동일 점수</div>
              </button>
            </div>
          </div>

          {twMode === "competitive" && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">인당 정답 시도 횟수 (라운드별)</label>
              <select
                value={twAttempts}
                onChange={(e) => setTwAttempts(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              >
                <option value={2}>2번</option>
                <option value={3}>3번 (기본)</option>
                <option value={4}>4번</option>
                <option value={5}>5번</option>
                <option value={0}>무제한</option>
              </select>
            </div>
          )}
        </>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          최대 인원 ({room.players.length}명 이상)
        </label>
        <select
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        >
          {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
            <option key={n} value={n} disabled={n < room.players.length}>{n}명</option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-center justify-between cursor-pointer py-1">
          <span className="text-base font-medium">관전자 채팅 허용</span>
          <input
            type="checkbox"
            checked={spectatorsCanChat}
            onChange={(e) => setSpectatorsCanChat(e.target.checked)}
            className="w-5 h-5 accent-blue-600"
          />
        </label>
      </div>

      <div>
        <label className="flex items-center justify-between cursor-pointer py-1">
          <span className="text-base font-medium">게스트 입장 허용 <span className="text-xs text-gray-500 ml-1">(비로그인 사용자)</span></span>
          <input
            type="checkbox"
            checked={allowGuests}
            onChange={(e) => setAllowGuests(e.target.checked)}
            className="w-5 h-5 accent-blue-600"
          />
        </label>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          비밀번호 ({room.has_password ? "현재 설정됨" : "현재 없음"})
        </label>
        <select
          value={pwMode}
          onChange={(e) => setPwMode(e.target.value as any)}
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm mb-2"
        >
          <option value="keep">변경 안 함</option>
          <option value="set">새 비밀번호 설정</option>
          {room.has_password && <option value="clear">비밀번호 제거</option>}
        </select>
        {pwMode === "set" && (
          <input
            type="text"
            value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            placeholder="새 비밀번호"
            className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
          />
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg font-semibold text-sm"
        >
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
