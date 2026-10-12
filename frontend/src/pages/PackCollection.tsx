import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SearchForm from "@/components/SearchForm";
import { Input } from "@/components/ui/input";
import CardZoom from "@/components/CardZoom";
import { type Collection, type CollectionCard, getCollection } from "@/api/packApi";
import { getCard } from "@/api/cardDexApi";
import { isAuthenticated } from "@/api/accountApi";
import type { FinishParams } from "@/lib/cardFinish";
import type { Rarity } from "@/utils/packDraw";
import { makeMatcher, nameKeys } from "@/utils/hangul";

const RARITIES: Rarity[] = ["UR", "SR", "R", "N"];
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, UR: 3 };
const SORTS = {
  recent: { label: "최근 획득순", cmp: (a: CollectionCard, b: CollectionCard) => b.last.localeCompare(a.last) },
  rarity: { label: "레어도순", cmp: (a: CollectionCard, b: CollectionCard) => RANK[b.rarity] - RANK[a.rarity] || b.last.localeCompare(a.last) },
  count: { label: "장수순", cmp: (a: CollectionCard, b: CollectionCard) => total(b) - total(a) || RANK[b.rarity] - RANK[a.rarity] },
  name: { label: "이름순", cmp: (a: CollectionCard, b: CollectionCard) => a.name.localeCompare(b.name, "ko") },
} as const;
type Sort = keyof typeof SORTS;
const STEP = 60;
const total = (c: CollectionCard) => c.basic + c.shine + c.royal;
const best = (c: CollectionCard) => (c.royal ? "royal" : c.shine ? "shine" : "normal") as "royal" | "shine" | "normal";

/** 카드 모음 (엘리스 2026-10-13): every card the user has pulled in the pack simulator, how many and in which finishes;
 *  a tap shows it large in its best finish, in the game's shader. */
