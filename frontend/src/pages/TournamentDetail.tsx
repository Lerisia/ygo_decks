import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/Avatar";
import { getUserInfo } from "@/api/accountApi";
import {
  checkInTournament, completeTournament, confirmMatch, disputeMatch, getStandings,
  getTournament, kickEntrant, nextRound, overrideMatch, registerTournament,
  reportMatch, startTournament, updateCover, withdrawTournament,
  type Entrant, type MatchItem, type StandingRow, type TournamentDetail as TDetail,
} from "@/api/tournamentApi";

const FORMAT_LABELS: Record<string, string> = {
  single_elim: "싱글 엘리미네이션", swiss: "스위스", round_robin: "라운드 로빈",
};
const STATUS_LABELS: Record<string, string> = {
  recruiting: "모집 중", ongoing: "진행 중", completed: "종료",
};
const btn = "px-3 py-1.5 text-sm rounded-lg font-semibold transition disabled:opacity-50";
const blueBtn = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const grayBtn = `${btn} bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`;
const redBtn = `${btn} bg-red-500 text-white hover:bg-red-600`;

function EntrantChip({ e, size = 40 }: { e: Entrant; size?: number }) {
  const dimmed = e.status === "withdrawn" || e.status === "kicked";
  return (
    <div className={`flex items-center gap-2 min-w-0 ${dimmed ? "opacity-40" : ""}`}>
      <div className="relative shrink-0">
        <Avatar icon={e.avatar_icon} border={e.border} size={size} />
        {e.status === "checked_in" && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900" />
        )}
      </div>
      <span className={`truncate text-sm font-medium ${dimmed ? "line-through" : ""}`}>{e.name}</span>
    </div>
  );
}

