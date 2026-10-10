import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/Avatar";
import BracketTree, { ColumnBracket } from "@/components/tournament/BracketTree";
import TeamAvatars from "@/components/tournament/TeamAvatars";
import DeckTab from "@/components/tournament/DeckTab";
import JoinForm from "@/components/tournament/JoinForm";
import AnnouncementsTab from "@/components/tournament/AnnouncementsTab";
import ChatTab from "@/components/tournament/ChatTab";
import { getUserInfo } from "@/api/accountApi";
import {
  cancelTournament, checkInTournament, completeTournament, confirmBoard, confirmMatch, disputeBoard, disputeMatch, getStandings,
  getTournament, joinTeam, kickEntrant, leaveTeam, nextRound, overrideBoard, overrideMatch, registerTournament,
  reportBoard, reportMatch, setLineup, setTeamOrder, startTournament, updateCover, updateTournament, withdrawTournament,
  GROUP_LABEL, type Board, type Entrant, type MatchItem, type StandingRow, type TournamentDetail as TDetail,
} from "@/api/tournamentApi";

const FORMAT_LABELS: Record<string, string> = {
  single_elim: "싱글 엘리미네이션", swiss: "스위스", round_robin: "라운드 로빈", swiss_cut: "스위스+결선",
  group_knockout: "조별+결선", double_elim: "더블 엘리미네이션",
};
const BRACKET_LABELS: Record<string, string> = { winners: "승자조", losers: "패자조", final: "최종전" };
const STATUS_LABELS: Record<string, string> = {
  recruiting: "모집 중", ongoing: "진행 중", completed: "종료", cancelled: "취소됨",
};
const inputCls = "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const btn = "px-3 py-1.5 text-sm rounded-lg font-semibold transition disabled:opacity-50";
const blueBtn = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const grayBtn = `${btn} bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`;
const redBtn = `${btn} bg-red-500 text-white hover:bg-red-600`;

function EntrantChip({ e, size = 40 }: { e: Entrant; size?: number }) {
  const dimmed = e.status === "withdrawn" || e.status === "kicked";
  const isTeam = e.user === null;
  return (
    <div className={`flex items-center gap-2 min-w-0 ${dimmed ? "opacity-40" : ""}`}>
      <div className="relative shrink-0">
        {isTeam ? <TeamAvatars members={e.members} size={Math.round(size * 0.7)} max={3} /> : <Avatar icon={e.avatar_icon} border={e.border} size={size} />}
        {e.status === "checked_in" && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900" />
        )}
      </div>
      <span className={`truncate text-sm font-medium ${dimmed ? "line-through" : ""}`}>{e.name}</span>
    </div>
  );
}

function MemberChip({ m, size = 28 }: { m: { name: string; avatar_icon: Entrant["avatar_icon"]; border: Entrant["border"]; is_captain?: boolean } | null; size?: number }) {
  if (!m) return <span className="text-xs text-gray-400">미배정</span>;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar icon={m.avatar_icon} border={m.border} size={size} />
      <span className="truncate text-sm">{m.name}{m.is_captain && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">팀장</span>}</span>
    </div>
  );
}

