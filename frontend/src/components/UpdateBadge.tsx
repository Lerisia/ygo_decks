import CoinBadge from "@/components/CoinBadge";

// New-update mark: a blue coin with "U" for decks from the latest game update (특이점 2026-10-03).
export default function UpdateBadge({ className = "" }: { className?: string }) {
  return <CoinBadge letter="U" palette="blue" title="Update — 신규 업데이트 덱" label="Update" className={className} />;
}
