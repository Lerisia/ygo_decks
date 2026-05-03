import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/Avatar";
import {
  listMyIcons, getMyAvatar, setMyAvatar,
  getMyBorders, setMyBorder,
  type PublicCardIcon, type Border,
} from "@/api/avatarApi";

export default function MyAvatar() {
  const navigate = useNavigate();
  const [icons, setIcons] = useState<PublicCardIcon[]>([]);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<PublicCardIcon | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [borders, setBorders] = useState<Border[]>([]);
  const [currentBorder, setCurrentBorder] = useState<Border | null>(null);
  const [savingBorder, setSavingBorder] = useState<number | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) {
      navigate("/unauthorized");
      return;
    }
    Promise.all([listMyIcons(), getMyAvatar(), getMyBorders()])
      .then(([listData, meData, bordersData]) => {
        setIcons(listData.icons);
        setCurrent(meData.icon);
        setIsDefault(meData.is_default_icon);
        setCurrentBorder(meData.border);
        setBorders(bordersData.borders);
      })
      .catch((e: any) => setError(e.message || "로드 실패"))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handlePickBorder = async (b: Border) => {
    setSavingBorder(b.id);
    setError("");
    try {
      const r = await setMyBorder(b.id);
      setCurrentBorder(r.border);
    } catch (e: any) {
      setError(e.message || "테두리 변경 실패");
    } finally {
      setSavingBorder(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return icons;
    return icons.filter((i) =>
      (i.card_name || "").toLowerCase().includes(q) ||
      (i.title || "").toLowerCase().includes(q)
    );
  }, [icons, query]);

  const handlePick = async (icon: PublicCardIcon) => {
    setSaving(icon.id);
    setError("");
    try {
      const r = await setMyAvatar(icon.id);
      setCurrent(r.icon);
      setIsDefault(false);
    } catch (e: any) {
      setError(e.message || "변경 실패");
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async () => {
    setSaving(-1);
    try {
      await setMyAvatar(null);
      // Re-fetch to get the default
      const me = await getMyAvatar();
      setCurrent(me.icon);
      setIsDefault(me.is_default_icon);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate("/mypage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← 마이페이지
      </button>
      <h1 className="text-2xl font-bold mb-1">아이콘 설정</h1>
      <p className="text-sm text-gray-500 mb-5">멀티플레이 등에서 표시되는 아이콘을 선택하세요.</p>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4 flex items-center gap-4">
        <Avatar icon={current} border={currentBorder} size={80} />
        <div className="flex-1">
          <p className="font-semibold">현재 아이콘</p>
          <p className="text-sm text-gray-500">
            {current ? (current.title || current.card_name) : "(없음)"}
            {isDefault && " · 기본"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            테두리: {currentBorder?.name || "없음"}
          </p>
        </div>
        {!isDefault && current && (
          <button
            onClick={handleReset}
            disabled={saving !== null}
            className="text-sm text-gray-500 hover:underline disabled:opacity-50"
          >
            기본으로
          </button>
        )}
      </div>

      {borders.length > 1 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 mb-4">
          <h2 className="font-semibold mb-3 text-sm">테두리</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {borders.map((b) => {
              const isSelected = currentBorder?.id === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => handlePickBorder(b)}
                  disabled={savingBorder !== null}
                  className={`flex flex-col items-center p-2 rounded-lg border-2 transition ${
                    isSelected
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                      : "border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <Avatar icon={current} border={b} size={56} />
                  <span className="text-xs mt-1 truncate w-full text-center">{b.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔍 아이콘 검색"
        className="w-full px-4 py-2 mb-4 border rounded-lg bg-white dark:bg-gray-800 text-sm"
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-500">로딩 중...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-3">
            {query ? "검색 결과가 없습니다." : "보유한 아이콘이 없습니다."}
          </p>
          {!query && (
            <button
              onClick={() => navigate("/playground/icon-shop")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
            >
              아이콘 샵 둘러보기 →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {filtered.map((icon) => {
            const isSelected = current?.id === icon.id;
            return (
              <button
                key={icon.id}
                onClick={() => handlePick(icon)}
                disabled={saving !== null}
                className={`flex flex-col items-center p-2 rounded-lg border-2 transition ${
                  isSelected
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Avatar icon={icon} border={currentBorder} size={64} />
                <span className="text-xs mt-1 truncate w-full text-center">
                  {icon.title || icon.card_name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
