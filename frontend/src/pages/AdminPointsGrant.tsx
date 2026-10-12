import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminGrantGems, adminGrantPoints, adminSearchUsers, type AdminUserHit } from "@/api/accountApi";

/** Points, or the pack simulator's gems (엘리스 2026-10-13: operators grant gems until buying them with points opens). */
const CURRENCIES = { points: { label: "포인트", unit: "P" }, gems: { label: "젬", unit: "젬" } } as const;
type Currency = keyof typeof CURRENCIES;

export default function AdminPointsGrant() {
  const navigate = useNavigate();
  const [currency, setCurrency] = useState<Currency>("points");
  const unit = CURRENCIES[currency].unit;
  const held = (u: AdminUserHit) => (currency === "gems" ? u.gems : u.points);
  const [usernameQuery, setUsernameQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUserHit | null>(null);
  const [searchResults, setSearchResults] = useState<AdminUserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<{
    username: string;
    amount: number;
    note: string;
    balance: number;
    unit: string;
  } | null>(null);

  // Debounced search; only fires when no user is locked in.
  useEffect(() => {
    if (selectedUser) { setSearchResults([]); return; }
    const q = usernameQuery.trim();
    if (!q) { setSearchResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await adminSearchUsers(q);
        setSearchResults(r);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [usernameQuery, selectedUser]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!searchOpen) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [searchOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = parseInt(amountStr, 10);
    if (!selectedUser) { setError("대상 사용자를 검색해서 선택하세요."); return; }
    if (!Number.isFinite(amt) || amt === 0) { setError("금액은 0이 아닌 정수여야 합니다."); return; }
    if (!note.trim()) {
      if (!confirm("사유 없이 지급하시겠습니까?")) return;
    }
    if (amt < 0) {
      if (!confirm(`${selectedUser.username} 의 ${CURRENCIES[currency].label}를 ${Math.abs(amt)}${unit} 차감합니다. 진행할까요?`)) return;
    }
    setSubmitting(true);
    try {
      if (currency === "gems") {
        const r = await adminGrantGems(selectedUser.username, amt, note.trim());
        setLastResult({ username: r.user.username, amount: r.amount, note: r.note, balance: r.user.gems, unit });
        setSelectedUser({ ...selectedUser, gems: r.user.gems });
      } else {
        const r = await adminGrantPoints(selectedUser.username, amt, note.trim());
        setLastResult({ username: r.user.username, amount: r.amount, note: r.note, balance: r.user.points, unit });
        // Keep selectedUser so multiple grants to same user are easy.
        setSelectedUser({ ...selectedUser, points: r.user.points });
      }
      setAmountStr("");
      setNote("");
    } catch (e) {
      setError((e as Error)?.message || "지급 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 max-w-md mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 관리
      </button>

      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-4 sm:p-5">
        <h1 className="text-xl font-bold mb-1">🏛️ {CURRENCIES[currency].label} 지급/차감</h1>
        <div role="tablist" aria-label="지급할 것" className="mb-3 grid grid-cols-2 rounded-lg bg-gray-200 dark:bg-gray-700 p-0.5 text-sm font-semibold">
          {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={currency === c} onClick={() => { setCurrency(c); setLastResult(null); }}
                    className={`h-8 rounded-md transition ${currency === c ? "bg-white dark:bg-gray-900 shadow text-blue-700 dark:text-blue-300" : "text-gray-600 dark:text-gray-300"}`}>
              {CURRENCIES[c].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {currency === "gems"
            ? "팩 개봉 시뮬레이터에서 팩을 사는 젬입니다(1팩 100젬). 음수를 입력하면 차감되고, 0 아래로는 내려가지 않습니다."
            : "음수를 입력하면 차감됩니다. 차감 시 보유 포인트가 0 미만이면 0 으로 클램프됩니다. 누적 포인트는 차감되지 않아요."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium mb-1">대상 닉네임</label>
            {selectedUser ? (
              <div className="flex items-center justify-between gap-2 px-2 py-2 border rounded bg-blue-50 dark:bg-blue-900/20">
                <div className="min-w-0">
                  <span className="font-semibold truncate">{selectedUser.username}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">현재 {held(selectedUser).toLocaleString()}{unit}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedUser(null); setUsernameQuery(""); }}
                  className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  변경
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={usernameQuery}
                  onChange={(e) => { setUsernameQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="닉네임 일부를 입력하면 검색"
                  className="w-full px-2 py-2 border rounded bg-white dark:bg-gray-700"
                />
                {searchOpen && (searching || searchResults.length > 0 || (usernameQuery.trim() && !searching)) && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {searching && (
                      <div className="px-3 py-2 text-xs text-gray-400">검색 중…</div>
                    )}
                    {!searching && searchResults.length === 0 && usernameQuery.trim() && (
                      <div className="px-3 py-2 text-xs text-gray-400">결과 없음</div>
                    )}
                    {searchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(u);
                          setUsernameQuery("");
                          setSearchOpen(false);
                          setSearchResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between gap-2"
                      >
                        <span className="font-medium truncate">{u.username}</span>
                        <span className="shrink-0 text-xs text-gray-500 tabular-nums">{held(u).toLocaleString()}{unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">금액 ({unit})</label>
            <input
              type="number"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="예: 100, -50"
              className="w-full px-2 py-2 border rounded bg-white dark:bg-gray-700 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">사유</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="예: 이벤트 보상, 환불 회수, 버그 보상 등"
              className="w-full px-2 py-2 border rounded bg-white dark:bg-gray-700 resize-none"
            />
            <div className="text-[10px] text-gray-400 text-right">{note.length}/200</div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "처리 중…" : "적용"}
          </button>
        </form>

        {lastResult && (
          <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3 text-sm">
            <p className="font-semibold text-green-700 dark:text-green-300">✅ 적용 완료</p>
            <p className="mt-1">
              {lastResult.username}{" "}
              <span className={lastResult.amount >= 0 ? "text-blue-600 dark:text-blue-400 font-bold" : "text-red-500 font-bold"}>
                {lastResult.amount >= 0 ? "+" : ""}{lastResult.amount}{lastResult.unit}
              </span>
              {lastResult.note && (
                <span className="text-gray-600 dark:text-gray-400"> — {lastResult.note}</span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">잔액: {lastResult.balance.toLocaleString()}{lastResult.unit}</p>
          </div>
        )}
      </div>
    </div>
  );
}
