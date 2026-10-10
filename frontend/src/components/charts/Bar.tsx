import { pctText } from "./format";

const TRACK = {
  red: "bg-red-100 dark:bg-red-950/50",
  amber: "bg-amber-100 dark:bg-amber-950/60",
  gray: "bg-gray-100 dark:bg-gray-700",
};

export function MeterBar({ value, track = "gray", className = "" }: { value: number | null; track?: keyof typeof TRACK; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full ${TRACK[track]} overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

/** One small figure with a thin bar under it. */
export function BarStat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex justify-between items-baseline text-xs text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <b className="text-sm text-gray-900 dark:text-gray-100 tabular-nums">{pctText(value)}</b>
      </div>
      <MeterBar value={value} track="red" />
      {sub && <small className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{sub}</small>}
    </div>
  );
}
