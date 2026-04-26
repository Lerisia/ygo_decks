import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRooms, createRoom, joinRoom, myRoom, type RoomListItem, type RoomDetail } from "@/api/multiplayerApi";
import { isAuthenticated } from "@/api/accountApi";
import { AVAILABLE_GAMES, getGameInfo, type GameId } from "@/lib/multiplayerGames";

const STATUS_LABEL: Record<string, string> = {
  waiting: "대기 중",
  in_game: "게임 중",
  closed: "종료됨",
};

const STATUS_BADGE: Record<string, string> = {
  waiting: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  in_game: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
  closed: "bg-gray-100 dark:bg-gray-800 text-gray-500",
};

export default function Multiplayer() {
  const navigate = useNavigate();
  const loggedIn = isAuthenticated();

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);

  // create form state
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newMaxPlayers, setNewMaxPlayers] = useState(4);
  const [newGame, setNewGame] = useState<GameId>(AVAILABLE_GAMES[0].id);
  const [creating, setCreating] = useState(false);

  // join modal state
  const [pwRoom, setPwRoom] = useState<RoomListItem | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [joining, setJoining] = useState(false);

  const loadRooms = async () => {
    try {
      setError("");
      const data = await listRooms();
      setRooms(data.rooms);
    } catch (e: any) {
      setError(e.message || "방 목록을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
    if (loggedIn) {
      myRoom().then((d) => setCurrentRoom(d.room)).catch(() => {});
    }
    const interval = setInterval(loadRooms, 5000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setError("방 이름을 입력하세요.");
      return;
    }
    setCreating(true);
    try {
      const room = await createRoom({
        name: newName.trim(),
        password: newPassword || undefined,
        max_players: newMaxPlayers,
        current_game: newGame,
      });
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      setError(e.message || "방 생성 실패");
    } finally {
      setCreating(false);
    }
  };

  const handleJoinClick = async (room: RoomListItem) => {
    // Try without password first — backend allows existing members in regardless.
    try {
      await joinRoom(room.id, "");
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      const msg = e.message || "";
      if (room.has_password && msg.includes("비밀번호")) {
        setPwRoom(room);
        setPwInput("");
      } else {
        setError(msg || "입장 실패");
      }
    }
  };

  const doJoin = async (room: RoomListItem, password: string) => {
    setJoining(true);
    try {
      await joinRoom(room.id, password);
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      setError(e.message || "입장 실패");
    } finally {
      setJoining(false);
      setPwRoom(null);
    }
  };

  if (!loggedIn) {
    return (
      <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-center mb-4">멀티플레이</h1>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-center">
          <p className="text-yellow-700 dark:text-yellow-300 text-sm">로그인 후 사용할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">멀티플레이</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 text-sm"
        >
          {showCreate ? "닫기" : "+ 방 만들기"}
        </button>
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">방 이름</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={50}
              placeholder="예: 화질구지 같이 풀자"
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
                  onClick={() => setNewGame(g.id)}
                  className={`p-3 rounded-lg border text-left transition ${
                    newGame === g.id
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  } ${!g.available ? "opacity-50 cursor-not-allowed" : "hover:border-blue-400"}`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span>{g.icon}</span>
                    <span className="font-semibold text-sm">{g.label}</span>
                    {!g.available && <span className="ml-auto text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">준비중</span>}
                  </div>
                  <div className="text-xs text-gray-500">{g.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">비밀번호 (선택)</label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="없으면 비워두세요"
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">최대 인원</label>
              <select
                value={newMaxPlayers}
                onChange={(e) => setNewMaxPlayers(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}명</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {creating ? "생성 중..." : "방 만들기"}
          </button>
        </div>
      )}

      {currentRoom && (
        <button
          onClick={() => navigate(`/multiplayer/rooms/${currentRoom.id}`)}
          className="w-full mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300 text-left hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
        >
          현재 입장한 방: <span className="font-semibold">{currentRoom.name}</span> · 돌아가기 →
        </button>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-500">로딩 중...</p>
      ) : rooms.length === 0 ? (
        <p className="text-center text-gray-500 py-8">현재 열린 방이 없습니다. 첫 번째 방을 만들어보세요!</p>
      ) : (
        <div className="space-y-2">
          {rooms.map((r) => {
            const game = getGameInfo(r.current_game);
            return (
            <button
              key={r.id}
              onClick={() => handleJoinClick(r)}
              disabled={r.player_count >= r.max_players || r.status !== "waiting"}
              className="w-full text-left bg-white dark:bg-gray-800 rounded-xl shadow p-4 flex items-center justify-between hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold truncate">{r.name}</span>
                  {r.has_password && <span title="비밀번호 있음">🔒</span>}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  {game && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                    <span>{game.icon}</span>
                    <span>{game.label}</span>
                  </span>}
                  <span>방장: {r.host_name}</span>
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="text-sm font-semibold">
                  {r.player_count}/{r.max_players}
                </div>
                <span className={`inline-block text-xs px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            </button>
            );
          })}
        </div>
      )}

      {pwRoom && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 max-w-sm w-full">
            <h2 className="text-lg font-bold mb-1">비밀번호 입력</h2>
            <p className="text-sm text-gray-500 mb-3">'{pwRoom.name}'</p>
            <input
              type="password"
              autoFocus
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doJoin(pwRoom, pwInput); }}
              className="w-full px-3 py-2 border rounded-lg mb-3 bg-white dark:bg-gray-800"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPwRoom(null)}
                className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg font-semibold"
              >
                취소
              </button>
              <button
                onClick={() => doJoin(pwRoom, pwInput)}
                disabled={joining}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {joining ? "입장 중..." : "입장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
