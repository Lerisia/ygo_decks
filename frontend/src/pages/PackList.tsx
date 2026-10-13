import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import SearchForm from "@/components/SearchForm";
import { Input } from "@/components/ui/input";
import PackFront from "@/components/packs/PackFront";
import { PackTopBar } from "@/components/packs/Gem";
import { type PackHit, type PackKind, type PackSummary, getPacks, searchPacks } from "@/api/packApi";
import { makeMatcher, nameKeys } from "@/utils/hangul";


/** The pack tapped on the way out, and where on the screen it was: Back puts it there again once the list is drawn
 *  (엘리스 10/13: on an iPhone, Back found the list far from where it was left). */
const ANCHOR = "packs_anchor";
type Anchor = { list: string; tile: string; top: number; y: number };
const readAnchor = (): Anchor | null => {
  try {
    return JSON.parse(sessionStorage.getItem(ANCHOR) ?? "null");
  } catch {
    return null;
  }
};

const KINDS: { key: "all" | PackKind; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "selection", label: "셀렉션 팩" },   // the main packs, ahead of the secret ones (엘리스 10/13)
  { key: "secret", label: "시크릿 팩" },
  { key: "normal", label: "마스터 팩" },
];

// A pack holding other arts or 오버프레임 says so on its cover, the usual pack and each campaign's alike; the line under
// the name is always its date (엘리스 2026-10-13: the counts once stood there, in place of the date).
const ART_BADGE = "rounded px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-amber-500/95 shadow";

/** 팩깡 시뮬레이터 (엘리스 2026-10-12, the name 10/13): every master, selection and secret pack Master Duel has had, newest first
 *  (the master pack last), by kind, by name or by a pickup card (10/13: the packs whose names match, then those
 *  holding a card that does, with the cards named). */
export default function PackList() {
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [error, setError] = useState(false);
  // the kind, the search and the filter live in the address too, so Back from a pack finds them as they were
  // (엘리스 10/13); the scroll comes back with useScrollRestoration
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<"all" | PackKind>(() => KINDS.find((k) => k.key === params.get("kind"))?.key ?? "all");
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [special, setSpecial] = useState(() => params.get("art") === "1");   // only the packs with a new art or an 오버프레임
  const [hits, setHits] = useState<{ q: string; byPack: Map<number, PackHit & { rank: number }> } | null>(null);

  useEffect(() => {
    getPacks().then(setPacks).catch(() => setError(true));
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (kind !== "all") next.set("kind", kind);
    if (query) next.set("q", query);
    if (special) next.set("art", "1");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [kind, query, special]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  const location = useLocation();
  const back = useNavigationType() === "POP";
  const listUrl = location.pathname + location.search;
  const mounted = useRef(performance.now());
  const keep = (tile: string, el: HTMLElement) => {
    try {
      sessionStorage.setItem(ANCHOR, JSON.stringify({ list: listUrl, tile, top: el.getBoundingClientRect().top, y: window.scrollY }));
    } catch {
      /* Back then relies on the site's own scroll memory */
    }
  };

  const { shown, byCard } = useMemo(() => {
    if (!packs) return { shown: [], byCard: new Map<number, PackHit>() };
    const q = query.trim();
    const match = makeMatcher(query);
    const en = q.toLowerCase();
    const rows = packs.filter((p) => (kind === "all" || p.kind === kind) && (!special || p.arts.new_art + p.arts.overframe > 0));
    const named = rows.filter((p) => !en || match(nameKeys(p.name)) || p.name_en.toLowerCase().includes(en))
      .sort((a, b) => Number(a.master) - Number(b.master));   // the master pack last: no one opens it (엘리스 10/13)
    const found = q && hits?.q === q ? hits.byPack : null;
    if (!found) return { shown: named, byCard: new Map<number, PackHit>() };
    const ids = new Set(named.map((p) => p.id));
    const carded = rows.filter((p) => !ids.has(p.id) && found.has(p.id)).sort((a, b) => found.get(a.id)!.rank - found.get(b.id)!.rank);
    return { shown: [...named, ...carded], byCard: new Map(carded.map((p) => [p.id, found.get(p.id)!])) };
  }, [packs, kind, query, hits, special]);

  // back from a pack: the tapped pack where it was on the screen, once the list is drawn — again as search results come
  // in, for a moment after coming back
  useLayoutEffect(() => {
    if (!back || !packs || performance.now() - mounted.current > 2500) return;
    const a = readAnchor();
    if (!a || a.list !== listUrl) return;
    const el = document.querySelector<HTMLElement>(`[data-tile="${a.tile}"]`);
    window.scrollTo(0, el ? window.scrollY + el.getBoundingClientRect().top - a.top : a.y);
  }, [back, packs, shown, listUrl]);

  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-5xl mx-auto">
      <PackTopBar>
        <button onClick={() => navigate("/playground")} className="text-blue-600 dark:text-blue-400 hover:underline">← 놀이터</button>
      </PackTopBar>
      <h1 className="mt-2 text-2xl md:text-4xl font-bold">팩깡 시뮬레이터</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">
        마스터 듀얼의 팩을 게임과 같은 제공 확률로 열어 봅니다.
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
          다른 일러·오버프레임 팩만
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
                <li key={`${p.id}-${p.version ?? 0}`} data-tile={`${p.id}-${p.version ?? 0}`}>
                  <Link to={`/packs/${p.id}${p.version ? `?v=${p.version}` : ""}`} state={{ fromList: true }} className="group block"
                        onClick={(e) => keep(`${p.id}-${p.version ?? 0}`, e.currentTarget)}>
                    <span className="relative block">
                      <PackFront name={p.name} src={p.image} className="w-full rounded-md shadow group-hover:shadow-lg transition" />
                      {p.arts.new_art + p.arts.overframe > 0 && (
                        <span className="absolute left-1 top-1 flex flex-col items-start gap-0.5">
                          {p.arts.new_art > 0 && <span className={ART_BADGE}>다른 일러 {p.arts.new_art}</span>}
                          {p.arts.overframe > 0 && <span className={ART_BADGE}>오버프레임 {p.arts.overframe}</span>}
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block text-xs sm:text-sm font-semibold leading-snug break-keep line-clamp-2 min-h-[2.75em]">{p.name}</span>
                    {hit ? (
                      <span className="block text-[11px] font-semibold text-blue-600 dark:text-blue-400 truncate" title={hit.cards.join(", ")}>
                        {hit.cards.join(", ")}{hit.count > hit.cards.length ? ` 외 ${hit.count - hit.cards.length}장` : ""}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400 tabular-nums truncate"
                            title={p.period ? `${p.period[0]} ~ ${p.period[1]} · ${p.featured.join(", ")}` : undefined}>
                        {p.period ? p.period[0] : p.released ?? ""}
                      </span>
                    )}
                  </Link>
                </li>
                );
              })
            : Array.from({ length: 12 }, (_, i) => (
                <li key={i} aria-hidden="true">
                  <div className="w-full aspect-[250/512] rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="mt-1.5 h-[2.75em] rounded bg-gray-200 dark:bg-gray-700 animate-pulse text-xs sm:text-sm" />
                  <div className="mt-0.5 h-[14px] w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}
