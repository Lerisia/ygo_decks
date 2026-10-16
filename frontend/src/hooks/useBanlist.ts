import { useEffect, useState } from "react";
import { getBanTable, getBanlistIndex, loadedBanTable } from "@/api/banlistApi";
import { type BanTable, type BanlistIndex, pendingRule, ruleOf } from "@/lib/banlists";

/** The 금제 a deck picked (key, lib/banlists) as its cards are judged by, and every game's lists for picking another
 *  (참혈 2026-10-16). Until its table comes the deck is judged by what the cards carry for Master Duel's newest, or
 *  limits nothing for another list, so the wrong list's marks never show. */
export function useBanlist(key: string) {
  const [index, setIndex] = useState<BanlistIndex | null>(null);
  const [table, setTable] = useState<{ key: string; table: BanTable } | null>(null);
  useEffect(() => {
    let alive = true;
    getBanlistIndex().then((i) => alive && setIndex(i), () => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    getBanTable(key).then((t) => alive && setTable({ key, table: t }), () => {});
    return () => {
      alive = false;
    };
  }, [key]);
  const got = table?.key === key ? table.table : loadedBanTable(key);
  return { index, table: got ?? null, rule: got ? ruleOf(got) : pendingRule(key) };
}