function TournamentDetailPage() {
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<TDetail | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [tab, setTab] = useState<"players" | "bracket" | null>(null);
  const [uidInput, setUidInput] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    if (!tournamentId) return;
    getTournament(Number(tournamentId)).then(setT).catch((e) => setError(e.message));
    getStandings(Number(tournamentId)).then(setStandings).catch(() => {});
  }, [tournamentId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (localStorage.getItem("access_token")) {
      getUserInfo().then((info: { username: string }) => setMe(info.username)).catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (t && tab === null) {
      setTab(t.status === "ongoing" ? "bracket" : "players");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (t?.status !== "ongoing") return;
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [t?.status, refresh]);

  if (!t) return <div className="p-6">{error ? `오류: ${error}` : "로딩 중..."}</div>;

  const isHost = me !== null && t.host_name === me;
  const myEntrant = me !== null ? t.entrants.find((e) => e.name === me) : undefined;
  const myUserId = myEntrant?.user ?? null;
  const activeEntrants = t.entrants.filter((e) => e.status === "registered" || e.status === "checked_in");
  const uidByEntrant = new Map(t.entrants.map((e) => [e.id, e.md_uid]));
  const tabClass = (k: "players" | "bracket") =>
    `px-4 py-2 font-semibold ${tab === k ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 dark:text-gray-400"}`;

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
  };

  const myRole = (m: MatchItem): "p1" | "p2" | null =>
    myUserId === null ? null : m.entrant1.user === myUserId ? "p1" : m.entrant2?.user === myUserId ? "p2" : null;

  const resultText = (m: MatchItem) => {
    if (m.result === "bye") return "부전승";
    if (!m.result) return "대기 중";
    if (m.result === "draw") return "무승부";
    const winner = m.result === "p1" ? m.entrant1 : m.entrant2;
    return `${winner?.name} 승`;
  };

  const renderMatch = (m: MatchItem) => {
    const role = myRole(m);
    const confirmed = m.report_status === "confirmed";
    const canRespond = role && m.report_status === "reported" && m.reported_by !== myUserId;
    const canReport = role && !confirmed && (m.report_status === "pending" || m.reported_by === myUserId || m.report_status === "disputed");
    return (
      <div key={m.id} className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between gap-2">
          <EntrantChip e={m.entrant1} size={36} />
          <span className="text-xs text-gray-400 shrink-0">VS</span>
          {m.entrant2 ? <EntrantChip e={m.entrant2} size={36} /> : <span className="text-sm text-gray-400">부전승</span>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${confirmed ? "text-green-600 dark:text-green-400" : m.report_status === "disputed" ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}>
            {resultText(m)}
            {m.report_status === "reported" && " (확인 대기)"}
            {m.report_status === "disputed" && " (이의 제기됨)"}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {canReport && (
              <>
                <button className={blueBtn} onClick={() => act(() => reportMatch(m.id, "win"))}>승리 보고</button>
                <button className={grayBtn} onClick={() => act(() => reportMatch(m.id, "lose"))}>패배 보고</button>
                {t.format !== "single_elim" && (
                  <button className={grayBtn} onClick={() => act(() => reportMatch(m.id, "draw"))}>무승부</button>
                )}
              </>
            )}
            {canRespond && (
              <>
                <button className={blueBtn} onClick={() => act(() => confirmMatch(m.id))}>결과 확인</button>
                <button className={redBtn} onClick={() => act(() => disputeMatch(m.id))}>이의 제기</button>
              </>
            )}
            {isHost && !confirmed && m.entrant2 && (
              <>
                <button className={grayBtn} onClick={() => act(() => overrideMatch(m.id, "p1"))}>{m.entrant1.name} 승 (강제)</button>
                <button className={grayBtn} onClick={() => act(() => overrideMatch(m.id, "p2"))}>{m.entrant2.name} 승 (강제)</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 py-6 min-h-screen max-w-3xl mx-auto">
      <button onClick={() => navigate("/tournaments")} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-2">← 대회 목록</button>

      {t.cover_image && (
        <img src={t.cover_image} alt={t.name} className="w-full max-h-64 object-cover rounded-xl mb-3" />
      )}
      {isHost && (
        <div className="flex gap-2 mb-3 text-xs">
          <label className="cursor-pointer text-blue-600 hover:underline">
            배너 {t.cover_image ? "변경" : "등록"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) {
                  setError("배너 이미지는 5MB 이하여야 합니다.");
                  e.target.value = "";
                  return;
                }
                act(() => updateCover(t.id, f));
              }}
            />
          </label>
          {t.cover_image && (
            <button className="text-red-500 hover:underline" onClick={() => act(() => updateCover(t.id, null))}>배너 제거</button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-2xl font-bold truncate">{t.name}</h1>
        <span className={`shrink-0 text-sm font-semibold px-2 py-1 rounded-full ${
          t.status === "ongoing" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : t.status === "completed" ? "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
          {STATUS_LABELS[t.status] || t.status}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
        <Avatar icon={t.host_avatar_icon} border={t.host_border} size={22} />
        <span>주최 {t.host_name}</span>
        <span>· {FORMAT_LABELS[t.format]}{t.status === "ongoing" ? ` · ${t.current_round}라운드` : ""}</span>
        <span>· {new Date(t.event_date).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {t.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-3">{t.description}</p>}
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {/* 참가/운영 액션 */}
      <div className="flex gap-2 flex-wrap mb-6">
        {t.status === "recruiting" && me && !myEntrant && (
          <div className="flex gap-2 items-center">
            <input
              className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white w-56"
              placeholder="MD UID 9자리 (저장돼 있으면 생략)"
              value={uidInput}
              maxLength={9}
              onChange={(e) => setUidInput(e.target.value.replace(/\D/g, ""))}
            />
            <button className={blueBtn} onClick={() => act(() => registerTournament(t.id, uidInput || undefined))}>참가 신청</button>
          </div>
        )}
        {t.status === "recruiting" && myEntrant?.status === "registered" && (
          <button className={blueBtn} onClick={() => act(() => checkInTournament(t.id))}>체크인</button>
        )}
        {t.status === "recruiting" && myEntrant && (myEntrant.status === "registered" || myEntrant.status === "checked_in") && (
          <button className={grayBtn} onClick={() => act(() => withdrawTournament(t.id))}>기권</button>
        )}
        {isHost && t.status === "recruiting" && (
          <button className={blueBtn} onClick={() => act(() => startTournament(t.id))}>대회 시작</button>
        )}
        {isHost && t.status === "ongoing" && (
          <>
            <button className={blueBtn} onClick={() => act(() => nextRound(t.id))}>다음 라운드</button>
            <button className={grayBtn} onClick={() => act(() => completeTournament(t.id))}>대회 종료</button>
          </>
        )}
      </div>

      {/* 탭: 참가자(=순위) / 대진표 */}
      <div className="flex justify-center gap-4 mb-4 border-b dark:border-gray-700 pb-2">
        <button onClick={() => setTab("players")} className={tabClass("players")}>
          참가자 {activeEntrants.length}/{t.capacity}
        </button>
        <button onClick={() => setTab("bracket")} className={tabClass("bracket")}>대진표</button>
      </div>

      {tab === "players" && t.status === "recruiting" && (
        <section>
          {t.entrants.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">아직 참가자가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {t.entrants.map((e) => (
                <div key={e.id} className="flex items-center justify-between border dark:border-gray-700 rounded-lg px-2.5 py-2 bg-white dark:bg-gray-800">
                  <EntrantChip e={e} />
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {e.md_uid && <span className="text-[11px] text-gray-400 font-mono">{e.md_uid}</span>}
                    {isHost && e.status !== "kicked" && e.status !== "withdrawn" && (
                      <button className="text-xs text-red-500 hover:underline" onClick={() => act(() => kickEntrant(t.id, e.id))}>추방</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "players" && t.status !== "recruiting" && (
        <section>
          {standings.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">순위 정보가 없습니다.</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  <th className="text-left px-1.5 sm:px-2 pb-1 w-[8%]">#</th>
                  <th className="text-left px-1.5 sm:px-2 pb-1 w-[45%]">참가자</th>
                  <th className="text-right px-1.5 sm:px-2 pb-1 w-[14%]">승-패</th>
                  <th className="text-right px-1.5 sm:px-2 pb-1 w-[13%]">승점</th>
                  <th className="text-right px-1.5 sm:px-2 pb-1 w-[20%]">부흐홀츠</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => (
                  <tr key={row.entrant_id} className="border-b dark:border-gray-700/60">
                    <td className="px-2 py-1.5">{i < 3 && t.status === "completed" ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar icon={row.avatar_icon} border={row.border} size={28} />
                        <div className="min-w-0">
                          <div className="truncate">{row.name}</div>
                          {uidByEntrant.get(row.entrant_id) && (
                            <div className="text-[11px] text-gray-400 font-mono">{uidByEntrant.get(row.entrant_id)}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-right px-2 py-1.5 whitespace-nowrap">
                      {row.draws > 0 ? `${row.wins}-${row.draws}-${row.losses}` : `${row.wins}-${row.losses}`}
                    </td>
                    <td className="text-right px-2 py-1.5 font-semibold">{row.points}</td>
                    <td className="text-right px-2 py-1.5">{row.buchholz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "bracket" && (
        <section>
          {t.rounds.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">대회가 시작되면 대진표가 생성됩니다.</p>
          ) : (
            <div className="space-y-4">
              {[...t.rounds].sort((a, b) => b.number - a.number).map((r) => (
                <div key={r.number}>
                  <h3 className="font-semibold mb-2">
                    {r.number}라운드 {r.status === "completed" ? <span className="text-xs text-gray-400">(완료)</span> : null}
                  </h3>
                  <div className="space-y-2">
                    {[...r.matches].sort((a, b) => a.bracket_pos - b.bracket_pos).map(renderMatch)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

    </div>
  );
}

export default TournamentDetailPage;
