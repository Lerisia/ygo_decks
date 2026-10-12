import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PackFront from "@/components/packs/PackFront";
import PackOpening from "@/components/packs/PackOpening";
import { type PackCard, type PackDetail as Pack, getPack } from "@/api/packApi";
import { unlockPackSound } from "@/lib/packSound";
import { type Pool, type Pulled, type Rarity, GEMS_PER_PACK, RATES, drawPack, drawTen } from "@/utils/packDraw";
import { clearTally, markSeen, saveTally, tallyOf } from "@/utils/packRecord";

const KIND_LABEL = { normal: "마스터 팩", secret: "시크릿 팩", selection: "셀렉션 팩" } as const;
const RARITIES: Rarity[] = ["UR", "SR", "R", "N"];
const STEP = 60;
const pct = (x: number) => `${+(x * 100).toFixed(3)}%`;

const byRarity = (cards: PackCard[]): Pool<PackCard> => {
  const pool: Pool<PackCard> = { N: [], R: [], SR: [], UR: [] };
  for (const c of cards) pool[c.rarity].push(c);
  return pool;
};

/** A pack: open one or ten (the game's guarantees and its UR owed after ten without one, kept in this browser), what
 *  it holds by rarity, and its 제공 확률 in the game's own words. */
export default function PackDetail() {
  const id = Number(useParams().packId);
  const [pack, setPack] = useState<Pack | null>(null);
  const [master, setMaster] = useState<Pack | null>(null);
  const [error, setError] = useState(false);
  const [tally, setTally] = useState(() => tallyOf(id));
  const [run, setRun] = useState<{ key: number; packs: Pulled<PackCard>[][]; fresh: Set<number> } | null>(null);
  const [rates, setRates] = useState(false);
  const openStage = useRef("pack");
  const running = !!run;

  // A phone's back gesture (an iPhone takes a stroke from the screen's left edge as one) must not leave the page in
  // the middle of an opening (엘리스 10/13): the opening holds a history entry of its own; a back while packs are opening
  // only gives it up and takes it again, and on the ten laid out or the results it closes the opening.
  useEffect(() => {
    if (!running) return;
    const mark = () => window.history.pushState({ ...window.history.state, packOpening: true }, "");
    mark();
    let closing = false;
    const onPop = () => {
      if (openStage.current === "overview" || openStage.current === "result") {
        closing = true;
        setRun(null);
      } else mark();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closing && window.history.state?.packOpening) window.history.back();
    };
  }, [running]);

  useEffect(() => {
    setPack(null);
    setMaster(null);
    setTally(tallyOf(id));
    getPack(id)
      .then((p) => {
        setPack(p);
        if (p.kind === "secret" && p.master_pack) getPack(p.master_pack).then(setMaster).catch(() => setError(true));
      })
      .catch(() => setError(true));
  }, [id]);

  const pools = useMemo(() => {
    if (!pack || (pack.kind === "secret" && !master)) return null;
    return { main: byRarity(pack.cards), master: pack.kind === "secret" && master ? byRarity(master.cards) : undefined };
  }, [pack, master]);

  const open = (count: 1 | 10) => {
    if (!pools) return;
    unlockPackSound();
    const drawn = count === 1 ? { packs: [drawPack(pools)], pity: tally.pity } : drawTen(pools, tally.pity);
    const flat = drawn.packs.flat();
    const next = {
      gems: tally.gems + count * GEMS_PER_PACK, packs: tally.packs + count, pity: drawn.pity,
      ur: tally.ur + flat.filter((c) => c.rarity === "UR").length, sr: tally.sr + flat.filter((c) => c.rarity === "SR").length,
    };
    saveTally(id, next);
    setTally(next);
    setRun({ key: Date.now(), packs: drawn.packs, fresh: markSeen(flat.map((c) => c.card.print)) });
  };

  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-4xl mx-auto">
      <Link to="/packs" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 팩 목록</Link>
      {error && !pack ? (
        <p className="py-16 text-center text-gray-500">팩을 불러오지 못했습니다.</p>
      ) : (
        <>
          <div className="mt-3 flex gap-4 sm:gap-6">
            {pack ? (
              <PackFront name={pack.name} src={pack.image} eager className="w-32 sm:w-44 shrink-0 rounded-md shadow-lg" />
            ) : (
              <div className="w-32 sm:w-44 shrink-0 aspect-[250/512] rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
            )}
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <span className="h-4 text-xs font-bold text-blue-600 dark:text-blue-400">{pack ? KIND_LABEL[pack.kind] : ""}</span>
              <h1 className="text-xl sm:text-3xl font-extrabold leading-tight break-keep min-h-[1.25em]">{pack?.name ?? ""}</h1>
              <p className="h-5 text-sm text-gray-500 dark:text-gray-400 tabular-nums">{pack?.released ? `${pack.released} 출시` : ""}</p>
              <div className="mt-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" disabled={!pools} onClick={() => open(1)}
                        className="h-12 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold">
                  1팩 <span className="text-sm font-semibold opacity-80">{GEMS_PER_PACK}젬</span>
                </button>
                <button type="button" disabled={!pools} onClick={() => open(10)}
                        className="h-12 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold leading-tight">
                  10팩 <span className="text-sm font-semibold opacity-80">{(GEMS_PER_PACK * 10).toLocaleString()}젬</span>
                  <span className={`block text-[11px] font-semibold ${tally.pity.owed ? "text-amber-200" : "opacity-80"}`}>
                    {tally.pity.owed ? "10팩으로 UR 확정" : "10팩으로 SR 이상 1장 확정"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm min-h-[24px]">
            {tally.packs > 0 && (
              <>
                <span className="tabular-nums">이 팩에 쓴 젬 <b>{tally.gems.toLocaleString()}</b></span>
                <span className="tabular-nums">UR <b>{tally.ur}</b> · SR <b>{tally.sr}</b></span>
                <button type="button" onClick={() => { clearTally(id); setTally(tallyOf(id)); }} className="text-gray-500 dark:text-gray-400 underline">
                  기록 지우기
                </button>
              </>
            )}
            <button type="button" onClick={() => setRates(true)} disabled={!pack} className="ml-auto text-blue-600 dark:text-blue-400 font-semibold hover:underline">
              제공 확률 정보
            </button>
          </div>

          {pack && <CardList pack={pack} />}
        </>
      )}

      {run && pack && (
        <PackOpening key={run.key} pack={pack} packs={run.packs} fresh={run.fresh} onClose={() => setRun(null)} onAgain={open}
                     onStage={(st) => { openStage.current = st; }} />
      )}
      {rates && pack && <Rates pack={pack} master={master} onClose={() => setRates(false)} />}
    </div>
  );
}

