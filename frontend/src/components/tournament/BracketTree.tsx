import Avatar from "@/components/Avatar";
import type { Entrant, MatchItem, RoundItem } from "@/api/tournamentApi";

/** Knockout bracket drawn as columns of match nodes with elbow connectors.
 *  Rounds that don't exist yet render as placeholder slots, so the full
 *  tree (including the final) is visible from round 1. Scrolls
 *  horizontally on small screens — standard bracket behaviour. */

type Slot = { match?: MatchItem };

function entrantRow(e: Entrant | null, won: boolean, decided: boolean, isBye = false) {
  if (!e) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400">
        {isBye ? "부전승" : "미정"}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 min-w-0 ${decided && !won ? "opacity-40" : ""}`}>
      <Avatar icon={e.avatar_icon} border={e.border} size={20} />
      <span className={`truncate text-xs ${won ? "font-bold text-blue-600 dark:text-blue-400" : "text-gray-800 dark:text-gray-200"}`}>
        {e.name}
      </span>
    </div>
  );
}

function MatchNode({ match }: Slot) {
  const decided = !!match && (match.report_status === "confirmed" || match.result === "bye");
  const p1won = decided && (match!.result === "p1" || match!.result === "bye");
  const p2won = decided && match!.result === "p2";
  return (
    <div className="w-40 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 shadow-sm">
      {entrantRow(match?.entrant1 ?? null, p1won, decided)}
      {entrantRow(match?.entrant2 ?? null, p2won, decided, match?.result === "bye")}
    </div>
  );
}

export default function BracketTree({ rounds }: { rounds: RoundItem[] }) {
  const sorted = [...rounds].sort((a, b) => a.number - b.number);
  if (sorted.length === 0) return null;
  const r1 = [...sorted[0].matches].sort((a, b) => a.bracket_pos - b.bracket_pos);
  let total = 1;
  while (2 ** total < r1.length * 2) total += 1;
  // columns: existing rounds first, placeholders for the rest of the tree
  const columns: Slot[][] = [];
  for (let k = 1; k <= total; k++) {
    const expected = Math.max(1, r1.length / 2 ** (k - 1));
    const round = sorted.find((r) => r.number === k);
    if (round) {
      const ms = [...round.matches].sort((a, b) => a.bracket_pos - b.bracket_pos);
      columns.push(Array.from({ length: expected }, (_, i) => ({ match: ms[i] })));
    } else {
      columns.push(Array.from({ length: expected }, () => ({})));
    }
  }
  const line = "bg-gray-300 dark:bg-gray-600";
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex" style={{ minWidth: columns.length * 176 }}>
        {columns.map((col, k) => (
          <div key={k} className="flex flex-col w-44 shrink-0">
            <div className="text-xs text-gray-400 mb-1 text-center">
              {(() => {
                const size = 2 ** (columns.length - k);
                return size === 2 ? "결승" : size === 4 ? "준결승" : `${size}강`;
              })()}
            </div>
            <div className="flex flex-col flex-1">
              {col.map((slot, i) => (
                <div key={i} className="flex-1 flex items-center relative py-1.5">
                  {/* incoming stub (not for round 1) */}
                  {k > 0 && <span className={`absolute left-[-12px] top-1/2 w-3 h-px ${line}`} />}
                  <MatchNode match={slot.match} />
                  {/* outgoing stub + vertical join on the first node of each pair */}
                  {k < columns.length - 1 && (
                    <>
                      <span className={`absolute right-[4px] top-1/2 w-3 h-px ${line}`} style={{ right: -12 }} />
                      {i % 2 === 0 && col.length > 1 && (
                        <span className={`absolute w-px ${line}`} style={{ right: -12, top: "50%", height: "100%" }} />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
