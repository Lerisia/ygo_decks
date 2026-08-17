import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import {
  listShopIcons, purchaseIcon, listShopBorders, purchaseBorder, getMyAvatar,
  type ShopCardIcon, type ShopBorder, type Border,
} from "@/api/avatarApi";
import { isAuthenticated, getUserInfo } from "@/api/accountApi";
import { RARITY_LABEL, RARITY_BADGE, type IconRarity } from "@/api/cardIconApi";

const RARITY_ORDER: Record<Exclude<IconRarity, "">, number> = {
  common: 0, rare: 1, epic: 2, legendary: 3,
};

export default function IconShop() {
  const loggedIn = isAuthenticated();
  const [mainTab, setMainTab] = useState<"icon" | "border">("icon");
  const [icons, setIcons] = useState<ShopCardIcon[]>([]);
  const [borders, setBorders] = useState<ShopBorder[]>([]);
  const [bordersLoaded, setBordersLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "owned" | "locked">("all");
  // Single-select: empty string = no theme filter (show all).
  const [selectedTheme, setSelectedTheme] = useState<string>("");
  // Group-by mode: theme (default) or rarity (등급별).
  const [groupBy, setGroupBy] = useState<"theme" | "rarity">("theme");
  // When in rarity mode: empty string = show all rarities.
  const [selectedRarity, setSelectedRarity] = useState<string>("");
  const [points, setPoints] = useState<number | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const [myBorder, setMyBorder] = useState<Border | null>(null);

  const toggleTheme = (key: string) => {
    // Click same → deselect; click different → switch.
    setSelectedTheme((prev) => (prev === key ? "" : key));
  };

  const refreshPoints = () => {
    if (!loggedIn) return;
    getUserInfo().then((info) => {
      if (info && typeof info.points === "number") setPoints(info.points);
    }).catch(() => {});
  };

  useEffect(() => { refreshPoints(); }, [loggedIn]);

  // 현재 장착한 테두리 — 아이콘 미리보기에 씌워서 표시
  useEffect(() => {
    if (!loggedIn) { setMyBorder(null); return; }
    getMyAvatar().then((d) => { setMyBorder(d.border); }).catch(() => {});
  }, [loggedIn]);

  const handleBuy = async (icon: ShopCardIcon) => {
    if (!loggedIn) {
      setError("로그인이 필요합니다.");
      return;
    }
    if (icon.owned) return;
    if (points !== null && points < (icon.price || 0)) {
      window.alert(`포인트가 부족합니다.\n필요: ${icon.price}P\n보유: ${points}P`);
      return;
    }
    const ok = window.confirm(`${icon.title || icon.card_name}을(를) ${icon.price}P에 구매하시겠습니까?`);
    if (!ok) return;
    setBuying(icon.id);
    setError("");
    try {
      const res = await purchaseIcon(icon.id);
      setPoints(res.points);
      setIcons((prev) => prev.map((i) => i.id === icon.id ? { ...i, owned: true } : i));
      window.dispatchEvent(new Event("user-points-updated"));
    } catch (e: any) {
      setError(e?.message || "구매 실패");
    } finally {
      setBuying(null);
    }
  };

  useEffect(() => {
    listShopIcons()
      .then((d) => setIcons(d.icons))
      .catch((e: any) => setError(e.message || "로드 실패"))
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load borders the first time the 프레임 tab is opened.
  useEffect(() => {
    if (mainTab !== "border" || bordersLoaded) return;
    listShopBorders()
      .then((d) => { setBorders(d.borders); setBordersLoaded(true); })
      .catch((e: any) => setError(e.message || "프레임 로드 실패"));
  }, [mainTab, bordersLoaded]);

  const handleBuyBorder = async (b: ShopBorder) => {
    if (!loggedIn) { setError("로그인이 필요합니다."); return; }
    if (b.owned) return;
    if (points !== null && points < (b.price || 0)) {
      window.alert(`포인트가 부족합니다.\n필요: ${b.price}P\n보유: ${points}P`);
      return;
    }
    if (!window.confirm(`"${b.name}" 프레임을 ${b.price}P에 구매하시겠습니까?`)) return;
    setBuying(b.id);
    setError("");
    try {
      const res = await purchaseBorder(b.id);
      setPoints(res.points);
      setBorders((prev) => prev.map((x) => x.id === b.id ? { ...x, owned: true } : x));
      window.dispatchEvent(new Event("user-points-updated"));
    } catch (e: any) {
      setError(e?.message || "구매 실패");
    } finally {
      setBuying(null);
    }
  };

  const allThemes = useMemo(() => {
    const set = new Set<string>();
    let hasNoTheme = false;
    for (const i of icons) {
      if (i.theme) set.add(i.theme);
      else hasNoTheme = true;
    }
    const arr = [...set].sort((a, b) => a.localeCompare(b));
    if (hasNoTheme) arr.push("__none__");
    return arr;
  }, [icons]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = icons;
    if (filterMode === "owned") list = list.filter((i) => i.owned);
    if (filterMode === "locked") list = list.filter((i) => !i.owned);
    if (selectedTheme) {
      list = list.filter((i) => (i.theme || "__none__") === selectedTheme);
    }
    if (groupBy === "rarity" && selectedRarity) {
      list = list.filter((i) => (i.rarity || "__none__") === selectedRarity);
    }
    if (q) {
      list = list.filter((i) =>
        (i.card_name || "").toLowerCase().includes(q) ||
        (i.title || "").toLowerCase().includes(q) ||
        (i.theme || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [icons, query, filterMode, selectedTheme, groupBy, selectedRarity]);

  // "신규 출시" row pinned to the top regardless of group-by mode. Newest
  // listing first; ties (no shop_listed_at) sort by name. Items also stay
  // in their theme/rarity group below — duplication is intentional so a
  // Blue-Eyes fan still sees the new Blue-Eyes icon under Blue-Eyes.
  const newGroup = useMemo(() => {
    const items = filtered.filter((i) => i.is_new);
    if (items.length === 0) return null;
    return {
      key: "__new__",
      label: "🆕 신규 출시",
      items: [...items].sort((a, b) => {
        const ta = a.shop_listed_at ? Date.parse(a.shop_listed_at) : 0;
        const tb = b.shop_listed_at ? Date.parse(b.shop_listed_at) : 0;
        if (ta !== tb) return tb - ta;
        return (a.card_name || "").localeCompare(b.card_name || "");
      }),
    };
  }, [filtered]);

  const groups = useMemo(() => {
    const map = new Map<string, ShopCardIcon[]>();
    if (groupBy === "rarity") {
      // Group by rarity tier (price-based).
      for (const i of filtered) {
        const k = i.rarity || "__none__";
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(i);
      }
      const order = ["common", "rare", "epic", "legendary", "__none__"];
      return order.filter((k) => map.has(k)).map((k) => {
        const items = [...map.get(k)!].sort((a, b) => {
          const pa = (a.price || 0) - (b.price || 0);
          if (pa !== 0) return pa;
          return (a.card_name || "").localeCompare(b.card_name || "");
        });
        const label = k === "__none__"
          ? "기타"
          : `${RARITY_LABEL[k as Exclude<IconRarity, "">]} · ${items[0]?.price ?? 0}P`;
        return { key: k, label, items };
      });
    }
    // Default: group by theme
    for (const i of filtered) {
      const k = i.theme || "";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(i);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k,
      label: k || "기타",
      items: [...map.get(k)!].sort((a, b) => {
        const ra = a.rarity ? RARITY_ORDER[a.rarity as Exclude<IconRarity, "">] : 99;
        const rb = b.rarity ? RARITY_ORDER[b.rarity as Exclude<IconRarity, "">] : 99;
        if (ra !== rb) return ra - rb;
        const pa = (a.price || 0) - (b.price || 0);
        if (pa !== 0) return pa;
        return (a.card_name || "").localeCompare(b.card_name || "");
      }),
    }));
  }, [filtered, groupBy]);

  const ownedCount = useMemo(() => icons.filter((i) => i.owned).length, [icons]);

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">상점</h1>
        {loggedIn && points !== null && (
          <span className="text-sm font-semibold">
            내 포인트: <span className="text-blue-600 dark:text-blue-400">{points.toLocaleString()}P</span>
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {loggedIn
          ? (mainTab === "icon" ? `아이콘 ${ownedCount}/${icons.length}개 보유` : `프레임 ${borders.filter((b) => b.owned).length}/${borders.length}개 보유`)
          : "로그인하면 구매할 수 있습니다."}
      </p>

      {/* Main tab: 아이콘 ↔ 프레임 */}
      <div className="flex gap-2 mb-5 border-b border-gray-200 dark:border-gray-700">
        {([
          { v: "icon", label: "🎴 아이콘" },
          { v: "border", label: "🖼️ 프레임" },
        ] as const).map((t) => (
          <button
            key={t.v}
            onClick={() => setMainTab(t.v)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
              mainTab === t.v
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {mainTab === "border" && (
        <div>
          {!bordersLoaded ? (
            <p className="text-center text-gray-500 py-8">로딩 중...</p>
          ) : borders.length === 0 ? (
            <p className="text-center text-gray-500 py-8">판매 중인 프레임이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-4">
              {borders.map((b) => {
                const isBuying = buying === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleBuyBorder(b)}
                    disabled={b.owned || isBuying}
                    className={`flex flex-col items-center text-center p-2 rounded-lg border transition ${
                      b.owned
                        ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 cursor-default"
                        : "border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20"
                    }`}
                  >
                    <div className="relative">
                      <Avatar icon={null} border={b} size={96} />
                      {b.owned && (
                        <span className="absolute -top-1 -right-1 bg-green-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 shadow">✓</span>
                      )}
                      {isBuying && (
                        <span className="absolute inset-0 flex items-center justify-center text-xl bg-white/60 dark:bg-black/60 rounded-full">⏳</span>
                      )}
                    </div>
                    <span className="text-xs mt-1.5 truncate w-full">{b.name}</span>
                    {b.rarity && (
                      <span className={`text-xs mt-0.5 px-1.5 py-0.5 rounded font-semibold ${RARITY_BADGE[b.rarity as Exclude<IconRarity, "">]}`}>
                        {RARITY_LABEL[b.rarity as Exclude<IconRarity, "">]}
                      </span>
                    )}
                    <span className={`text-sm mt-0.5 font-bold ${
                      b.owned ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400"
                    }`}>
                      {b.owned ? "구매완료" : `${b.price}P`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-8 text-xs text-gray-400 text-center">
            구매한 프레임은 마이페이지 → 아바타 설정에서 장착할 수 있습니다.
          </p>
        </div>
      )}

      {mainTab === "icon" && <>

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
        <span className="ml-auto text-xs text-gray-400 self-center">정렬</span>
        {[
          { value: "theme", label: "테마별" },
          { value: "rarity", label: "등급별" },
        ].map((g) => (
          <button
            key={g.value}
            onClick={() => setGroupBy(g.value as any)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              groupBy === g.value
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {groupBy === "theme" && allThemes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {allThemes.map((t) => {
            const label = t === "__none__" ? "기타" : t;
            const active = selectedTheme === t;
            return (
              <button
                key={t}
                onClick={() => toggleTheme(t)}
                className={`px-3 py-1.5 text-sm rounded-full border ${
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {groupBy === "rarity" && (
        <div className="flex flex-wrap gap-2 mb-3">
          {(["common", "rare", "epic", "legendary"] as const).map((r) => {
            const active = selectedRarity === r;
            return (
              <button
                key={r}
                onClick={() => setSelectedRarity((prev) => (prev === r ? "" : r))}
                className={`px-3 py-1.5 text-sm rounded-full border ${
                  active
                    ? `${RARITY_BADGE[r]} border-current font-semibold`
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                }`}
              >
                {RARITY_LABEL[r]}
              </button>
            );
          })}
        </div>
      )}

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
        <div className="space-y-6">
          {(newGroup ? [newGroup, ...groups] : groups).map((g) => (
            <div key={g.key || "__none__"}>
              {(g.key === "__new__" || (groupBy === "rarity" && !selectedRarity) || (groupBy === "theme" && !selectedTheme)) && (
                <h2 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-200">
                  {g.label} <span className="text-xs text-gray-400">· {g.items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-8 gap-3">
                {g.items.map((icon) => {
                  const isBuying = buying === icon.id;
                  return (
                    <button
                      key={`${g.key}-${icon.id}`}
                      type="button"
                      onClick={() => handleBuy(icon)}
                      disabled={icon.owned || isBuying}
                      // content-visibility:auto skips layout/paint for off-
                      // screen tiles — with 500+ icons the difference is
                      // huge on category-switch.
                      style={{ contentVisibility: "auto", containIntrinsicSize: "120px 130px" }}
                      className={`flex flex-col items-center text-center p-1 rounded-lg border transition ${
                        icon.owned
                          ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 cursor-default"
                          : "border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20"
                      }`}
                    >
                      <div className="relative">
                        <Avatar icon={icon} border={myBorder} size={88} />
                        {icon.is_new && (
                          <span className="absolute -top-1 -left-1 z-10 bg-red-500 text-white text-[10px] font-bold rounded px-1.5 py-0.5 shadow animate-pulse">신규 출시!</span>
                        )}
                        {icon.owned && (
                          <span className="absolute -top-1 -right-1 z-10 bg-green-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 shadow">✓</span>
                        )}
                        {isBuying && (
                          <span className="absolute inset-0 flex items-center justify-center text-xl bg-white/60 dark:bg-black/60 rounded-full">⏳</span>
                        )}
                      </div>
                      <span className="text-xs mt-1 truncate w-full">{icon.title || icon.card_name}</span>
                      {icon.rarity && (
                        <span className={`text-xs mt-0.5 px-1.5 py-0.5 rounded font-semibold ${RARITY_BADGE[icon.rarity as Exclude<IconRarity, "">]}`}>
                          {RARITY_LABEL[icon.rarity as Exclude<IconRarity, "">]}
                        </span>
                      )}
                      <span className={`text-sm mt-0.5 font-bold ${
                        icon.owned ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400"
                      }`}>
                        {icon.owned ? "구매완료" : `${icon.price}P`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-gray-400 text-center">
        포인트는 출석 보너스, 멀티플레이 게임 종료 시 획득합니다.
      </p>

      </>}
    </div>
  );
}