/** 팩 수록 카드 (a secret pack's: 픽업 대상 카드), a rarity at a time, a screenful at a time. */
function CardList({ pack }: { pack: Pack }) {
  const pool = useMemo(() => byRarity(pack.cards), [pack]);
  const [tab, setTab] = useState<Rarity>(() => RARITIES.find((r) => pool[r].length) ?? "UR");
  const [limit, setLimit] = useState(STEP);
  const cards = pool[tab];
  return (
    <section className="mt-6" aria-labelledby="pack-cards">
      <h2 id="pack-cards" className="text-lg font-bold">{pack.kind === "secret" ? "픽업 대상 카드" : "팩 수록 카드"}</h2>
      {pack.kind === "secret" && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">1~4장째는 마스터 팩 수록 카드에서, 5~8장째는 픽업 대상 카드에서 나옵니다.</p>
      )}
      <div role="tablist" aria-label="레어도" className="mt-3 flex gap-1.5">
        {RARITIES.map((r) => (
          <button key={r} role="tab" aria-selected={tab === r} disabled={!pool[r].length}
                  onClick={() => { setTab(r); setLimit(STEP); }}
                  className={`h-9 px-3 rounded-lg flex items-center gap-1.5 text-sm font-semibold tabular-nums transition disabled:opacity-40 ${
                    tab === r ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
            <img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" />
            {pool[r].length.toLocaleString()}
          </button>
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {cards.slice(0, limit).map((c) => (
          <li key={c.print}>
            <Link to={`/cards/${c.card}`} title={c.name} className="block">
              <img loading="lazy" decoding="async" src={c.thumb} alt={c.name} className="w-full aspect-[704/1024] object-cover card-corner" />
            </Link>
          </li>
        ))}
      </ul>
      {cards.length > limit && (
        <button type="button" onClick={() => setLimit(limit + STEP)} className="mt-3 w-full h-10 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-semibold">
          더 보기 ({(cards.length - limit).toLocaleString()})
        </button>
      )}
    </section>
  );
}

/** 제공 확률: the game's own table and wording, with this pack's card counts (종류 수) and each card's share. */
function Rates({ pack, master, onClose }: { pack: Pack; master: Pack | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const secret = pack.kind === "secret";
  const own = byRarity(pack.cards);
  const from = secret && master ? byRarity(master.cards) : own;
  const rows: { label: string; odds: Partial<Record<Rarity, number>>; pool: Pool<PackCard>; note?: string }[] = secret
    ? [
        { label: "1~4장째의 제공 확률", odds: RATES.slot, pool: from, note: "팩 수록 카드(마스터 팩)" },
        { label: "5~7장째의 제공 확률", odds: RATES.slot, pool: own, note: "픽업 대상 카드" },
        { label: "8장째의 제공 확률", odds: RATES.eighth, pool: own, note: "픽업 대상 카드 (R 이상 확정)" },
        { label: "10팩째의 8장째의 제공 확률", odds: RATES.tenth, pool: own, note: "픽업 대상 카드 (SR 이상 확정)" },
      ]
    : [
        { label: "1~7장째의 제공 확률", odds: RATES.slot, pool: own },
        { label: "8장째의 제공 확률", odds: RATES.eighth, pool: own, note: "R 이상 확정" },
        { label: "10팩째의 8장째의 제공 확률", odds: RATES.tenth, pool: own, note: "SR 이상 확정" },
      ];
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="rates-title">
      <div className="w-full sm:max-w-lg max-h-[85svh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="rates-title" className="text-lg font-bold m-0">제공 확률</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800">✕</button>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 break-keep">1팩에는 카드가 8장 들어 있으며, 8장째의 카드는 반드시 R 이상의 레어도로 출현합니다.</p>
        <h3 className="mt-4 text-base font-semibold">레어도별 제공 확률</h3>
        {rows.map((row) => (
          <div key={row.label} className="mt-3">
            <p className="text-sm font-semibold">{row.label}{row.note && <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">· {row.note}</span>}</p>
            <table className="mt-1 w-full text-sm tabular-nums">
              <thead className="text-xs text-gray-500 dark:text-gray-400">
                <tr><th className="text-left font-normal py-1">레어도</th><th className="text-right font-normal">제공 확률</th><th className="text-right font-normal">종류 수(1장마다의 제공 확률)</th></tr>
              </thead>
              <tbody>
                {RARITIES.filter((r) => row.odds[r]).map((r) => (
                  <tr key={r} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1"><img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-4 w-auto" /></td>
                    <td className="text-right">{pct(row.odds[r]!)}</td>
                    <td className="text-right">{row.pool[r].length.toLocaleString()} ({row.pool[r].length ? pct(row.odds[r]! / row.pool[r].length) : "-"})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 break-keep">
          10팩을 한 번에 구입하여 그중에 UR 카드가 1장도 나오지 않았을 경우, 다음에 같은 팩을 10팩 한 번에 구입했을 때 10번째 팩에서 나온 8번째 카드가 UR 레어도로 출현합니다.
        </p>
        <h3 className="mt-4 text-base font-semibold">가공 카드의 출현율</h3>
        <table className="mt-1 w-full text-sm tabular-nums">
          <thead className="text-xs text-gray-500 dark:text-gray-400">
            <tr><th className="text-left font-normal py-1">가공명</th><th className="text-right font-normal">UR · SR</th><th className="text-right font-normal">R · N</th></tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100 dark:border-gray-800"><td className="py-1">베이직 가공</td><td className="text-right">90%</td><td className="text-right">90%</td></tr>
            <tr className="border-t border-gray-100 dark:border-gray-800"><td className="py-1">샤인 가공</td><td className="text-right">9%</td><td className="text-right">10%</td></tr>
            <tr className="border-t border-gray-100 dark:border-gray-800"><td className="py-1">로얄 가공</td><td className="text-right">1%</td><td className="text-right">-</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