function TournamentDetailPage() {
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<TDetail | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [tab, setTab] = useState<"players" | "bracket" | "deck" | "notice" | "chat" | null>(null);
  const [uidInput, setUidInput] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: "", description: "", event_date: "", capacity: "" });

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
  const teamMode = t.team_size > 1;
  const myEntrant = me !== null
    ? t.entrants.find((e) => (e.user !== null ? e.name === me : e.members.some((m) => m.name === me)))
    : undefined;
  const myMember = myEntrant?.members.find((m) => m.name === me);
  const myUserId = myEntrant?.user ?? myMember?.user ?? null;
  const isCaptain = !!myMember?.is_captain;
  const entrantLabel = teamMode ? "팀" : "명";
  const activeEntrants = t.entrants.filter((e) => e.status === "registered" || e.status === "checked_in");
  const uidByEntrant = new Map(t.entrants.map((e) => [e.id, e.md_uid]));
  const tabClass = (k: "players" | "bracket" | "deck" | "notice" | "chat") =>
    `px-3 sm:px-4 py-2 font-semibold whitespace-nowrap ${tab === k ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 dark:text-gray-400"}`;

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
  };

  const sideOf = (e: Entrant | null): boolean =>
    !!e && myUserId !== null && (e.user === myUserId || e.members.some((mm) => mm.user === myUserId));
  const myRole = (m: MatchItem): "p1" | "p2" | null =>
    sideOf(m.entrant1) ? "p1" : sideOf(m.entrant2) ? "p2" : null;

  const resultText = (m: MatchItem) => {
    if (m.result === "bye") return "부전승";
    if (!m.result) return "대기 중";
    if (m.result === "draw") return "무승부";
    const winner = m.result === "p1" ? m.entrant1 : m.entrant2;
    return `${winner?.name} 승`;
  };

  const renderBoard = (m: MatchItem, b: Board) => {
    const mine = b.member1?.user === myUserId ? "p1" : b.member2?.user === myUserId ? "p2" : null;
    const decided = b.report_status === "confirmed";
    const canReport = mine && !decided && m.report_status !== "confirmed" && (b.report_status === "pending" || b.reported_by === myUserId || b.report_status === "disputed");
    const canRespond = mine && b.report_status === "reported" && b.reported_by !== myUserId;
    const text = !b.result ? "대기 중" : `${(b.result === "p1" ? b.member1 : b.member2)?.name ?? "?"} 승`;
    return (
      <div key={b.id} className="flex items-center justify-between gap-2 flex-wrap rounded-md bg-gray-50 dark:bg-gray-900/40 px-2 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] text-gray-400 w-6 shrink-0">{b.order + 1}번</span>
          <div className={b.result && b.result !== "p1" && decided ? "opacity-40" : ""}><MemberChip m={b.member1} size={24} /></div>
          <span className="text-[10px] text-gray-400">vs</span>
          <div className={b.result && b.result !== "p2" && decided ? "opacity-40" : ""}><MemberChip m={b.member2} size={24} /></div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-semibold ${decided ? "text-green-600 dark:text-green-400" : b.report_status === "disputed" ? "text-red-500" : "text-gray-500 dark:text-gray-400"}`}>
            {text}{b.report_status === "reported" && " (확인 대기)"}{b.report_status === "disputed" && " (이의)"}
          </span>
          {canReport && (
            <>
              <button className={`${blueBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => reportBoard(b.id, "win"))}>승리</button>
              <button className={`${grayBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => reportBoard(b.id, "lose"))}>패배</button>
            </>
          )}
          {canRespond && (
            <>
              <button className={`${blueBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => confirmBoard(b.id))}>확인</button>
              <button className={`${redBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => disputeBoard(b.id))}>이의</button>
            </>
          )}
          {isHost && !decided && b.member1 && b.member2 && (
            <>
              <button className={`${grayBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => overrideBoard(b.id, "p1"))}>{b.member1.name} 승</button>
              <button className={`${grayBtn} !px-2 !py-1 !text-xs`} onClick={() => act(() => overrideBoard(b.id, "p2"))}>{b.member2.name} 승</button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderLineup = (m: MatchItem) => {
    // captain reorders their own side until any board is reported
    const side = myEntrant && m.entrant1.id === myEntrant.id ? "member1" : myEntrant && m.entrant2?.id === myEntrant.id ? "member2" : null;
    if (!side || !isCaptain || m.report_status === "confirmed" || m.boards.some((b) => b.report_status !== "pending")) return null;
    const ids = [...m.boards].sort((a, b) => a.order - b.order).map((b) => b[side]?.id).filter((x): x is number => x !== undefined);
    const move = (i: number, d: -1 | 1) => {
      const next = [...ids];
      const j = i + d;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      act(() => setLineup(m.id, next));
    };
    return (
      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
        <span>출전 순서(팀장):</span>
        {ids.map((id, i) => {
          const mem = myEntrant!.members.find((x) => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-0.5 rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5">
              {i + 1}. {mem?.name}
              <button className="px-0.5 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">▲</button>
              <button className="px-0.5 disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label="아래로">▼</button>
            </span>
          );
        })}
      </div>
    );
  };

  const renderMatch = (m: MatchItem, allowDraw: boolean) => {
    const role = myRole(m);
    const confirmed = m.report_status === "confirmed";
    const canRespond = !teamMode && role && m.report_status === "reported" && m.reported_by !== myUserId;
    const canReport = !teamMode && role && !confirmed && (m.report_status === "pending" || m.reported_by === myUserId || m.report_status === "disputed");
    const boardScore = teamMode && m.boards.length > 0
      ? `${m.boards.filter((b) => b.report_status === "confirmed" && b.result === "p1").length} : ${m.boards.filter((b) => b.report_status === "confirmed" && b.result === "p2").length}`
      : null;
    return (
      <div key={m.id} className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
        {m.bracket && <div className="text-[11px] font-semibold text-gray-400 mb-1">{BRACKET_LABELS[m.bracket]}</div>}
        <div className="flex items-center justify-between gap-2">
          <EntrantChip e={m.entrant1} size={36} />
          <span className="text-xs text-gray-400 shrink-0">{boardScore ?? "VS"}</span>
          {m.entrant2 ? <EntrantChip e={m.entrant2} size={36} /> : <span className="text-sm text-gray-400">부전승</span>}
        </div>
        {teamMode && m.boards.length > 0 && (
          <div className="mt-2 space-y-1">
            {[...m.boards].sort((a, b) => a.order - b.order).map((b) => renderBoard(m, b))}
            {renderLineup(m)}
            {teamMode && !confirmed && m.boards.every((b) => b.report_status === "confirmed") && (
              <p className="text-xs text-amber-600 dark:text-amber-400">동률입니다. 주최자가 승패를 판정해 주세요.</p>
            )}
          </div>
        )}
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
                {allowDraw && (
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
      <button onClick={() => navigate("/tournaments/join")} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-2">← 대회 목록</button>

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
          : t.status === "cancelled" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
          {STATUS_LABELS[t.status] || t.status}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
        <Avatar icon={t.host_avatar_icon} border={t.host_border} size={22} />
        <span>주최 {t.host_name}</span>
        {t.host_md_uid && <span className="font-mono">· 주최자 UID {t.host_md_uid}</span>}
        {t.has_password && <span title="참가하려면 비밀번호가 필요합니다">· 🔒 비밀번호</span>}
        <span>· {FORMAT_LABELS[t.format]}{t.status === "ongoing" ? ` · ${t.current_round}라운드` : ""}</span>
        <span>· {new Date(t.event_date).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {t.description && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-3">{t.description}</p>}
      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

      {/* 참가/운영 액션 */}
      <div className="flex gap-2 flex-wrap mb-6">
        {t.status === "recruiting" && me && !myEntrant && !teamMode && (
          <JoinForm tournamentId={t.id} hasPassword={!!t.has_password} deckCount={t.deck_count ?? 0} accountName={me} act={act} />
        )}
        {t.status === "recruiting" && me && !myEntrant && teamMode && (
          <div className="w-full flex flex-col sm:flex-row gap-2">
            <input
              className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white sm:w-52"
              placeholder="MD UID 9자리 (저장돼 있으면 생략)"
              value={uidInput}
              maxLength={9}
              onChange={(e) => setUidInput(e.target.value.replace(/\D/g, ""))}
            />
            <div className="flex gap-2">
              <input className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white w-36" placeholder="팀 이름" maxLength={100} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              {t.has_password && (
                <input
                  type="password"
                  className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white w-32"
                  placeholder="🔒 비밀번호"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                />
              )}
              <button className={blueBtn} disabled={!teamName.trim() || (!!t.has_password && !joinPassword)} onClick={() => act(() => registerTournament(t.id, uidInput || undefined, teamName.trim(), joinPassword || undefined))}>팀 만들기</button>
            </div>
            <div className="flex gap-2">
              <input className="px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white w-28 font-mono uppercase" placeholder="팀 코드" maxLength={6} value={teamCode} onChange={(e) => setTeamCode(e.target.value.toUpperCase())} />
              <button className={grayBtn} disabled={teamCode.length !== 6} onClick={() => act(() => joinTeam(t.id, teamCode, uidInput || undefined))}>팀 합류</button>
            </div>
          </div>
        )}
        {t.status === "recruiting" && myEntrant?.status === "registered" && (!teamMode || isCaptain) && (
          <button
            className={blueBtn}
            disabled={teamMode && myEntrant.members.length < t.team_size}
            title={teamMode && myEntrant.members.length < t.team_size ? `팀원 ${t.team_size}명이 모여야 체크인할 수 있습니다` : ""}
            onClick={() => act(() => checkInTournament(t.id))}
          >체크인</button>
        )}
        {t.status === "recruiting" && teamMode && myEntrant && !isCaptain && (myEntrant.status === "registered" || myEntrant.status === "checked_in") && (
          <button className={grayBtn} onClick={() => act(() => leaveTeam(t.id))}>팀 나가기</button>
        )}
        {(t.status === "recruiting" || t.status === "ongoing") && myEntrant && (myEntrant.status === "registered" || myEntrant.status === "checked_in") && (!teamMode || isCaptain) && (
          <button
            className={grayBtn}
            onClick={() => {
              if (t.status === "ongoing" && !window.confirm(`진행 중인 대회에서 기권하면 남은 경기는 상대 승으로 처리되고 되돌릴 수 없습니다. ${teamMode ? "팀 전체가 " : ""}기권할까요?`)) return;
              act(() => withdrawTournament(t.id));
            }}
          >{teamMode ? "팀 기권" : "기권"}</button>
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
        {isHost && (t.status === "recruiting" || t.status === "ongoing") && (
          <>
            <button
              className={grayBtn}
              onClick={() => {
                setEdit({ name: t.name, description: t.description, event_date: toLocalInput(t.event_date), capacity: String(t.capacity) });
                setEditing((v) => !v);
              }}
            >{editing ? "수정 닫기" : "대회 수정"}</button>
            <button
              className={redBtn}
              onClick={() => {
                if (!window.confirm("대회를 취소하면 목록에서 사라지고 되돌릴 수 없습니다. 취소할까요?")) return;
                act(() => cancelTournament(t.id));
              }}
            >대회 취소</button>
          </>
        )}
      </div>

      {editing && isHost && (
        <div className="mb-6 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex flex-col gap-2">
          <input className={inputCls} value={edit.name} maxLength={100} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="대회 이름" />
          <textarea className={inputCls} rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="설명" />
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" className={inputCls} value={edit.event_date} onChange={(e) => setEdit({ ...edit, event_date: e.target.value })} />
            <input type="number" min={2} max={128} className={inputCls} value={edit.capacity} disabled={t.status !== "recruiting"} title={t.status !== "recruiting" ? "시작 후에는 정원을 바꿀 수 없습니다" : ""} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} placeholder="정원" />
          </div>
          <div className="flex justify-end">
            <button
              className={blueBtn}
              onClick={() => act(async () => {
                const payload: Parameters<typeof updateTournament>[1] = {
                  name: edit.name.trim(), description: edit.description.trim(),
                  event_date: new Date(edit.event_date).toISOString(),
                };
                if (t.status === "recruiting") payload.capacity = Number(edit.capacity);
                await updateTournament(t.id, payload);
                setEditing(false);
              })}
            >저장</button>
          </div>
        </div>
      )}

      {teamMode && myEntrant && myEntrant.user === null && (myEntrant.status === "registered" || myEntrant.status === "checked_in") && (
        <div className="mb-6 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <span className="font-semibold">내 팀 · {myEntrant.name} <span className="text-sm font-normal text-gray-500">({myEntrant.members.length}/{t.team_size})</span></span>
            {myEntrant.join_code && t.status === "recruiting" && (
              <button
                className="text-xs font-mono px-2 py-1 rounded bg-white dark:bg-gray-900 border dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="팀 코드 복사"
                onClick={() => { navigator.clipboard?.writeText(myEntrant.join_code!).catch(() => {}); }}
              >팀 코드 {myEntrant.join_code} 📋</button>
            )}
          </div>
          <div className="space-y-1">
            {[...myEntrant.members].sort((a, b) => a.order - b.order).map((m, i, arr) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                  <MemberChip m={m} />
                  {m.md_uid && <span className="text-[11px] text-gray-400 font-mono">{m.md_uid}</span>}
                </div>
                {isCaptain && t.status === "recruiting" && (
                  <div className="flex gap-1 text-xs">
                    <button className="px-1.5 disabled:opacity-30" disabled={i === 0} onClick={() => { const ids = arr.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; act(() => setTeamOrder(t.id, ids)); }}>▲</button>
                    <button className="px-1.5 disabled:opacity-30" disabled={i === arr.length - 1} onClick={() => { const ids = arr.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; act(() => setTeamOrder(t.id, ids)); }}>▼</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {isCaptain && t.status === "recruiting" && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">순서는 기본 출전 순서(1번 선수부터)입니다. 경기마다 결과 보고 전까지 바꿀 수 있습니다.</p>}
        </div>
      )}

      {/* 탭: 참가자(=순위) / 대진표 */}
      <div className="flex justify-start sm:justify-center gap-1 sm:gap-3 mb-4 border-b dark:border-gray-700 pb-2 overflow-x-auto">
        <button onClick={() => setTab("players")} className={tabClass("players")}>
          참가자 {activeEntrants.length}/{t.capacity}{entrantLabel}
        </button>
        <button onClick={() => setTab("bracket")} className={tabClass("bracket")}>대진표</button>
        <button onClick={() => setTab("deck")} className={tabClass("deck")}>덱</button>
        <button onClick={() => setTab("notice")} className={tabClass("notice")}>공지</button>
        <button onClick={() => setTab("chat")} className={tabClass("chat")}>채팅</button>
      </div>

      {tab === "deck" && (
        <section>
          <DeckTab
            tournamentId={t.id}
            deckCount={t.deck_count ?? 1}
            myEntrant={myEntrant && (myEntrant.status === "registered" || myEntrant.status === "checked_in") ? myEntrant : undefined}
            myUserId={myUserId}
            isHost={isHost}
            entrants={t.entrants}
            recruiting={t.status === "recruiting"}
          />
        </section>
      )}
      {tab === "notice" && (
        <section><AnnouncementsTab tournamentId={t.id} isHost={isHost} /></section>
      )}
      {tab === "chat" && (
        <section>
          <ChatTab
            tournamentId={t.id}
            canWrite={isHost || !!(myEntrant && (myEntrant.status === "registered" || myEntrant.status === "checked_in"))}
            hasTeam={teamMode && !!myEntrant && myEntrant.user === null && myEntrant.status !== "withdrawn" && myEntrant.status !== "kicked"}
          />
        </section>
      )}

      {tab === "players" && t.status === "recruiting" && (
        <section>
          {t.entrants.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">아직 참가자가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {t.entrants.map((e) => (
                <div key={e.id} className="border dark:border-gray-700 rounded-lg px-2.5 py-2 bg-white dark:bg-gray-800">
                  <div className="flex items-center justify-between">
                    <EntrantChip e={e} />
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      {e.md_uid && <span className="text-[11px] text-gray-400 font-mono">{e.md_uid}</span>}
                      {e.user === null && <span className="text-[11px] text-gray-400">{e.members.length}/{t.team_size}</span>}
                      {isHost && e.status !== "kicked" && e.status !== "withdrawn" && (
                        <button className="text-xs text-red-500 hover:underline" onClick={() => act(() => kickEntrant(t.id, e.id))}>추방</button>
                      )}
                    </div>
                  </div>
                  {e.user === null && e.members.length > 0 && (
                    <div className="mt-1.5 pl-1 space-y-0.5">
                      {e.members.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-2">
                          <MemberChip m={m} size={20} />
                          {m.md_uid && <span className="text-[10px] text-gray-400 font-mono">{m.md_uid}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "players" && t.status !== "recruiting" && (() => {
        const grouped = t.format === "group_knockout";
        const groupIds = grouped ? [...new Set(standings.map((r) => r.group).filter((g): g is number => g !== null))].sort((a, b) => a - b) : [];
        const knockoutStarted = t.rounds.some((r) => r.stage === "knockout");
        const renderTable = (rows: StandingRow[], medals: boolean) => (
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
                {rows.map((row, i) => (
                  <tr key={row.entrant_id} className={`border-b dark:border-gray-700/60 ${row.dropped ? "opacity-50" : grouped && row.qualified && !medals ? "bg-blue-50/60 dark:bg-blue-900/20" : ""}`}>
                    <td className="px-2 py-1.5">{row.dropped ? "–" : i < 3 && medals && t.status === "completed" ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {row.user === null ? <TeamAvatars members={row.members} size={22} max={3} /> : <Avatar icon={row.avatar_icon} border={row.border} size={28} />}
                        <div className="min-w-0">
                          <div className="truncate">
                            {row.name}
                            {row.dropped && <span className="ml-1 text-[10px] font-semibold text-red-500">기권</span>}
                            {grouped && row.qualified && !medals && !row.dropped && <span className="ml-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400">결선</span>}
                          </div>
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
        );
        if (standings.length === 0) {
          return <section><p className="text-sm text-gray-500 dark:text-gray-400">순위 정보가 없습니다.</p></section>;
        }
        if (!grouped) return <section>{renderTable(standings, true)}</section>;
        return (
          <section className="space-y-5">
            {knockoutStarted && (
              <div>
                <h3 className="font-semibold mb-2">최종 순위</h3>
                {renderTable(standings.filter((r) => r.qualified), true)}
              </div>
            )}
            {groupIds.map((g) => (
              <div key={g}>
                <h3 className="font-semibold mb-2">{GROUP_LABEL(g)}</h3>
                {renderTable(
                  [...standings.filter((r) => r.group === g)].sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || a.name.localeCompare(b.name)),
                  false,
                )}
              </div>
            ))}
          </section>
        );
      })()}

      {tab === "bracket" && (() => {
        if (t.rounds.length === 0) {
          return (
            <section>
              <p className="text-sm text-gray-500 dark:text-gray-400">대회가 시작되면 대진표가 생성됩니다.</p>
            </section>
          );
        }
        const knockoutRounds = t.rounds.filter((r) => r.stage === "knockout");
        const listRounds = t.rounds.filter((r) => r.stage !== "knockout");
        const current = t.rounds.find((r) => r.number === t.current_round);
        const openKnockout = current && current.stage === "knockout"
          ? current.matches.filter((m) => m.report_status !== "confirmed")
          : [];
        return (
          <section>
            {knockoutRounds.length > 0 && t.format === "double_elim" && (() => {
              const wb = knockoutRounds
                .map((r) => ({ ...r, matches: r.matches.filter((m) => m.bracket === "winners") }))
                .filter((r) => r.matches.length > 0);
              const lb = knockoutRounds
                .map((r, i) => ({ title: `패자조 ${i}R`, matches: r.matches.filter((m) => m.bracket === "losers") }))
                .filter((c) => c.matches.length > 0)
                .map((c, i) => ({ ...c, title: `패자조 ${i + 1}R` }));
              const finals = knockoutRounds
                .map((r) => r.matches.filter((m) => m.bracket === "final"))
                .filter((ms) => ms.length > 0)
                .map((ms, i) => ({ title: i === 0 ? "최종전" : "최종전 (리셋)", matches: ms }));
              return (
                <div className="mb-5 space-y-4">
                  <div>
                    <h3 className="font-semibold mb-2">승자조</h3>
                    <BracketTree rounds={wb} />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">패자조</h3>
                    {lb.length > 0 ? <ColumnBracket columns={lb} /> : <p className="text-sm text-gray-500 dark:text-gray-400">승자조 1라운드가 끝나면 시작됩니다.</p>}
                  </div>
                  {finals.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">최종전</h3>
                      <ColumnBracket columns={finals} />
                    </div>
                  )}
                </div>
              );
            })()}
            {knockoutRounds.length > 0 && t.format !== "double_elim" && (
              <div className="mb-5">
                {listRounds.length > 0 && (
                  <h3 className="font-semibold mb-2">결선 토너먼트</h3>
                )}
                <BracketTree rounds={knockoutRounds} />
              </div>
            )}
            {openKnockout.length > 0 && (
              <div className="mb-5">
                <h3 className="font-semibold mb-2">진행 중인 경기</h3>
                <div className="space-y-2">
                  {[...openKnockout].sort((a, b) => a.bracket_pos - b.bracket_pos).map((m) => renderMatch(m, false))}
                </div>
              </div>
            )}
            {listRounds.length > 0 && (
              <div className="space-y-4">
                {[...listRounds].sort((a, b) => b.number - a.number).map((r) => (
                  <div key={r.number}>
                    <h3 className="font-semibold mb-2">
                      {t.format === "group_knockout" ? "조별 " : knockoutRounds.length > 0 ? "스위스 " : ""}{r.number}라운드{" "}
                      {r.status === "completed" ? <span className="text-xs text-gray-400">(완료)</span> : null}
                    </h3>
                    {t.format === "group_knockout" ? (
                      <div className="space-y-3">
                        {[...new Set(r.matches.map((m) => m.group ?? 0))].sort((a, b) => a - b).map((g) => (
                          <div key={g}>
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{GROUP_LABEL(g)}</div>
                            <div className="space-y-2">
                              {r.matches.filter((m) => (m.group ?? 0) === g).sort((a, b) => a.bracket_pos - b.bracket_pos).map((m) => renderMatch(m, true))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {[...r.matches].sort((a, b) => a.bracket_pos - b.bracket_pos).map((m) => renderMatch(m, r.stage !== "knockout"))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })()}

    </div>
  );
}

export default TournamentDetailPage;
