// Engine mark: a gold coin with an embossed "E" (특이점 2026-10-02 — the flat amber circle looked plain).
const COIN: React.CSSProperties = {
  background: "radial-gradient(circle at 32% 28%, #fff7d1 0%, #fcd34d 30%, #f59e0b 64%, #b45309 100%)",
  boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.55), inset 0 -2px 3px rgba(120,53,15,0.35), 0 1px 3px rgba(0,0,0,0.35)",
  color: "#7c2d12",
  textShadow: "0 1px 0 rgba(255,255,255,0.65)",
};

export default function EngineBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`rounded-full font-black leading-none flex items-center justify-center ring-2 ring-white dark:ring-gray-900 ${className}`}
      style={COIN}
      title="Engine — 다양한 덱에 섞어 사용할 수 있는 덱"
      aria-label="Engine"
    >
      E
    </span>
  );
}
