/** Frontend registry of available multiplayer games.
 *
 * The key matches Room.current_game on the backend. When the backend
 * `multiplayer/games/` package adds a new game, mirror it here.
 */
export type GameId = "quiz";

export interface GameInfo {
  id: GameId;
  label: string;
  icon: string;
  description: string;
  available: boolean;  // false → coming soon (not selectable)
}

export const AVAILABLE_GAMES: GameInfo[] = [
  {
    id: "quiz",
    label: "화질구지 퀴즈",
    icon: "🐤",
    description: "저화질 일러스트 맞추기",
    available: true,
  },
];

export function getGameInfo(id: string | null | undefined): GameInfo | null {
  if (!id) return null;
  return AVAILABLE_GAMES.find((g) => g.id === id) || null;
}
