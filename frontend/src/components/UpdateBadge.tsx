import CoinBadge from "@/components/CoinBadge";

// New-update mark for decks from the latest game update (특이점 2026-10-03): a red coin with "N" for new (2026-10-13;
// it was a blue U).
export default function UpdateBadge({ className = "" }: { className?: string }) {
  return <CoinBadge letter="N" palette="red" title="New — 신규 업데이트 덱" label="New" className={className} />;
}
