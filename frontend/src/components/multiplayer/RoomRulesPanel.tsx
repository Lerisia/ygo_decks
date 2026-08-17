import { useState } from "react";

type RoomRules = {
  current_game: string;
  max_players: number;
  is_anonymous: boolean;
  allow_guests: boolean;
  spectators_can_chat: boolean;
  quiz_total_rounds: number;
  duchmind_total_rounds: number;
  duchmind_word_pack_name: string | null;
  duchmind_draw_seconds: number;
  duchmind_word_options: number;
  duchmind_show_word_length: boolean;
  duchmind_show_hints: boolean;
  duchmind_hide_winner_chat: boolean;
  duchmind_first_correct_speedup: boolean;
  twenty_total_rounds: number;
  twenty_mode: "competitive" | "cooperative";
  twenty_guess_attempts: number;
};

interface Props {
  room: RoomRules;
  defaultOpen?: boolean;
  // Hide the inline 🎭 익명 badge next to "방 규칙" — useful when the parent
  // (e.g. the lobby room card) already renders the badge in its header.
  showAnonymousBadge?: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-sm">
      <span className="text-gray-500 dark:text-gray-400 shrink-0 min-w-[5.5rem]">{label}</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  );
}

function YesNo({ on }: { on: boolean }) {
  return (
    <span className={on ? "text-green-600 dark:text-green-400" : "text-gray-400"}>
      {on ? "✅ 예" : "❌ 아니오"}
    </span>
  );
}

/** Read-only collapsible '방 규칙' panel — used in both the lobby room list
 * and the room detail page (for non-hosts). Caller provides the surrounding
 * card chrome so the panel blends in either context. */
export default function RoomRulesPanel({ room, defaultOpen = false, showAnonymousBadge = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center justify-between text-sm font-semibold py-1.5 hover:text-blue-600 dark:hover:text-blue-400"
      >
        <span className="flex items-center gap-2">
          📋 방 규칙
          {showAnonymousBadge && room.is_anonymous && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-bold">
              🎭 익명
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="pt-1 pb-1 border-t border-gray-200 dark:border-gray-700">
          <Row label="익명 방" value={<YesNo on={room.is_anonymous} />} />
          <Row label="최대 인원" value={`${room.max_players}명`} />
          <Row label="게스트 입장" value={<YesNo on={room.allow_guests} />} />
          <Row label="관전자 채팅" value={<YesNo on={room.spectators_can_chat} />} />
          {room.current_game === "duchmind" && (
            <>
              <Row label="라운드 수" value={`${room.duchmind_total_rounds}`} />
              <Row label="단어팩" value={room.duchmind_word_pack_name || "기본"} />
              <Row label="그리는 시간" value={`${room.duchmind_draw_seconds}초`} />
              <Row label="선택지" value={`${room.duchmind_word_options}개`} />
              <Row label="글자수 표시" value={<YesNo on={room.duchmind_show_word_length} />} />
              <Row
                label="힌트 표시"
                value={
                  room.duchmind_show_word_length ? (
                    <YesNo on={room.duchmind_show_hints} />
                  ) : (
                    <span className="text-gray-400">— (글자수 미표시)</span>
                  )
                }
              />
              <Row label="정답자 채팅 가림" value={<YesNo on={room.duchmind_hide_winner_chat} />} />
              <Row label="첫 정답 시 시간 단축" value={<YesNo on={room.duchmind_first_correct_speedup} />} />
            </>
          )}
          {room.current_game === "quiz" && (
            <Row label="라운드 수" value={`${room.quiz_total_rounds}`} />
          )}
          {room.current_game === "twenty" && (
            <>
              <Row label="라운드 수" value={`${room.twenty_total_rounds}`} />
              <Row
                label="모드"
                value={room.twenty_mode === "cooperative" ? "🤝 협력" : "⚔️ 경쟁"}
              />
              {room.twenty_mode === "competitive" && (
                <Row
                  label="시도 횟수"
                  value={room.twenty_guess_attempts === 0 ? "무제한" : `인당 ${room.twenty_guess_attempts}번/라운드`}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
