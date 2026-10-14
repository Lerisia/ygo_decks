import type { CardListItem } from "@/api/cardDexApi";

const EXTRA_KINDS = [["fusion", "융합"], ["synchro", "싱크로"], ["xyz", "엑시즈"], ["link", "링크"]] as const;

/** A card's tag in a list of suggestions (참혈 2026-10-14): 몬스터 / 마법 / 함정, an extra deck monster by its kind. */
export const cardTag = (c: Pick<CardListItem, "category" | "frame">) =>
  c.category === "spell" ? "마법" : c.category === "trap" ? "함정"
    : EXTRA_KINDS.find(([frame]) => c.frame.startsWith(frame))?.[1] ?? (c.frame === "token" ? "토큰" : "몬스터");
