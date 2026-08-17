/** Frontend registry of available multiplayer games.
 *
 * The key matches Room.current_game on the backend. When the backend
 * `multiplayer/games/` package adds a new game, mirror it here.
 */
export type GameId = "quiz" | "duchmind" | "twenty";

export interface GameInfo {
  id: GameId;
  label: string;
  icon: string;
  description: string;
  available: boolean;  // false → coming soon (not selectable)
  maxPlayers: number;  // hard cap for this game (room cannot exceed)
  rules: string[];
  // Optional per-mode overrides for games whose rules / display name shift
  // by mode (e.g. Twenty's competitive vs cooperative). Falls back to
  // `rules` / `label` when the active mode isn't in the map.
  rulesByMode?: Record<string, string[]>;
  labelByMode?: Record<string, string>;
}

export const AVAILABLE_GAMES: GameInfo[] = [
  {
    id: "duchmind",
    label: "듀치마인드",
    icon: "🎨",
    description: "그림 그리고 카드 이름 맞히기",
    available: true,
    maxPlayers: 8,
    rules: [
      "한 명이 카드 이름을 보고 그림을 그리면 나머지가 채팅으로 맞히는 게임입니다.",
      "출제자는 무작위로 제시된 3장의 카드 중 하나를 15초 내에 선택합니다 (시간 초과 시 자동 선택).",
      "그림을 그리는 시간은 80초이며, 시간 경과에 따라 일부 글자가 힌트로 공개됩니다.",
      "정답을 빨리 맞힐수록 더 많은 점수를 얻습니다 (50 ~ 200점).",
      "출제자도 정답자가 나올 때마다 보너스 점수를 받습니다.",
      "한 사람당 방장이 설정한 라운드 수만큼 그리며, 게임 종료 시 누적 점수 40점당 1포인트가 지급됩니다.",
    ],
  },
  {
    id: "quiz",
    label: "화질구지 퀴즈",
    icon: "🐤",
    description: "저화질 일러스트 맞히기",
    available: true,
    maxPlayers: 12,
    rules: [
      "저화질의 카드 일러스트를 보고 정답을 맞히는 게임입니다.",
      "시간이 지날수록 화질이 점점 좋아지며, 빨리 (낮은 화질에서) 맞힐수록 점수가 높습니다 (4점 → 3점 → 2점 → 1점).",
      "각 문제당 한 번만 선택할 수 있으며 — 정답이든 오답이든 — 한 번 고르면 그 라운드 동안 잠깁니다. 신중하게 고르세요.",
      "오답을 고르면 화질과 무관하게 2점이 차감됩니다.",
      "모두가 답을 제출하거나 제한 시간이 끝나면 라운드가 종료되고 정답이 공개됩니다. 정답자들은 각자 맞힌 시점의 점수를 받습니다.",
      "방장이 설정한 라운드 수만큼 진행 후 누적 점수가 가장 높은 사람이 승리합니다.",
      "게임 종료 시 누적 점수 3점당 1포인트가 지급됩니다.",
    ],
  },
  {
    id: "twenty",
    label: "딱무고개",
    icon: "❓",
    description: "예/아니오 질문으로 카드 맞히기",
    available: false,
    maxPlayers: 6,
    rules: [
      "한 명이 카드 검색으로 카드를 정하면 나머지가 돌아가며 자유 질문으로 맞히는 게임입니다.",
      "출제자는 예 / 아니오 / 모르겠거나 애매함 3가지 버튼으로만 답변합니다.",
      "추측자는 자기 차례에 자유 질문하거나 카드 지정 정답 시도가 가능합니다 (둘 다 1질문 소비).",
      "정답 시도는 자기 차례 외에도 누구나 언제든 가능. 단 1번에 1질문 소비.",
      "한 라운드의 질문 한도는 20개. 다 쓸 때까지 못 맞히면 출제자 승.",
      "추측자 점수 (인당): (20 − 사용질문수) × 30 ÷ 추측자 수 — 빠를수록 인당 ↑",
      "출제자 점수: 사용질문수 × 15 — 시간 끌수록 ↑. 못 맞힐 시 300점.",
      "한 사람당 방장이 설정한 라운드 수만큼 출제하며, 종료 시 누적 점수 100점당 1포인트가 지급됩니다.",
    ],
  },
];

export function getGameInfo(id: string | null | undefined): GameInfo | null {
  if (!id) return null;
  return AVAILABLE_GAMES.find((g) => g.id === id) || null;
}
