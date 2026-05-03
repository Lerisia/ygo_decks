import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/Avatar";
import { listShopIcons, type ShopCardIcon } from "@/api/avatarApi";
import { isAuthenticated } from "@/api/accountApi";

export default function IconShop() {
  const navigate = useNavigate();
  const loggedIn = isAuthenticated();
  const [icons, setIcons] = useState<ShopCardIcon[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "owned" | "locked">("all");

  useEffect(() => {
    listShopIcons()
      .then((d) => setIcons(d.icons))
      .catch((e: any) => setError(e.message || "로드 실패"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = icons;
    if (filterMode === "owned") list = list.filter((i) => i.owned);
    if (filterMode === "locked") list = list.filter((i) => !i.owned);
    if (q) {
      list = list.filter((i) =>
        (i.card_name || "").toLowerCase().includes(q) ||
        (i.title || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [icons, query, filterMode]);

  const ownedCount = useMemo(() => icons.filter((i) => i.owned).length, [icons]);

  return (
    <div className="min-h-screen px-4 py-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate("/playground")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← 놀이터
      </button>
      <h1 className="text-2xl font-bold mb-1">아이콘 샵</h1>
      <p className="text-sm text-gray-500 mb-5">
        {loggedIn ? `보유 ${ownedCount}/${icons.length}개` : "로그인하면 보유 여부를 확인할 수 있습니다."}
      </p>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {[
          { value: "all", label: "전체" },
          { value: "owned", label: "보유" },
          { value: "locked", label: "미보유" },
        ].map((m) => (
          <button
            key={m.value}
            onClick={() => setFilterMode(m.value as any)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              filterMode === m.value
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔍 아이콘 검색"
        className="w-full px-4 py-2 mb-4 border rounded-lg bg-white dark:bg-gray-800 text-sm"
      />

      {loading ? (
        <p className="text-center text-gray-500">로딩 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-500 py-8">표시할 아이콘이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {filtered.map((icon) => (
            <div key={icon.id} className="flex flex-col items-center text-center">
              <div className="relative">
                <Avatar
                  icon={icon}
                  size={64}
                  className={icon.owned ? "" : "opacity-40"}
                />
                {!icon.owned && (
                  <span className="absolute inset-0 flex items-center justify-center text-2xl">🔒</span>
                )}
              </div>
              <span className="text-xs mt-1 truncate w-full">{icon.title || icon.card_name}</span>
              <span className={`text-[10px] mt-0.5 ${icon.owned ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}>
                {icon.owned ? "보유" : "잠김"}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-gray-400 text-center">
        획득 방식은 추후 추가 예정입니다.
      </p>
    </div>
  );
}
