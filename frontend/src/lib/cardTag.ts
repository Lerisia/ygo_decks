import type { CSSProperties } from "react";
import type { CardListItem } from "@/api/cardDexApi";
import { FRAME_COLORS } from "./cardFrames";

const EXTRA_KINDS = [["fusion", "융합"], ["synchro", "싱크로"], ["xyz", "엑시즈"], ["link", "링크"]] as const;

/** A card's tag in a list of suggestions (참혈 2026-10-14): 몬스터 / 마법 / 함정, an extra deck monster by its kind. */
export const cardTag = (c: Pick<CardListItem, "category" | "frame">) =>
  c.category === "spell" ? "마법" : c.category === "trap" ? "함정"
    : EXTRA_KINDS.find(([frame]) => c.frame.startsWith(frame))?.[1] ?? (c.frame === "token" ? "토큰" : "몬스터");

// a tag kept with a remembered search, without its card: a main deck monster there reads as effect
const TAG_FRAMES: Record<string, string> = {
  마법: "spell", 함정: "trap", 융합: "fusion", 싱크로: "synchro", 엑시즈: "xyz", 링크: "link", 토큰: "token", 몬스터: "effect",
};

/** A card tag in its card's Master Duel frame colour (참혈 2026-10-15); a pendulum's top in its own colour and bottom in
 *  spell green, as its frame is. Other tags (카드군, 서포트, 검색) get none. `dark`: a frame dark enough to need an
 *  outline on a dark screen (엑시즈). */
export function cardTagLook(tag: string, frame?: string): { style: CSSProperties; dark: boolean } | null {
  const own = frame?.replace(/_pendulum$/, "");
  const key = own && own in FRAME_COLORS ? own : TAG_FRAMES[tag];
  if (!key) return null;
  const color = FRAME_COLORS[key];
  const background = frame?.endsWith("_pendulum") ? `linear-gradient(${color} 55%, ${FRAME_COLORS.spell} 55%)` : color;
  return { style: { background, color: key === "synchro" ? "#1f2937" : "#ffffff" }, dark: key === "xyz" };
}
