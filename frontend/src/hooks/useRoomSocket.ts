import { useEffect, useRef, useState, useCallback } from "react";
import type { RoomDetail, RoomPlayer } from "@/api/multiplayerApi";

type ServerMessage =
  | { type: "connected"; room: RoomDetail }
  | { type: "player_joined"; player: RoomPlayer }
  | { type: "player_left"; player_id: number }
  | { type: "player_kicked"; player_id: number }
  | { type: "room_updated"; room: RoomDetail }
  | { type: string; [key: string]: unknown };

export type ConnectionStatus = "idle" | "connecting" | "connected" | "closed" | "error";

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
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUserRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (roomId == null) return;

    const token = localStorage.getItem("access_token") || "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/multiplayer/rooms/${roomId}/?token=${encodeURIComponent(token)}`;

    closedByUserRef.current = false;
    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => {
      setStatus(closedByUserRef.current ? "closed" : "error");
    };
    ws.onerror = () => setStatus("error");

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Update room state from server-pushed events
      if (msg.type === "connected" && "room" in msg && msg.room) {
        setRoom(msg.room as RoomDetail);
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
      }

      onMessageRef.current?.(msg);
    };

    return () => {
      closedByUserRef.current = true;
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
  }, [roomId]);

  return { status, room, send };
}
