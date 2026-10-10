import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

type Counts = { decks: number; cards: number };

// The same for everyone and rarely changing: fetched once per visit.
let cached: Counts | null = null;
let pending: Promise<Counts> | null = null;

function loadCounts() {
  pending ??= fetch("/api/carddb/dex-counts/")
    .then((r) => r.json())
    .then((c: Counts) => (cached = c))
    .catch(() => {
      pending = null;
      return { decks: 0, cards: 0 };
    });
  return pending;
}

/** How many decks and cards the 도감 holds (null while loading). */
export function useDexCounts() {
  const [counts, setCounts] = useState<Counts | null>(cached);
  useEffect(() => {
    if (!cached) loadCounts().then(setCounts);
  }, []);
  return counts;
}

/** The 도감's two books, decks and cards, as tabs with how many each holds. */
export default function DexTabs() {
  const { pathname } = useLocation();
  const counts = useDexCounts();
  const onCards = pathname.startsWith("/cards");
  const tab = (to: string, active: boolean, label: string, n: number | undefined, unit: string) => (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`py-2 rounded-md text-center transition ${
        active ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {label}{" "}
      {n !== undefined ? (
        <b className="tabular-nums">{n.toLocaleString()}</b>
      ) : (
        <span className="inline-block w-10 h-4 align-middle rounded bg-gray-300 dark:bg-gray-600 animate-pulse" />
      )}
      {unit}
    </Link>
  );
  return (
    <nav aria-label="도감" className="mb-4 mx-auto max-w-md grid grid-cols-2 gap-1 rounded-lg bg-gray-200 dark:bg-gray-700 p-1 text-sm sm:text-base font-semibold">
      {tab("/database", !onCards, "덱", counts?.decks, "개")}
      {tab("/cards", onCards, "카드", counts?.cards, "장")}
    </nav>
  );
}
