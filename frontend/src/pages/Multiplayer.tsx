import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listRooms, createRoom, joinRoom, myRoom, getRoomByCode, setGuestSession, type RoomListItem, type RoomDetail } from "@/api/multiplayerApi";
import { isAuthenticated, getUserInfo } from "@/api/accountApi";
import { AVAILABLE_GAMES, getGameInfo, type GameId } from "@/lib/multiplayerGames";
import RoomRulesPanel from "@/components/multiplayer/RoomRulesPanel";
import { listPacks, type WordPackSummary } from "@/api/duchmindPackApi";

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
  const [isStaff, setIsStaff] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);

  // create form state
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newMaxPlayers, setNewMaxPlayers] = useState(6);
  const [newGame, setNewGame] = useState<GameId>(AVAILABLE_GAMES[0].id);
  const [newSpectatorsCanChat, setNewSpectatorsCanChat] = useState(true);
  const [newAllowGuests, setNewAllowGuests] = useState(true);
  const [newIsAnonymous, setNewIsAnonymous] = useState(false);
  const [newDmShowWordLength, setNewDmShowWordLength] = useState(true);
  const [newDmShowHints, setNewDmShowHints] = useState(true);
  const [newDmHideWinnerChat, setNewDmHideWinnerChat] = useState(false);
  const [newDmFirstCorrectSpeedup, setNewDmFirstCorrectSpeedup] = useState(false);
  const [newTwMode, setNewTwMode] = useState<"competitive" | "cooperative">("competitive");
  const [newTwAttempts, setNewTwAttempts] = useState<number>(3);
  // Advanced (game-specific numeric) settings — exposed via an expander to
  // keep the create form scannable for first-timers while still letting
  // tweakers configure rounds / pack / timings up front.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newQuizRounds, setNewQuizRounds] = useState<number>(5);
  const [newDmRounds, setNewDmRounds] = useState<number>(5);
  const [newDmDrawSeconds, setNewDmDrawSeconds] = useState<number>(80);
  const [newDmWordOptions, setNewDmWordOptions] = useState<number>(3);
  const [newDmPack, setNewDmPack] = useState<number | null>(null);
  const [newTwRounds, setNewTwRounds] = useState<number>(5);
  const [packs, setPacks] = useState<WordPackSummary[]>([]);
  useEffect(() => {
    listPacks({ forGame: true }).then((d) => setPacks(d.packs)).catch(() => {});
  }, []);
  const [creating, setCreating] = useState(false);

  // join modal state
  const [pwRoom, setPwRoom] = useState<RoomListItem | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");
  const [resolvingCode, setResolvingCode] = useState(false);

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
      getUserInfo().then((d) => { if (d?.is_staff) setIsStaff(true); }).catch(() => {});
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
        spectators_can_chat: newSpectatorsCanChat,
        allow_guests: newAllowGuests,
        is_anonymous: newIsAnonymous,
        duchmind_show_word_length: newDmShowWordLength,
        duchmind_show_hints: newDmShowHints,
        duchmind_hide_winner_chat: newDmHideWinnerChat,
        duchmind_first_correct_speedup: newDmFirstCorrectSpeedup,
        twenty_mode: newTwMode,
        twenty_guess_attempts: newTwAttempts,
        quiz_total_rounds: newQuizRounds,
        duchmind_total_rounds: newDmRounds,
        duchmind_draw_seconds: newDmDrawSeconds,
        duchmind_word_options: newDmWordOptions,
        duchmind_word_pack: newDmPack,
        twenty_total_rounds: newTwRounds,
      });
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      setError(e.message || "방 생성 실패");
    } finally {
      setCreating(false);
    }
  };

  const [pwAsSpectator, setPwAsSpectator] = useState(false);

  const handleJoinClick = async (room: RoomListItem, asSpectator = false) => {
    // Re-entering my own room: skip all join prompts (guest warning,
    // spectator-only warning, password prompt). The room page already knows
    // me — we just navigate.
    if (currentRoom && currentRoom.id === room.id) {
      navigate(`/multiplayer/rooms/${room.id}`);
      return;
    }
    const mustSpectate = room.player_count >= room.max_players || room.status !== "waiting";
    const spectate = asSpectator || mustSpectate;
    if (!loggedIn) {
      if (!room.allow_guests) {
        setError("이 방은 게스트 입장을 허용하지 않습니다.");
        return;
      }
      const guestOk = confirm("게스트로 입장 시 포인트가 지급되지 않습니다. 계속하시겠습니까?");
      if (!guestOk) return;
    }
    if (mustSpectate && !asSpectator) {
      const ok = confirm(
        room.status !== "waiting"
          ? "게임이 진행 중인 방입니다. 관전자로 입장하시겠습니까?"
          : "방이 가득 찼습니다. 관전자로 입장하시겠습니까?"
      );
      if (!ok) return;
    }
    try {
      const result = await joinRoom(room.id, "", "", spectate);
      if (result._guest) {
        setGuestSession({ ...result._guest, room_id: room.id });
      }
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      const msg = e.message || "";
      if (room.has_password && msg.includes("비밀번호")) {
        setPwRoom(room);
        setPwInput("");
        setPwAsSpectator(spectate);
      } else {
        setError(msg || "입장 실패");
      }
    }
  };

  const doJoin = async (room: RoomListItem, password: string) => {
    const mustSpectate = room.player_count >= room.max_players || room.status !== "waiting";
    const spectate = pwAsSpectator || mustSpectate;
    setJoining(true);
    try {
      const result = await joinRoom(room.id, password, "", spectate);
      if (result._guest) {
        setGuestSession({ ...result._guest, room_id: room.id });
      }
      navigate(`/multiplayer/rooms/${room.id}`);
    } catch (e: any) {
      setError(e.message || "입장 실패");
    } finally {
      setJoining(false);
      setPwRoom(null);
      setPwAsSpectator(false);
    }
  };

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/playground")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 px-2 sm:px-0"
      >
        ← 놀이터
      </button>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">멀티플레이</h1>
        {loggedIn && (
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 text-sm"
        >
          {showCreate ? "닫기" : "+ 방 만들기"}
        </button>
        )}
      </div>

      {!loggedIn && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4 text-sm text-yellow-700 dark:text-yellow-300 text-center">
          비로그인 상태입니다 — 게스트 입장이 허용된 방에만 참가할 수 있고 포인트는 지급되지 않습니다.
        </div>
      )}

      {showCreate && (
        <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 mb-4 space-y-3">
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
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>{n}명</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-base font-medium">관전자 채팅 허용</span>
              <input
                type="checkbox"
                checked={newSpectatorsCanChat}
                onChange={(e) => setNewSpectatorsCanChat(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-base font-medium">게스트 입장 허용 <span className="text-xs text-gray-500 ml-1">(비로그인 사용자)</span></span>
              <input
                type="checkbox"
                checked={newAllowGuests}
                onChange={(e) => setNewAllowGuests(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer py-1">
              <span className="text-base font-medium">익명 방 <span className="text-xs text-gray-500 ml-1">(닉네임 → 플레이어1·2·3… / 한 번 정하면 변경 불가)</span></span>
              <input
                type="checkbox"
                checked={newIsAnonymous}
                onChange={(e) => setNewIsAnonymous(e.target.checked)}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
            {newGame === "quiz" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">문제 수</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewQuizRounds(n)}
                      className={`py-2 rounded-lg border text-sm font-semibold ${
                        newQuizRounds === n
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                      }`}
                    >{n}문제</button>
                  ))}
                </div>
              </div>
            )}
            {newGame === "duchmind" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">라운드 수 (한 사람당 그릴 횟수)</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewDmRounds(n)}
                      className={`py-2 rounded-lg border text-sm font-semibold ${
                        newDmRounds === n
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                      }`}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}
            {newGame === "twenty" && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">라운드 수 (한 사람당 출제 횟수)</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[3, 5, 7, 10].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNewTwRounds(n)}
                        className={`py-2 rounded-lg border text-sm font-semibold ${
                          newTwRounds === n
                            ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                        }`}
                      >{n}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">모드</label>
                  <select
                    value={newTwMode}
                    onChange={(e) => setNewTwMode(e.target.value as "competitive" | "cooperative")}
                    className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
                  >
                    <option value="competitive">⚔️ 경쟁 — 맞힌 사람만 점수, 질문자에게 즉시 정답 시도 기회</option>
                    <option value="cooperative">🤝 협력 — 누가 맞히든 추측자 모두 동일 점수</option>
                  </select>
                </div>
                {newTwMode === "competitive" && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">인당 정답 시도 횟수 (라운드별)</label>
                    <select
                      value={newTwAttempts}
                      onChange={(e) => setNewTwAttempts(Number(e.target.value))}
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
          </div>

          {/* Advanced (game-specific timing / hint flags) — DuchMind only.
              Quiz / Twenty have no extra knobs beyond what's already shown
              above, so the expander is hidden for those games entirely. */}
          {newGame === "duchmind" && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full flex items-center justify-between text-sm font-semibold py-1.5 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <span>⚙ 상세 설정</span>
                <span className="text-gray-400 text-xs">{showAdvanced ? "▲" : "▼"}</span>
              </button>
              {showAdvanced && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">그리는 시간</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[60, 80, 100, 120].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setNewDmDrawSeconds(n)}
                          className={`py-2 rounded-lg border text-sm font-semibold ${
                            newDmDrawSeconds === n
                              ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                          }`}
                        >{n}초</button>
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
                          onClick={() => setNewDmWordOptions(n)}
                          className={`py-2 rounded-lg border text-sm font-semibold ${
                            newDmWordOptions === n
                              ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                          }`}
                        >{n}개</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">단어장</label>
                    <select
                      value={newDmPack === null ? "" : String(newDmPack)}
                      onChange={(e) => setNewDmPack(e.target.value === "" ? null : Number(e.target.value))}
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
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-base font-medium">정답 글자수 노출 <span className="text-xs text-gray-500 ml-1">(밑줄·숫자)</span></span>
                    <input
                      type="checkbox"
                      checked={newDmShowWordLength}
                      onChange={(e) => setNewDmShowWordLength(e.target.checked)}
                      className="w-5 h-5 accent-blue-600"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-base font-medium">시간 경과 힌트 <span className="text-xs text-gray-500 ml-1">(글자수 노출 시에만 의미 있음)</span></span>
                    <input
                      type="checkbox"
                      checked={newDmShowHints}
                      onChange={(e) => setNewDmShowHints(e.target.checked)}
                      disabled={!newDmShowWordLength}
                      className="w-5 h-5 accent-blue-600 disabled:opacity-40"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-base font-medium">정답자 채팅 가림 <span className="text-xs text-gray-500 ml-1">(스포일러 방지)</span></span>
                    <input
                      type="checkbox"
                      checked={newDmHideWinnerChat}
                      onChange={(e) => setNewDmHideWinnerChat(e.target.checked)}
                      className="w-5 h-5 accent-blue-600"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer py-1">
                    <span className="text-base font-medium">첫 정답 시 시간 60% <span className="text-xs text-gray-500 ml-1">(긴장감 ↑)</span></span>
                    <input
                      type="checkbox"
                      checked={newDmFirstCorrectSpeedup}
                      onChange={(e) => setNewDmFirstCorrectSpeedup(e.target.checked)}
                      className="w-5 h-5 accent-blue-600"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

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

      {/* Join by invite link or code */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const raw = codeInput.trim();
          if (!raw) return;
          setResolvingCode(true);
          setCodeError("");
          // If it looks like a full invite URL, extract roomId + code and
          // navigate directly with ?invite=<code> so the auto-join kicks in.
          const linkMatch = raw.match(/\/multiplayer\/rooms\/(\d+)(?:\?.*?invite=([^&]+))?/);
          if (linkMatch) {
            const rid = linkMatch[1];
            const inv = linkMatch[2] ? decodeURIComponent(linkMatch[2]) : "";
            navigate(inv
              ? `/multiplayer/rooms/${rid}?invite=${encodeURIComponent(inv)}`
              : `/multiplayer/rooms/${rid}`);
            setResolvingCode(false);
            return;
          }
          // Otherwise treat as a bare invite code (legacy 6~8자 영숫자).
          const code = raw.toUpperCase();
          try {
            const room = await getRoomByCode(code);
            navigate(`/multiplayer/rooms/${room.id}?invite=${encodeURIComponent(code)}`);
          } catch (err: any) {
            setCodeError(err.message || "방을 찾을 수 없습니다.");
          } finally {
            setResolvingCode(false);
          }
        }}
        className="flex gap-2 mb-4 px-2 sm:px-0"
      >
        <input
          type="text"
          value={codeInput}
          onChange={(e) => { setCodeInput(e.target.value); setCodeError(""); }}
          placeholder="초대 링크 붙여넣기"
          className="flex-1 px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
        <button
          type="submit"
          disabled={!codeInput.trim() || resolvingCode}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 shrink-0"
        >
          {resolvingCode ? "확인 중..." : "입장"}
        </button>
      </form>
      {codeError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2 mb-4 text-xs text-red-700 dark:text-red-300 mx-2 sm:mx-0">
          {codeError}
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
            const mustSpectate = r.player_count >= r.max_players || r.status !== "waiting";
            return (
            <div
              key={r.id}
              className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-2 py-2 sm:p-4 hover:shadow-md transition"
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleJoinClick(r, false)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold truncate">{r.name}</span>
                    {r.has_password && <span title="비밀번호 있음">🔒</span>}
                    {r.is_anonymous && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-bold shrink-0" title="익명 방">🎭 익명</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    {game && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                      <span>{game.icon}</span>
                      <span>{game.label}</span>
                    </span>}
                    <span>방장: {r.host_name}</span>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      {r.player_count}/{r.max_players}
                    </div>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded ${
                      mustSpectate
                        ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        : STATUS_BADGE[r.status]
                    }`}>
                      {mustSpectate ? "관전만 가능" : STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  {!mustSpectate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleJoinClick(r, true); }}
                      title="관전으로 입장"
                      className="px-2 py-1.5 text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50"
                    >
                      관전
                    </button>
                  )}
                  {isStaff && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/multiplayer/rooms/${r.id}?stealth=1`); }}
                      title="몰래 입장 (운영진 전용)"
                      className="px-2 py-1.5 text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                    >
                      👻
                    </button>
                  )}
                </div>
              </div>
              <RoomRulesPanel room={r} showAnonymousBadge={false} />
            </div>
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
              type="text"
              name="room-passcode"
              autoFocus
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doJoin(pwRoom, pwInput); }}
              style={{ WebkitTextSecurity: "disc" } as any}
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
