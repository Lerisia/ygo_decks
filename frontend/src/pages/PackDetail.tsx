import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PackFront from "@/components/packs/PackFront";
import PackOpening from "@/components/packs/PackOpening";
import { GemIcon, PackListLink, PackTopBar } from "@/components/packs/Gem";
import { setGems } from "@/lib/gems";
import { type PackCard, type PackDetail as Pack, type PackMine, type PackVersion, getPack, getPackMine, openPack } from "@/api/packApi";
import { isAuthenticated } from "@/api/accountApi";
import { unlockPackSound } from "@/lib/packSound";
import { type Pool, type Pulled, type Rarity, GEMS_PER_PACK, RATES } from "@/utils/packDraw";

const KIND_LABEL = { normal: "마스터 팩", secret: "시크릿 팩", selection: "셀렉션 팩" } as const;
const RARITIES: Rarity[] = ["UR", "SR", "R", "N"];
const STEP = 60;
const pct = (x: number) => `${+(x * 100).toFixed(3)}%`;
const NO_TALLY = { gems: 0, packs: 0, ur: 0, sr: 0, owed: false };

/** The pack as a version sold it: its cover then, and its cards with those of the campaign in their art. */
const asSold = (pack: Pack, version: PackVersion | null): Pack => {
  if (!version) return pack;
  const art = new Map(version.arts.map(({ base, ...c }) => [base, c]));
  return { ...pack, image: version.image ?? pack.image, image_hd: version.image_hd ?? pack.image_hd,
           cards: pack.cards.map((c) => art.get(c.print) ?? c) };
};

const byRarity = (cards: PackCard[]): Pool<PackCard> => {
  const pool: Pool<PackCard> = { N: [], R: [], SR: [], UR: [] };
  for (const c of cards) pool[c.rarity].push(c);
  return pool;
};

/** A pack: buy one or ten with gems (엘리스 10/13 — the server draws them, by the game's guarantees and its UR owed after
 *  ten without one, and keeps none of them), what it holds by rarity, and its 제공 확률 in the game's own words. */
