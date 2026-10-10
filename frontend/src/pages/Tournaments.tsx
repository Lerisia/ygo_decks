import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTournaments, type TournamentListItem } from "@/api/tournamentApi";

const FORMAT_LABELS: Record<string, string> = {
  single_elim: "싱글 엘리미네이션",
  swiss: "스위스",
  round_robin: "라운드 로빈",
  swiss_cut: "스위스+결선",
  group_knockout: "조별+결선",
  double_elim: "더블 엘리미네이션",
};

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  recruiting: { label: "모집 중", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300" },
  ongoing: { label: "진행 중", cls: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300" },
  completed: { label: "종료", cls: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
};

const TABS = [
  { key: "all", label: "전체" },
  { key: "recruiting", label: "모집 중" },
  { key: "ongoing", label: "진행 중" },
  { key: "completed", label: "종료" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Tournaments() {
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  // "참여자로 참가하기" opens on the tournaments still taking entrants.
  const [tab, setTab] = useState<TabKey>("recruiting");
  const navigate = useNavigate();
  const loggedIn = !!localStorage.getItem("access_token");

  useEffect(() => {
    listTournaments().then(setTournaments).catch(console.error);
  }, []);

  return (
    <div className="px-4 py-6 min-h-screen max-w-5xl mx-auto">
      <button onClick={() => navigate("/tournaments")} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-2">← 대회</button>
      <div className="flex justify-between items-center mb-1">
        <h1 className="text-2xl font-bold">🙋 참여자로 참가하기</h1>
        {loggedIn && (
          <button
            onClick={() => navigate("/tournaments/create")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            대회 개최하기
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">🔒 표시가 있는 대회는 주최자에게 받은 비밀번호가 있어야 참가할 수 있습니다.</p>
      {!loggedIn && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">대회는 로그인한 회원만 참가할 수 있습니다.</p>
      )}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(({ key, label }) => {
          const count = key === "all" ? tournaments.length : tournaments.filter((t) => t.status === key).length;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-sm rounded-full font-semibold transition ${
                tab === key
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {label} {count > 0 && <span className="opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>
      {(() => {
        const visible = tab === "all" ? tournaments : tournaments.filter((t) => t.status === tab);
        if (visible.length === 0) {
          return <p className="text-gray-500 dark:text-gray-400">해당 상태의 대회가 없습니다.</p>;
        }
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((t) => {
              const badge = STATUS_BADGES[t.status] || STATUS_BADGES.recruiting;
              return (
                <div
                  key={t.id}
                  className="relative border dark:border-gray-700 rounded-lg p-4 shadow cursor-pointer hover:shadow-lg transition bg-white dark:bg-gray-800"
                  onClick={() => navigate(`/tournaments/${t.id}`)}
                >
                  <span className={`absolute top-2 right-2 z-10 text-xs font-semibold px-2 py-1 rounded-full shadow ${badge.cls}`}>
                    {badge.label}{t.status === "ongoing" ? ` · ${t.current_round}R` : ""}
                  </span>
                  {t.cover_image && (
                    <img src={t.cover_image} alt={t.name} className="w-full h-40 object-cover mb-2 rounded" />
                  )}
                  <h2 className="text-lg font-semibold pr-16">
                    {t.has_password && <span className="mr-1" title="비밀번호가 필요한 대회">🔒</span>}
                    {t.name}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {FORMAT_LABELS[t.format]}{t.team_size > 1 ? ` · ${t.team_size}인 팀전` : ""} · {t.entrant_count}/{t.capacity}{t.team_size > 1 ? "팀" : "명"} · 주최 {t.host_name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    일시: {new Date(t.event_date).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

export default Tournaments;
