import CoinBadge from "@/components/CoinBadge";

// Upcoming mark: a blue coin with "U" for decks announced in game but not released yet (특이점 2026-10-03).
export default function UpdateBadge({ className = "" }: { className?: string }) {
  return <CoinBadge letter="U" palette="blue" title="Update — 업데이트 예정 덱" label="Update" className={className} />;
}