export default function PackCollection() {
  const [data, setData] = useState<Collection | null>(null);
  const [error, setError] = useState(false);
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [finish, setFinish] = useState<"" | "shine" | "royal">("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [limit, setLimit] = useState(STEP);
  const [zoom, setZoom] = useState<{ card: CollectionCard; params: FinishParams | null } | null>(null);
  const signedIn = isAuthenticated();

  useEffect(() => {
    if (signedIn) getCollection().then(setData).catch(() => setError(true));
  }, [signedIn]);

  const shown = useMemo(() => {
    if (!data) return [];
    const match = makeMatcher(query);
    return data.cards
      .filter((c) => !rarities.size || rarities.has(c.rarity))
      .filter((c) => !finish || c[finish] > 0)
      .filter((c) => !query.trim() || match(nameKeys(c.name)))
      .sort(SORTS[sort].cmp);
  }, [data, rarities, finish, query, sort]);

  const look = async (card: CollectionCard) => {
    setZoom({ card, params: null });
    if (best(card) === "normal") return;
    try {
      const doc = await getCard(card.card);
      const face = doc.faces.find((f) => f.id === card.print);
      setZoom((z) => (z && z.card === card ? {
        card, params: { ...doc.finish, frame: face?.overframe ? "overframe" : doc.finish.frame, name: face?.name_mask ?? null },
      } : z));
    } catch {
      /* the plain face then */
    }
  };

  const toggle = (r: Rarity) => {
    const next = new Set(rarities);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setRarities(next);
    setLimit(STEP);
  };

  const s = data?.summary;
  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-5xl mx-auto">
      <Link to="/packs" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 팩 목록</Link>
      <h1 className="mt-3 text-2xl md:text-4xl font-bold">카드 모음</h1>
      {!signedIn ? (
        <p className="py-16 text-center text-gray-500">
          <Link to="/login" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">로그인</Link>하면 팩에서 뽑은 카드가 여기에 모입니다.
        </p>
      ) : error ? (
        <p className="py-16 text-center text-gray-500">카드 모음을 불러오지 못했습니다.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2 text-center tabular-nums">
            {[
              ["보유 젬", data?.gems], ["카드", s?.total], ["종류", s?.kinds],
              ["UR · SR", s ? `${s.ur} · ${s.sr}` : undefined], ["샤인 · 로얄", s ? `${s.shine} · ${s.royal}` : undefined],
              ["쓴 젬", s?.gems_spent],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-gray-100 dark:bg-gray-800 py-2">
                <dt className="text-[11px] text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="h-6 font-bold">{value === undefined ? "" : typeof value === "number" ? value.toLocaleString() : value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {RARITIES.map((r) => (
              <button key={r} type="button" aria-pressed={rarities.has(r)} onClick={() => toggle(r)}
                      className={`h-9 px-2.5 rounded-lg transition ${rarities.has(r) ? "bg-blue-600" : "bg-gray-100 dark:bg-gray-800"}`}>
                <img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" />
              </button>
            ))}
            {(["shine", "royal"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={finish === f} onClick={() => { setFinish(finish === f ? "" : f); setLimit(STEP); }}
                      className={`h-9 px-3 rounded-lg text-sm font-semibold transition ${finish === f ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
                {f === "shine" ? "샤인" : "로얄"}
              </button>
            ))}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬"
                    className="h-9 ml-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 text-sm">
              {(Object.keys(SORTS) as Sort[]).map((k) => <option key={k} value={k}>{SORTS[k].label}</option>)}
            </select>
          </div>
          <div className="mt-2">
            <SearchForm>
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(STEP); }} placeholder="카드 이름으로 찾기"
                     aria-label="카드 이름으로 찾기" enterKeyHint="search" className="h-10" />
            </SearchForm>
          </div>

          <p className="mt-3 h-5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">{data ? `${shown.length.toLocaleString()}종` : ""}</p>
          {data && !data.cards.length ? (
            <p className="py-16 text-center text-gray-500">
              아직 뽑은 카드가 없습니다. <Link to="/packs" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">팩 열러 가기</Link>
            </p>
          ) : (
            <ul className="mt-1 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {data
                ? shown.slice(0, limit).map((c) => (
                    <li key={c.print}>
                      <button type="button" onClick={() => look(c)} title={c.name} className="relative block w-full"
                              aria-label={`${c.name} ${c.rarity} ${total(c)}장${c.shine ? ` 샤인 ${c.shine}` : ""}${c.royal ? ` 로얄 ${c.royal}` : ""}`}>
                        {c.thumb
                          ? <img loading="lazy" decoding="async" src={c.thumb} alt="" className="w-full aspect-[704/1024] object-cover card-corner" />
                          : <span className="block w-full aspect-[704/1024] rounded bg-gray-200 dark:bg-gray-700" />}
                        <img src={`/media/md_ui/rarity_${c.rarity.toLowerCase()}_hd.png`} alt="" className="absolute top-0 right-0 h-3.5 sm:h-4 w-auto" />
                        <span className="absolute bottom-[3%] right-[4%] px-1 rounded bg-black/70 text-white text-[10px] sm:text-xs font-bold tabular-nums">×{total(c)}</span>
                        <span className="absolute bottom-[3%] left-[4%] flex gap-0.5">
                          {c.royal > 0 && <span className="px-1 rounded bg-fuchsia-600 text-white text-[9px] sm:text-[10px] font-bold leading-4">로얄{c.royal > 1 ? c.royal : ""}</span>}
                          {c.shine > 0 && <span className="px-1 rounded bg-sky-600 text-white text-[9px] sm:text-[10px] font-bold leading-4">샤인{c.shine > 1 ? c.shine : ""}</span>}
                        </span>
                      </button>
                    </li>
                  ))
                : Array.from({ length: 16 }, (_, i) => (
                    <li key={i} aria-hidden="true"><div className="w-full aspect-[704/1024] rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></li>
                  ))}
            </ul>
          )}
          {shown.length > limit && (
            <button type="button" onClick={() => setLimit(limit + STEP)} className="mt-3 w-full h-10 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-semibold">
              더 보기 ({(shown.length - limit).toLocaleString()})
            </button>
          )}
        </>
      )}

      {zoom && (
        <CardZoom
          src={zoom.card.face ?? zoom.card.thumb ?? ""}
          alt={`${zoom.card.name}${best(zoom.card) === "royal" ? " (로얄 가공)" : best(zoom.card) === "shine" ? " (샤인 가공)" : ""}`}
          finish={zoom.params ? best(zoom.card) : "normal"}
          params={zoom.params ?? { attribute: 0, level: 0, frame: "normal" }}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}
