import { useState } from "react";
import { checkTournamentPassword, joinTournament } from "@/api/tournamentApi";

const input = "w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600";
const blueBtn = "px-4 py-2 text-sm rounded-lg font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:bg-gray-500 disabled:cursor-not-allowed";

type Props = {
  tournamentId: number;
  hasPassword: boolean;
  deckCount: number;
  accountName: string;
  /** Runs the join through the page's error handling and refresh. */
  act: (fn: () => Promise<unknown>) => Promise<void>;
};

// Joining a tournament (특이점 2026-10-10): the password first when there is one, then the Master Duel UID of the
// account that will actually play, an optional nickname, and every deck list the host asked for.
export default function JoinForm({ tournamentId, hasPassword, deckCount, accountName, act }: Props) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!hasPassword);
  const [checking, setChecking] = useState(false);
  const [pwError, setPwError] = useState("");
  const [uid, setUid] = useState("");
  const [nickname, setNickname] = useState("");
  const [decks, setDecks] = useState<(File | null)[]>(() => Array(deckCount).fill(null));
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    setChecking(true); setPwError("");
    try {
      await checkTournamentPassword(tournamentId, password);
      setUnlocked(true);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "비밀번호를 확인하지 못했습니다.");
    } finally {
      setChecking(false);
    }
  };

  if (!unlocked) {
    return (
      <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-2">
        <p className="text-sm font-semibold">🔒 이 대회는 비밀번호가 있어야 참가할 수 있습니다.</p>
        <div className="flex gap-2">
          <input
            type="password"
            className={input}
            placeholder="주최자에게 받은 비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && password) unlock(); }}
          />
          <button type="button" className={`${blueBtn} shrink-0`} disabled={!password || checking} onClick={unlock}>
            {checking ? "확인 중…" : "확인"}
          </button>
        </div>
        {pwError && <p className="text-sm text-red-500">{pwError}</p>}
      </div>
    );
  }

  const ready = /^\d{9}$/.test(uid) && decks.every(Boolean);
  const submit = async () => {
    setBusy(true);
    await act(() => joinTournament(tournamentId, {
      md_uid: uid,
      nickname: nickname.trim() || undefined,
      password: hasPassword ? password : undefined,
      decks: decks as File[],
    }));
    setBusy(false);
  };

  return (
    <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold">참가 신청</p>
      <div>
        <label className="block text-xs font-semibold mb-1">마스터 듀얼 UID *</label>
        <input
          className={`${input} font-mono`}
          inputMode="numeric"
          maxLength={9}
          placeholder="123456789"
          value={uid}
          onChange={(e) => setUid(e.target.value.replace(/\D/g, ""))}
        />
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">대회에 실제로 참가할 마스터 듀얼 계정의 UID(숫자 9자리)를 입력해 주세요.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1">대회에서 쓸 닉네임 (선택)</label>
        <input className={input} maxLength={30} placeholder={accountName || "비워 두면 계정 닉네임을 씁니다"} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">비워 두면 계정 닉네임{accountName ? `(${accountName})` : ""}으로 참가합니다.</p>
      </div>
      {deckCount > 0 && (
        <div>
          <label className="block text-xs font-semibold mb-1">덱 리스트 제출 * <span className="font-normal text-gray-500">({deckCount}개 모두 필요)</span></label>
          <div className="flex flex-col gap-1.5">
            {decks.map((f, i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 text-gray-500 dark:text-gray-400">덱 {i + 1}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm min-w-0"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setDecks((prev) => prev.map((x, j) => (j === i ? file : x)));
                  }}
                />
                {f && <span className="text-green-600 dark:text-green-400 shrink-0">✓</span>}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">덱 리스트 스크린샷(5MB 이하)을 올려 주세요. 참가 후 '덱' 탭에서 카드 목록을 확인·수정할 수 있습니다.</p>
        </div>
      )}
      <button type="button" className={blueBtn} disabled={!ready || busy} onClick={submit}>
        {busy ? "신청 중…" : "참가 신청"}
      </button>
    </div>
  );
}
