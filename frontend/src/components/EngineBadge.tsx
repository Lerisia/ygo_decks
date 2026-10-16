import CoinBadge from "@/components/CoinBadge";

// Engine mark: a coin with an embossed "E" (특이점 2026-10-02 — the flat amber circle looked plain), in the blue the
// update mark had before it became a red N (특이점 2026-10-16).
export default function EngineBadge({ className = "" }: { className?: string }) {
  return <CoinBadge letter="E" palette="blue" title="Engine — 다양한 덱에 섞어 사용할 수 있는 덱" label="Engine" className={className} />;
}
