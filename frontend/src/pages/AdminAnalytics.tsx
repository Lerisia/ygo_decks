import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isAdmin } from "@/api/accountApi";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/api/analyticsApi";

const fmtDuration = (sec: number) => {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분 ${sec % 60}초`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
};

const StatTile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="bg-gray-50 dark:bg-gray-700/60 rounded-lg p-3 md:p-4 text-center">
    <div className="text-xs md:text-sm text-gray-500 dark:text-gray-400">{label}</div>
    <div className="text-xl md:text-2xl font-bold mt-1">{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    isAdmin().then((ok) => { if (!ok) navigate("/"); }).catch(() => navigate("/"));
  }, [navigate]);

  useEffect(() => {
    setError("");
    getAnalyticsSummary(days).then(setData).catch((e) => setError(e.message));
  }, [days]);

  const rangeTotals = data
    ? data.daily.reduce((acc, d) => ({ views: acc.views + d.views, dwell: acc.dwell + d.dwell_sec }), { views: 0, dwell: 0 })
    : null;

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-3xl mx-auto">
      <button onClick={() => navigate("/manage")} className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0">← 관리</button>
      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-4 sm:p-5">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h1 className="text-xl font-bold">📈 사이트 통계</h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            {[7, 14, 30, 90].map((n) => <option key={n} value={n}>최근 {n}일</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
        {!data ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">불러오는 중...</p>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">오늘</h2>
              <div className="grid grid-cols-3 gap-2 md:gap-3">
                <StatTile label="방문자" value={data.today.visitors.toLocaleString()} sub="고유 방문자" />
                <StatTile label="페이지뷰" value={data.today.views.toLocaleString()} />
                <StatTile label="총 체류 시간" value={fmtDuration(data.today.dwell_sec)} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                최근 {data.range_days}일 방문자 추이
                {rangeTotals && (
                  <span className="ml-2 normal-case font-normal">· 페이지뷰 {rangeTotals.views.toLocaleString()} · 체류 {fmtDuration(rangeTotals.dwell)}</span>
                )}
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => [v.toLocaleString(), "방문자"]}
                    labelFormatter={(d) => String(d)}
                    contentStyle={{ fontSize: "0.8rem" }}
                  />
                  <Bar dataKey="visitors" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">일별 상세</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b dark:border-gray-700 text-gray-500 dark:text-gray-400">
                      <th className="text-left px-2 pb-1">날짜</th>
                      <th className="text-right px-2 pb-1">방문자</th>
                      <th className="text-right px-2 pb-1">페이지뷰</th>
                      <th className="text-right px-2 pb-1">총 체류</th>
                      <th className="text-right px-2 pb-1">평균 체류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-b dark:border-gray-700/60">
                        <td className="px-2 py-1.5">{d.date}</td>
                        <td className="text-right px-2 py-1.5">{d.visitors.toLocaleString()}</td>
                        <td className="text-right px-2 py-1.5">{d.views.toLocaleString()}</td>
                        <td className="text-right px-2 py-1.5">{fmtDuration(d.dwell_sec)}</td>
                        <td className="text-right px-2 py-1.5">{fmtDuration(d.avg_dwell_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">많이 본 페이지 (최근 {data.range_days}일)</h2>
              {data.top_pages.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">아직 데이터가 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-gray-700 text-gray-500 dark:text-gray-400">
                      <th className="text-left px-2 pb-1">경로</th>
                      <th className="text-right px-2 pb-1 w-[18%]">페이지뷰</th>
                      <th className="text-right px-2 pb-1 w-[18%]">방문자</th>
                      <th className="text-right px-2 pb-1 w-[22%]">총 체류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_pages.map((p) => (
                      <tr key={p.path} className="border-b dark:border-gray-700/60">
                        <td className="px-2 py-1.5 font-mono text-xs truncate max-w-0">{p.path}</td>
                        <td className="text-right px-2 py-1.5">{p.views.toLocaleString()}</td>
                        <td className="text-right px-2 py-1.5">{p.visitors.toLocaleString()}</td>
                        <td className="text-right px-2 py-1.5">{fmtDuration(p.dwell_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <p className="text-xs text-gray-400">방문자는 브라우저별 익명 ID 기준(개인정보 없음). 체류 시간은 탭이 보이는 동안만 집계되며 페이지당 최대 30분.</p>
          </div>
        )}
      </div>
    </div>
  );
}
