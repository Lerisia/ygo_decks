import { useEffect, useRef, useState, useCallback } from "react";
import { getGuestTokenForRoom, type RoomDetail, type RoomPlayer } from "@/api/multiplayerApi";

type ServerMessage =
  | { type: "connected"; room: RoomDetail; your_player_id?: number; your_is_spectator?: boolean }
  | { type: "player_joined"; player: RoomPlayer }
  | { type: "player_left"; player_id: number }
  | { type: "player_kicked"; player_id: number }
  | { type: "player_updated"; player: RoomPlayer }
  | { type: "room_updated"; room: RoomDetail }
  | { type: string; [key: string]: unknown };

export type ConnectionStatus = "idle" | "connecting" | "connected" | "closed" | "error";

// Terminal close reasons surfaced by the server. When set, the hook stops
// auto-reconnecting and the parent should prompt the user for next steps.
//   removed   = WS code 4403, "not a member" (auto-leaved past grace, kicked)
//   not_found = WS code 4404, room no longer exists (closed/idle-cleaned)
//   auth      = WS code 4401, missing/invalid token
export type RoomCloseReason = "removed" | "not_found" | "auth" | null;

export interface UseRoomSocketOpts {
  roomId: number | null;
  onMessage?: (msg: ServerMessage) => void;
}

/**
 * Manages a WebSocket connection to /ws/multiplayer/rooms/<id>/
 * with JWT auth via ?token= query string.
 *
 * Tracks the latest room state from server-pushed events; consumers can also
 * provide onMessage for game-specific events.
 */
export function useRoomSocket({ roomId, onMessage }: UseRoomSocketOpts) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [closeReason, setCloseReason] = useState<RoomCloseReason>(null);
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<number | null>(null);
  // Server-supplied "is the calling client a spectator?". Needed because
  // stealth (운영진 유령입장) joins are excluded from the public players
  // list, so meInRoom?.is_spectator is undefined for them.
  const [myIsSpectator, setMyIsSpectator] = useState<boolean | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUserRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // Reconnect bookkeeping: backoff index + pending timer handle so we can
  // cancel a queued retry when a user-initiated foreground event triggers
  // an immediate reconnect (visibilitychange).
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of closeReason for use inside callbacks where reading state
  // directly would be a stale-closure trap (visibilitychange).
  const terminalRef = useRef(false);
  // Stored connect() so the manual reconnect API (called after a REST
  // re-join) can drive a fresh WS without re-running the whole effect.
  const connectRef = useRef<(() => void) | null>(null);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (roomId == null) return;

    const buildUrl = () => {
      const token = localStorage.getItem("access_token") || "";
      const guestToken = getGuestTokenForRoom(roomId);
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      if (guestToken) params.set("guest_token", guestToken);
      return `${proto}//${window.location.host}/ws/multiplayer/rooms/${roomId}/?${params.toString()}`;
    };

    const connect = () => {
      // Tear down any existing socket first — happens when reconnect fires
      // while a half-dead socket is still around (visibilitychange).
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setStatus("connecting");
      const ws = new WebSocket(buildUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        terminalRef.current = false;
        setCloseReason(null);
        setStatus("connected");
      };
      ws.onclose = (ev: CloseEvent) => {
        if (closedByUserRef.current) {
          setStatus("closed");
          return;
        }
        // Terminal codes from the server: stop reconnecting and surface
        // the reason so the parent can show a re-join / leave prompt.
        if (ev.code === 4403) {
          terminalRef.current = true;
          setCloseReason("removed");
          setStatus("closed");
          return;
        }
        if (ev.code === 4404) {
          terminalRef.current = true;
          setCloseReason("not_found");
          setStatus("closed");
          return;
        }
        if (ev.code === 4401) {
          terminalRef.current = true;
          setCloseReason("auth");
          setStatus("closed");
          return;
        }
        setStatus("error");
        // Exponential backoff capped at 10s. Reset on successful onopen.
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current = attempt + 1;
        const delay = Math.min(10000, 1000 * Math.pow(2, attempt));
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => setStatus("error");

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try { msg = JSON.parse(event.data); } catch { return; }

        // Update room state from server-pushed events
        if (msg.type === "connected" && "room" in msg && msg.room) {
          setRoom(msg.room as RoomDetail);
          const pid = (msg as any).your_player_id;
          if (typeof pid === "number") setMyPlayerId(pid);
          const spec = (msg as any).your_is_spectator;
          if (typeof spec === "boolean") setMyIsSpectator(spec);
        } else if (msg.type === "room_updated" && "room" in msg && msg.room) {
          setRoom(msg.room as RoomDetail);
        } else if (msg.type === "player_joined" && "player" in msg) {
          setRoom((r) => r ? { ...r, players: [...r.players, (msg as any).player] } : r);
        } else if (msg.type === "player_left" && "player_id" in msg) {
          const pid = (msg as any).player_id as number;
          setRoom((r) => r ? { ...r, players: r.players.filter(p => p.id !== pid) } : r);
        } else if (msg.type === "player_kicked" && "player_id" in msg) {
          const pid = (msg as any).player_id as number;
          setRoom((r) => r ? { ...r, players: r.players.filter(p => p.id !== pid) } : r);
        } else if (msg.type === "player_updated" && "player" in msg) {
          const p = (msg as any).player as RoomPlayer;
          setRoom((r) => r ? { ...r, players: r.players.map(x => x.id === p.id ? p : x) } : r);
        }

        onMessageRef.current?.(msg);
      };
    };

    closedByUserRef.current = false;
    reconnectAttemptRef.current = 0;
    terminalRef.current = false;
    setCloseReason(null);
    connectRef.current = connect;
    connect();

    // Mobile browsers freeze background tabs and silently drop the WS;
    // when the user returns, force an immediate reconnect rather than
    // waiting on the dead socket's onclose to fire (which can take 10+s).
    // Skip if the connection has already terminated for a known reason —
    // that case is owned by the parent's re-join prompt.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (terminalRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        reconnectAttemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      closedByUserRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [roomId]);

  // Expose a manual updater so callers can force a player merge after a
  // REST mutation (e.g. toggle-spectator) without waiting for the broadcast.
  const applyPlayerUpdate = useCallback((p: RoomPlayer) => {
    setRoom((r) => r ? { ...r, players: r.players.map(x => x.id === p.id ? p : x) } : r);
  }, []);

  // Force-reopen the WS — used after a REST re-join when grace expired.
  const reconnect = useCallback(() => {
    terminalRef.current = false;
    reconnectAttemptRef.current = 0;
    setCloseReason(null);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    connectRef.current?.();
  }, []);

  return { status, closeReason, room, send, applyPlayerUpdate, myPlayerId, myIsSpectator, reconnect };
}