export default function PackDetail() {
  const id = Number(useParams().packId);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [loaded, setPack] = useState<Pack | null>(null);
  const [master, setMaster] = useState<Pack | null>(null);
  const [error, setError] = useState(false);
  const [mine, setMine] = useState<PackMine | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<{ key: number; packs: Pulled<PackCard>[][] } | null>(null);
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
    setMine(null);
    setNotice("");
    getPack(id)
      .then((p) => {
        setPack(p);
        if (p.kind === "secret" && p.master_pack) getPack(p.master_pack).then(setMaster).catch(() => {});
      })
      .catch(() => setError(true));
    getPackMine(id)
      .then((m) => {
        setMine(m);
        if (m.signed_in) setGems(m.gems);
      })
      .catch(() => setMine({ signed_in: isAuthenticated(), gems: 0, tally: NO_TALLY }));
  }, [id]);

  const tally = mine?.tally ?? NO_TALLY;
  const gems = mine?.gems ?? 0;
  // the usual pack, or a campaign's version of it as the list shows it (?v=, 엘리스 10/13)
  const version = loaded?.versions.find((v) => v.id === Number(params.get("v"))) ?? null;
  const pack = useMemo(() => loaded && asSold(loaded, version), [loaded, version]);

  const open = async (count: 1 | 10) => {
    if (!pack || busy) return;
    if (!mine?.signed_in) {
      navigate("/login");
      return;
    }
    if (gems < count * GEMS_PER_PACK) {
      setNotice(`젬이 부족합니다. ${count}팩에 ${(count * GEMS_PER_PACK).toLocaleString()}젬이 필요합니다.`);
      return;
    }
    unlockPackSound();
    setBusy(true);
    setNotice("");
    try {
      const r = await openPack(id, count, version?.id ?? null);
      const packs = r.packs.map((p) => p.map((c) => ({
        card: { print: c.print, card: c.card, name: c.name, rarity: c.rarity, thumb: c.thumb, face: c.face }, rarity: c.rarity, finish: c.finish,
      })));
      setMine({ signed_in: true, gems: r.gems, tally: r.tally });
      setGems(r.gems);
      setRun({ key: Date.now(), packs });
    } catch (e) {
      const err = e as Error & { gems?: number };
      setNotice(err.message || "팩을 열지 못했습니다.");
      if (typeof err.gems === "number") {
        setMine((m) => m && { ...m, gems: err.gems! });
        setGems(err.gems);
      }
    } finally {
      setBusy(false);
    }
  };

  const can = (count: number) => !!pack && !busy && (!mine?.signed_in || gems >= count * GEMS_PER_PACK);
  return (
    <div className="min-h-screen px-4 py-6 md:pb-10 max-w-4xl mx-auto">
      <PackTopBar>
        <PackListLink />
      </PackTopBar>
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
              <p className="h-5 text-sm tabular-nums">
                {mine === null || mine.signed_in ? "" : (
                  <Link to="/login" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">로그인하면 팩을 열 수 있습니다</Link>
                )}
              </p>
              <div className="mt-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" disabled={!can(1)} onClick={() => open(1)}
                        className="h-12 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold">
                  1팩 <span className="text-sm font-semibold opacity-90"><GemIcon /> {GEMS_PER_PACK}</span>
                </button>
                {/* after ten without a UR the next ten owe one, and the button says so in a bright purple, as the game's
                    does (엘리스 10/13); the wording is the game's */}
                <button type="button" disabled={!can(10)} onClick={() => open(10)}
                        className={`h-12 rounded-lg disabled:bg-none disabled:bg-gray-500 text-white font-bold leading-tight ${tally.owed
                          ? "bg-gradient-to-r from-fuchsia-400 via-purple-500 to-violet-600 shadow-[0_0_14px_rgba(232,121,249,.6)]"
                          : "bg-blue-600 hover:bg-blue-700"}`}>
                  10팩 <span className="text-sm font-semibold opacity-90"><GemIcon /> {(GEMS_PER_PACK * 10).toLocaleString()}</span>
                  <span className="block text-[11px] font-semibold opacity-90">
                    {tally.owed ? "10팩이면 UR 1장 확정" : "10팩이면 SR 이상 1장 확정"}
                  </span>
                </button>
              </div>
            </div>
          </div>
          {version && <VersionNote version={version} />}
          <p className="mt-2 min-h-[20px] text-sm text-red-600 dark:text-red-400" role="status">{notice}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm min-h-[24px]">
            {tally.packs > 0 && (
              <>
                <span className="tabular-nums">이 팩에 쓴 <GemIcon /> <b>{tally.gems.toLocaleString()}</b></span>
                <span className="tabular-nums">UR <b>{tally.ur}</b> · SR <b>{tally.sr}</b></span>
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
        <PackOpening key={run.key} pack={pack} packs={run.packs} gems={gems} owed={tally.owed} onClose={() => setRun(null)} onAgain={open}
                     onStage={(st) => { openStage.current = st; }} />
      )}
      {rates && pack && <Rates pack={pack} master={master} onClose={() => setRates(false)} />}
    </div>
  );
}

/** A campaign's version of the pack, a pack of its own in the list (엘리스 10/13): the days it was sold, and the cards that
 *  came in their campaign art then. */
function VersionNote({ version }: { version: PackVersion }) {
  return (
    <section className="mt-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3" aria-label="판매 시기">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 tabular-nums">{version.start} ~ {version.end} 판매분</p>
      <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80 break-keep">이때는 아래 카드가 다른 일러스트·오버프레임으로 나왔습니다.</p>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {version.arts.map((c) => (
          <li key={c.print} className="shrink-0 w-16 sm:w-20">
            <Link to={`/cards/${c.card}`} title={c.name} className="block">
              <img src={c.thumb} alt={c.name} loading="lazy" className="w-full aspect-[704/1024] rounded object-cover shadow" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
      {/* four even tabs, each its badge and count side by side in the middle (엘리스 10/13: the badge took the middle and
          the count was pushed to the edge); the badge picture's clear left edge is pulled in */}
      <div role="tablist" aria-label="레어도" className="mt-3 grid grid-cols-4 gap-1.5 sm:w-[26rem]">
        {RARITIES.map((r) => (
          <button key={r} role="tab" aria-selected={tab === r} disabled={!pool[r].length}
                  onClick={() => { setTab(r); setLimit(STEP); }}
                  className={`h-9 min-w-0 px-1 rounded-lg inline-flex items-center justify-center gap-1 text-[13px] font-semibold tabular-nums transition disabled:opacity-40 ${
                    tab === r ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
            <img src={`/media/md_ui/rarity_${r.toLowerCase()}_hd.png`} alt={r} className="h-3.5 w-auto -ml-1.5 shrink-0" />
            <span>{pool[r].length.toLocaleString()}</span>
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
