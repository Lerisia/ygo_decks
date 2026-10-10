import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { isAdmin } from "@/api/accountApi";
import { getMetaDeckStats, type MetaDeckStat, type SheetSummary } from "@/api/toolApi";
import { BarStat, CoinSplit, ColumnChart, MeterBar, RankCurve, ResultChips, StatRadar, UsagePie, RANK_SHORT_LABELS, rankToNumeric, type CurvePoint } from "@/components/charts";
import { RANK_ORDER } from "@/utils/rankUtils";

const SAMPLE_META: MetaDeckStat[] = [
  { meta_deck_id: -11, meta_deck_name: "예시 덱 1", appearance_percent: 18.4, win_rate: 54.2 },
  { meta_deck_id: -12, meta_deck_name: "예시 덱 2", appearance_percent: 12.1, win_rate: 51.8 },
  { meta_deck_id: -13, meta_deck_name: "예시 덱 3", appearance_percent: 9.7, win_rate: 49.5 },
  { meta_deck_id: -14, meta_deck_name: "예시 덱 4", appearance_percent: 7.3, win_rate: 52.6, is_upcoming: true },
  { meta_deck_id: -15, meta_deck_name: "예시 덱 5", appearance_percent: 6.2, win_rate: 47.1 },
  { meta_deck_id: -16, meta_deck_name: "예시 덱 6", appearance_percent: 4.8, win_rate: 50.3 },
  { meta_deck_id: -17, meta_deck_name: "예시 덱 7", appearance_percent: 3.9, win_rate: 45.9 },
  { meta_deck_id: -18, meta_deck_name: "예시 덱 8", appearance_percent: 2.6, win_rate: 55.4 },
  { meta_deck_id: -19, meta_deck_name: "예시 덱 9", appearance_percent: 1.9, win_rate: 48.0 },
  { meta_deck_id: -20, meta_deck_name: "예시 덱 10", appearance_percent: 1.2, win_rate: 51.1 },
];

const RANK_PATH: [string, number][] = [];
{
  let idx = RANK_ORDER.indexOf("gold5");
  let wins = 0;
  const steps = [1, 1, -1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1, 1, -1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, 1, -1, 1];
  for (const s of steps) {
    wins += s;
    if (wins >= 5) { idx += 1; wins = 0; }
    if (wins < 0) { wins = 0; }
    RANK_PATH.push([RANK_ORDER[idx], wins]);
  }
}
const RANK_SAMPLE: CurvePoint[] = RANK_PATH.map(([rank, wins], i) => ({
  index: i + 1,
  value: rankToNumeric(rank, wins),
  label: `${RANK_SHORT_LABELS[rank]} · ${wins}승`,
}));
const SCORE_SAMPLE: CurvePoint[] = Array.from({ length: 30 }, (_, i) => {
  const v = 1500 + Math.round(Math.sin(i / 3) * 40 + i * 6);
  return { index: i + 1, value: v, label: `${v}점` };
});

const DAILY_SAMPLE = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(2026, 8, 27 + i);
  return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, visitors: 380 + ((i * 137) % 420) };
});

const RECENT_SAMPLE: SheetSummary["recent"] = Array.from({ length: 17 }, (_, i) => ({
  r: [0, 2, 3, 5, 8, 9, 12, 15].includes(i) ? "lose" : "win",
  fs: i % 3 === 0 ? "second" : "first",
  coin: i % 2 === 0 ? "win" : "lose",
}));

function Pair({ title, file, children }: { title: string; file: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-base font-bold">{title}</h2>
        <code className="text-xs text-gray-500 dark:text-gray-400">{file}</code>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 min-w-0">
          <p className="text-xs text-gray-400 mb-2">낮</p>
          {children}
        </div>
        <div className="dark">
          <div className="rounded-xl border border-gray-700 bg-gray-800 text-gray-100 p-4 min-w-0 h-full">
            <p className="text-xs text-gray-400 mb-2">밤</p>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AdminCharts() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<MetaDeckStat[]>(SAMPLE_META);
  const [live, setLive] = useState(false);

  useEffect(() => {
    isAdmin().then((ok) => { if (!ok) navigate("/"); }).catch(() => navigate("/"));
  }, [navigate]);

  useEffect(() => {
    getMetaDeckStats()
      .then((d) => {
        if (d.meta_decks?.length) {
          setMeta(d.meta_decks);
          setLive(true);
        }
      })
      .catch(() => {});
  }, []);

  const covers: Record<number, string> = {};
  for (const d of meta) if (d.cover_image_small) covers[d.meta_deck_id] = d.cover_image_small;

  return (
    <div className="min-h-screen px-4 py-6 max-w-6xl mx-auto flex flex-col gap-8 tabular-nums">
      <div>
        <button onClick={() => navigate("/manage")} className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline">← 관리</button>
        <h1 className="text-xl font-bold">📊 그래프 견본</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          사이트에서 쓰는 그래프를 한곳에 모았습니다. 모두 components/charts에서 가져온 것이라 여기서 보이는 모습이 실제 화면과 같습니다.
          낮 칸은 사이트를 낮 모드로 둘 때 제대로 보입니다.
        </p>
      </div>

      <Pair title={`덱 사용률 파이 · ${live ? "실제 최근 데이터" : "예시 데이터"}`} file="Pie.tsx · UsagePie">
        <UsagePie data={meta.slice(0, 10)} deckCovers={covers} showUpdateKey={meta.slice(0, 10).some((d) => d.is_upcoming)} />
      </Pair>

      <Pair title="랭크 곡선" file="Curve.tsx · RankCurve">
        <RankCurve data={RANK_SAMPLE} mode="rank" />
      </Pair>

      <Pair title="점수 곡선" file="Curve.tsx · RankCurve">
        <RankCurve data={SCORE_SAMPLE} mode="score" />
      </Pair>

      <Pair title="덱 스탯 레이더 (11 = ?)" file="Radar.tsx · StatRadar">
        <StatRadar stats={{ consistency: 7, breakthrough: 8, deck_space: 5, recovery: 6, interruption: 11 }} height={300} />
      </Pair>

      <Pair title="덱 스탯 레이더 · 정보 없음" file="Radar.tsx · StatRadar">
        <StatRadar stats={null} height={300} />
      </Pair>

      <Pair title="세로 막대" file="Columns.tsx · ColumnChart">
        <ColumnChart data={DAILY_SAMPLE} xKey="date" yKey="visitors" valueName="방문자" xTick={(d) => d.slice(5)} />
      </Pair>

      <Pair title="승률 막대 · 비율 막대" file="Bar.tsx · BarStat, MeterBar">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <BarStat label="선공 승률" value={62} sub="50판" />
            <BarStat label="후공 승률" value={38.5} sub="44판" />
          </div>
          <BarStat label="기록 없음" value={null} />
          <div className="flex items-center gap-2 text-[13px]">
            <span className="w-24 shrink-0">예시 덱</span>
            <MeterBar value={45} className="flex-1" />
            <b className="w-10 text-right">45판</b>
          </div>
        </div>
      </Pair>

      <Pair title="코인토스별 승률" file="CoinSplit.tsx · CoinSplit">
        <CoinSplit winGames={48} winWins={30} loseGames={46} loseWins={19} />
      </Pair>

      <Pair title="최근 결과 칩" file="Chips.tsx · ResultChips">
        <div className="flex flex-col gap-3">
          <ResultChips recent={RECENT_SAMPLE} />
          <ResultChips recent={RECENT_SAMPLE} small slots={10} />
        </div>
      </Pair>
    </div>
  );
}
