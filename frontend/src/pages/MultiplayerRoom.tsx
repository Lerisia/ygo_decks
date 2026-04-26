import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRoomSocket } from "@/hooks/useRoomSocket";
import { getRoom, leaveRoom, kickPlayer, updateRoom, type RoomDetail } from "@/api/multiplayerApi";
import { getGameInfo, AVAILABLE_GAMES, type GameId } from "@/lib/multiplayerGames";

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
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

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

  const handleSaveSettings = async (
    formName: string,
    formGame: GameId,
    formMaxPlayers: number,
    formIsPublic: boolean,
    pwAction: "keep" | "clear" | "set",
    pwValue: string,
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
      };
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
      <button
        onClick={() => navigate("/multiplayer")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        ← 방 목록
      </button>
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
        방 나가기
      </button>
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
  ) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [game, setGame] = useState<GameId>((room.current_game as GameId) || AVAILABLE_GAMES[0].id);
  const [maxPlayers, setMaxPlayers] = useState(room.max_players);
  const [pwMode, setPwMode] = useState<"keep" | "clear" | "set">("keep");
  const [pwValue, setPwValue] = useState("");

  const handleSubmit = () => {
    onSave(name, game, maxPlayers, true, pwMode, pwValue);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mt-2 space-y-3">
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

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          최대 인원 ({room.players.length}명 이상)
        </label>
        <select
          value={maxPlayers}
          onChange={(e) => setMaxPlayers(Number(e.target.value))}
          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n} disabled={n < room.players.length}>{n}명</option>
          ))}
        </select>
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
