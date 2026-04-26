import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { getRoom, leaveRoom, kickPlayer, type RoomDetail } from "@/api/multiplayerApi";
import { getGameInfo } from "@/lib/multiplayerGames";

const STATUS_LABEL: Record<string, string> = {
  waiting: "대기 중",
  in_game: "게임 중",
  closed: "종료됨",
};

export default function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const id = roomId ? Number(roomId) : null;

  const [initialRoom, setInitialRoom] = useState<RoomDetail | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const { status, room: liveRoom } = useRoomSocket({ roomId: id });
  const room = liveRoom || initialRoom;

  // Initial REST fetch (so we have something even before WS connects)
  useEffect(() => {
    if (!id) return;
    getRoom(id).then(setInitialRoom).catch((e) => setError(e.message));
  }, [id]);

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

  const handleKick = async (playerId: number) => {
    if (!id) return;
    if (!confirm("이 플레이어를 강퇴하시겠습니까?")) return;
    try { await kickPlayer(id, playerId); } catch (e: any) { setError(e.message); }
  };

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error && !room) {
    return (
      <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
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
      <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
        <p className="text-center text-gray-500">로딩 중...</p>
      </div>
    );
  }

  const isHost = myUserId !== undefined && room.host === myUserId;
  const game = getGameInfo(room.current_game);

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
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
          <span className="text-gray-500">초대 코드:</span>
          <code className="px-2 py-1 bg-gray-100 dark:bg-gray-900 rounded font-mono font-bold">{room.code}</code>
          <button
            onClick={handleCopyCode}
            className="text-blue-600 dark:text-blue-400 text-xs hover:underline"
          >
            {copied ? "복사됨!" : "복사"}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">플레이어 ({room.players.length}/{room.max_players})</h2>
          <span className="text-xs text-gray-500">{STATUS_LABEL[room.status]}</span>
        </div>

        <div className="space-y-2">
          {room.players.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg">{p.is_host ? "👑" : "👤"}</span>
                <span className="font-medium truncate">{p.display_name}</span>
                {p.is_guest && <span className="text-xs text-gray-500">(게스트)</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm text-gray-600 dark:text-gray-400">{p.score}점</span>
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

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4 text-center text-sm text-gray-500">
        게임 시작 기능은 곧 추가됩니다.
      </div>

      <button
        onClick={handleLeave}
        className="w-full py-3 bg-gray-200 dark:bg-gray-700 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-gray-600"
      >
        {isHost ? "방 닫고 나가기" : "방 나가기"}
      </button>
    </div>
  );
}
