import { useEffect, useState } from "react";
import {
  addSheetMember,
  getSheetContributors,
  getSheetMembers,
  issueSheetInvite,
  joinSheetByCode,
  removeSheetMember,
  type SheetContributor,
  type SheetMembers,
} from "@/api/toolApi";

type Props = {
  recordGroupId: number;
  /** currently selected contributor filter, null = everyone */
  memberFilter: number | null;
  onFilterChange: (userId: number | null) => void;
  onLeft?: () => void;
};

const Chip = ({ icon, username, border }: { icon: string | null; username: string; border: string | null }) => (
  <span className="inline-flex items-center gap-1.5">
    {icon ? (
      <img
        src={icon}
        alt=""
        className={`w-6 h-6 rounded-full object-cover ${border ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""}`}
      />
    ) : (
      <span className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs">
        {username.slice(0, 1)}
      </span>
    )}
    <span>{username}</span>
  </span>
);

// Members of a shared sheet plus each person's record. Owners can invite and remove.
export default function SheetMembersPanel({ recordGroupId, memberFilter, onFilterChange, onLeft }: Props) {
  const [data, setData] = useState<SheetMembers | null>(null);
  const [contributors, setContributors] = useState<SheetContributor[]>([]);
  const [invitee, setInvitee] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const [m, c] = await Promise.all([getSheetMembers(recordGroupId), getSheetContributors(recordGroupId)]);
      setData(m);
      setContributors(c.contributors);
    } catch {
      /* not allowed to see members — leave the panel hidden */
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordGroupId]);

  if (!data) return null;
  const isOwner = data.my_role === "owner";
  const isShared = data.kind === "shared" || data.members.length > 0;
  if (!isShared) return null;

  const invite = async (disable = false) => {
    setMsg("");
    try {
      await issueSheetInvite(recordGroupId, disable);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const add = async () => {
    const name = invitee.trim();
    if (!name) return;
    setMsg("");
    try {
      setData(await addSheetMember(recordGroupId, { username: name }));
      setInvitee("");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const remove = async (userId: number, self: boolean) => {
    if (!confirm(self ? "이 시트에서 나가시겠습니까?" : "이 멤버를 내보내시겠습니까?")) return;
    try {
      await removeSheetMember(recordGroupId, userId);
      if (self) onLeft?.();
      else await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const total = contributors.reduce((n, c) => n + c.games, 0);

  return (
    <div className="mb-4 max-w-2xl w-full mx-auto bg-white dark:bg-gray-800 border-y sm:border border-gray-200 dark:border-gray-700 sm:rounded-xl px-3 py-2 sm:px-4 sm:py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between py-1 text-left">
        <span className="font-semibold">
          그룹 시트 · {data.members.length + 1}명
          {memberFilter !== null && <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">필터 적용 중</span>}
        </span>
        <span className="text-gray-400 text-sm">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      {/* per-person record — the reason a crew shares a sheet */}
      {contributors.length > 1 && (
      <div className="flex flex-wrap gap-2 mt-2">
        <button
          type="button"
          onClick={() => onFilterChange(null)}
          className={`px-2.5 py-1 rounded-lg text-sm border ${memberFilter === null ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-600"}`}
        >
          전체 {total}전
        </button>
        {contributors.map((c) =>
          c.user ? (
            <button
              key={c.user.id}
              type="button"
              onClick={() => onFilterChange(memberFilter === c.user!.id ? null : c.user!.id)}
              className={`px-2.5 py-1 rounded-lg text-sm border flex items-center gap-2 ${
                memberFilter === c.user.id ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <Chip icon={c.user.icon} username={c.user.username} border={c.user.border} />
              <span className="text-xs opacity-80">
                {c.games}전 {c.win_rate ?? 0}%
              </span>
            </button>
          ) : null
        )}
      </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">멤버</div>
            <ul className="space-y-1 text-sm">
              <li className="flex items-center justify-between">
                <Chip icon={data.owner.icon} username={data.owner.username} border={data.owner.border} />
                <span className="text-xs text-gray-500">소유자</span>
              </li>
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between">
                  <Chip icon={m.icon} username={m.username} border={m.border} />
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{m.role === "editor" ? "기록 가능" : "보기 전용"}</span>
                    {(isOwner || data.my_role === "editor") && (
                      <button
                        type="button"
                        onClick={() => remove(m.id, !isOwner)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {isOwner ? "내보내기" : "나가기"}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {isOwner && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={invitee}
                  onChange={(e) => setInvitee(e.target.value)}
                  placeholder="닉네임으로 초대"
                  className="flex-1 min-w-[140px] px-3 py-1.5 border rounded-lg bg-white dark:bg-gray-800 text-sm"
                />
                <button type="button" onClick={add} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  초대
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.invite_code ? (
                  <>
                    <code className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm">{data.invite_code}</code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(data.invite_code);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg"
                    >
                      {copied ? "복사됨!" : "코드 복사"}
                    </button>
                    <button type="button" onClick={() => invite()} className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded-lg">
                      새 코드
                    </button>
                    <button type="button" onClick={() => invite(true)} className="px-3 py-1.5 text-sm text-red-600 hover:underline">
                      코드 끄기
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => invite()} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    초대 코드 만들기
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">코드를 받은 사람은 시트 목록에서 참여할 수 있습니다.</p>
            </div>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export const joinSheet = joinSheetByCode;
