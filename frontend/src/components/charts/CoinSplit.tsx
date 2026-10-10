import { MeterBar } from "./Bar";
import { pctText, rate } from "./format";

export const COIN_FRONT = "/images/coin_front.webp";
export const COIN_BACK = "/images/coin_back.webp";

/** Win rate when the coin was won vs lost — in Master Duel the coin decides a lot, so it gets its own block. */
export function CoinSplit({ winGames, winWins, loseGames, loseWins }: { winGames: number; winWins: number; loseGames: number; loseWins: number }) {
  const won = rate(winWins, winGames);
  const lost = rate(loseWins, loseGames);
  const total = winGames + loseGames;
  const gap = won != null && lost != null ? won - lost : null;
  const half = (img: string, label: string, games: number, wins: number, value: number | null) => (
    <div className="flex gap-2 items-start min-w-0">
      <img src={img} alt="" className="w-9 h-9 shrink-0" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{label} · {games}판</span>
        <b className="text-xl leading-tight tabular-nums">{pctText(value)}</b>
        <MeterBar value={value} track="amber" />
        <small className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{wins}승 {games - wins}패</small>
      </div>
    </div>
  );
  return (
    <section className="rounded-xl px-3.5 py-3 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/60 flex flex-col gap-2.5">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-[15px]">코인토스별 승률</h3>
        {gap != null && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800/70 dark:text-amber-100 tabular-nums">
            {gap >= 0 ? "+" : ""}{gap.toFixed(0)}%p
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {half(COIN_FRONT, "코인 이김", winGames, winWins, won)}
        {half(COIN_BACK, "코인 짐", loseGames, loseWins, lost)}
      </div>
      {total > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {gap != null && gap !== 0 ? `코인을 ${gap > 0 ? "이긴" : "진"} 판이 ${Math.abs(gap).toFixed(0)}%p 더 이겼습니다. ` : ""}
          코인 이김 {winGames}번 / {total}번 ({pctText(rate(winGames, total))})
        </p>
      )}
    </section>
  );
}
