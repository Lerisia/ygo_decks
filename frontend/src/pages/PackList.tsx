import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SearchForm from "@/components/SearchForm";
import { Input } from "@/components/ui/input";
import PackFront from "@/components/packs/PackFront";
import { PackTopBar } from "@/components/packs/Gem";
import { type PackHit, type PackKind, type PackSummary, getPacks, searchPacks } from "@/api/packApi";
import { makeMatcher, nameKeys } from "@/utils/hangul";
import { isAuthenticated } from "@/api/accountApi";

const KINDS: { key: "all" | PackKind; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "selection", label: "셀렉션 팩" },   // the main packs, ahead of the secret ones (엘리스 10/13)
  { key: "secret", label: "시크릿 팩" },
  { key: "normal", label: "마스터 팩" },
];

/** 팩깡 시뮬레이터 (엘리스 2026-10-12, the name 10/13): every master, selection and secret pack Master Duel has had, newest first
 *  (the master pack ahead), by kind, by name or by a pickup card (10/13: the packs whose names match, then those
 *  holding a card that does, with the cards named). */
export default function PackList() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<"all" | PackKind>("all");
  const [query, setQuery] = useState("");
  const [special, setSpecial] = useState(false);   // only the packs with a new art or an 오버프레임 (엘리스 10/13)
  const [hits, setHits] = useState<{ q: string; byPack: Map<number, PackHit & { rank: number }> } | null>(null);

  useEffect(() => {
    getPacks().then(setPacks).catch(() => setError(true));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const stop = new AbortController();
    const wait = window.setTimeout(() => {
      searchPacks(q, stop.signal)
        .then((found) => setHits({ q, byPack: new Map(found.map((h, rank) => [h.id, { ...h, rank }])) }))
        .catch(() => {});
    }, 250);
    return () => { window.clearTimeout(wait); stop.abort(); };
  }, [query]);

  const { shown, byCard } = useMemo(() => {
    if (!packs) return { shown: [], byCard: new Map<number, PackHit>() };
    const q = query.trim();
    const match = makeMatcher(query);
    const en = q.toLowerCase();
    const rows = packs.filter((p) => (kind === "all" || p.kind === kind) && (!special || p.arts.new_art + p.arts.overframe > 0));
    const named = rows.filter((p) => !en || match(nameKeys(p.name)) || p.name_en.toLowerCase().includes(en))
      .sort((a, b) => Number(b.master) - Number(a.master));
    const found = q && hits?.q === q ? hits.byPack : null;
    if (!found) return { shown: named, byCard: new Map<number, PackHit>() };
    const ids = new Set(named.map((p) => p.id));
    const carded = rows.filter((p) => !ids.has(p.id) && found.has(p.id)).sort((a, b) => found.get(a.id)!.rank - found.get(b.id)!.rank);
    return { shown: [...named, ...carded], byCard: new Map(carded.map((p) => [p.id, found.get(p.id)!])) };
  }, [packs, kind, query, hits, special]);

  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-5xl mx-auto">
      <PackTopBar>
        <button onClick={() => navigate("/playground")} className="text-blue-600 dark:text-blue-400 hover:underline">← 놀이터</button>
        {isAuthenticated() && <Link to="/packs/collection" className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">카드 모음</Link>}
      </PackTopBar>
      <h1 className="mt-2 text-2xl md:text-4xl font-bold">팩깡 시뮬레이터</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">
        마스터 듀얼의 팩을 게임과 같은 제공 확률로 열어 봅니다. 뽑은 카드는 카드 모음에 쌓입니다.
      </p>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <div role="tablist" aria-label="팩 종류" className="grid grid-cols-4 rounded-lg bg-gray-200 dark:bg-gray-700 p-0.5 text-sm font-semibold sm:w-[26rem] shrink-0">
          {KINDS.map((k) => (
            <button
              key={k.key}
              role="tab"
              aria-selected={kind === k.key}
              onClick={() => setKind(k.key)}
              className={`h-9 rounded-md whitespace-nowrap transition ${kind === k.key ? "bg-white dark:bg-gray-900 shadow text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-300"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <SearchForm>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="팩 이름이나 픽업 카드로 찾기" aria-label="팩 이름이나 픽업 카드로 찾기" enterKeyHint="search" className="flex-1 h-10" />
        </SearchForm>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{packs ? `${shown.length.toLocaleString()}개` : ""}</p>
        <button type="button" aria-pressed={special} onClick={() => setSpecial((v) => !v)}
                className={`h-8 px-3 rounded-full border text-xs sm:text-sm font-semibold transition ${special
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"}`}>
          신규 일러·오버프레임 팩만
        </button>
      </div>
      {error ? (
        <p className="py-16 text-center text-gray-500">팩 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-4">
          {packs
            ? shown.map((p) => {
                const hit = byCard.get(p.id);
                return (
                <li key={p.id}>
                  <Link to={`/packs/${p.id}`} className="group block">
                    <PackFront name={p.name} src={p.image} className="w-full rounded-md shadow group-hover:shadow-lg transition" />
                    <span className="mt-1.5 block text-xs sm:text-sm font-semibold leading-snug break-keep line-clamp-2 min-h-[2.5em]">{p.name}</span>
                    {hit ? (
                      <span className="block text-[11px] font-semibold text-blue-600 dark:text-blue-400 truncate" title={hit.cards.join(", ")}>
                        {hit.cards.join(", ")}{hit.count > hit.cards.length ? ` 외 ${hit.count - hit.cards.length}장` : ""}
                      </span>
                    ) : special ? (
                      <span className="block text-[11px] font-semibold text-amber-600 dark:text-amber-400 truncate">
                        {[p.arts.new_art && `신규 일러 ${p.arts.new_art}`, p.arts.overframe && `오버프레임 ${p.arts.overframe}`].filter(Boolean).join(" · ")}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">{p.released ?? ""}</span>
                    )}
                  </Link>
                </li>
                );
              })
            : Array.from({ length: 12 }, (_, i) => (
                <li key={i} aria-hidden="true">
                  <div className="w-full aspect-[250/512] rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="mt-1.5 h-[2.5em] rounded bg-gray-200 dark:bg-gray-700 animate-pulse text-xs sm:text-sm" />
                  <div className="mt-0.5 h-[14px] w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}
