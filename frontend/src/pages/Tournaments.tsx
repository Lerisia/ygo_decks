import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTournaments, type TournamentListItem } from "@/api/tournamentApi";

const FORMAT_LABELS: Record<string, string> = {
  single_elim: "싱글 엘리미네이션",
  swiss: "스위스",
  round_robin: "라운드 로빈",
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  recruiting: { label: "모집 중", cls: "text-blue-500" },
  ongoing: { label: "진행 중", cls: "text-green-500" },
  completed: { label: "종료", cls: "text-gray-500 dark:text-gray-400" },
};

function Tournaments() {
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const navigate = useNavigate();
  const loggedIn = !!localStorage.getItem("access_token");

  useEffect(() => {
    listTournaments().then(setTournaments).catch(console.error);
  }, []);

  return (
    <div className="px-4 py-6 min-h-screen max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">대회 목록</h1>
        {loggedIn && (
          <button
            onClick={() => navigate("/tournaments/create")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            대회 생성
          </button>
        )}
      </div>
      {tournaments.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400">등록된 대회가 없습니다.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tournaments.map((t) => {
          const st = STATUS_LABELS[t.status] || STATUS_LABELS.recruiting;
          return (
            <div
              key={t.id}
              className="border dark:border-gray-700 rounded-lg p-4 shadow cursor-pointer hover:shadow-lg transition bg-white dark:bg-gray-800"
              onClick={() => navigate(`/tournaments/${t.id}`)}
            >
              {t.cover_image && (
                <img src={t.cover_image} alt={t.name} className="w-full h-40 object-cover mb-2 rounded" />
              )}
              <h2 className="text-lg font-semibold">{t.name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {FORMAT_LABELS[t.format]} · {t.entrant_count}/{t.capacity}명 · 주최 {t.host_name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                일시: {new Date(t.event_date).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className={`text-sm font-semibold ${st.cls}`}>{st.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Tournaments;
