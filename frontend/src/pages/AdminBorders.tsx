import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createBorder, deleteBorder, getMyAvatar, listAdminBorders, replaceBorderImage, updateBorder,
  type Border, type IconCategory, type IconRarity, type PublicCardIcon,
} from "@/api/avatarApi";
import { RARITY_LABEL } from "@/api/cardIconApi";
import Avatar, { BORDER_THICKNESS_RATIO_IMAGE } from "@/components/Avatar";

const CATEGORY_LABEL: Record<IconCategory, string> = {
  default: "기본 지급",
  shop: "상점 판매",
  exclusive: "비매품",
};
const BORDER_RARITIES = ["rare", "epic", "legendary"] as const;

// What an uploaded frame has to be. The server checks the same things; the numbers come from how Avatar draws it.
const FRAME_SIZE = 512;
const FRAME_MIN_SIZE = 256;
const ICON_SHARE = 1 - BORDER_THICKNESS_RATIO_IMAGE * 2;
const ICON_DIAMETER = Math.round(FRAME_SIZE * ICON_SHARE);
const RING_WIDTH = Math.round(FRAME_SIZE * BORDER_THICKNESS_RATIO_IMAGE);
const PREVIEW_SIZES = [80, 48, 32];
const CHECKER =
  "repeating-conic-gradient(#d1d5db 0% 25%, #f3f4f6 0% 50%) 50% / 16px 16px";

const SELECT = "text-xs px-1.5 py-1 border rounded bg-white dark:bg-gray-800 disabled:opacity-40";
const SECONDARY = "px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-semibold transition";

type Picked = { file: File; url: string; width: number; height: number };

function pickImage(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 파일이 아닙니다. PNG 또는 WebP로 올려 주세요."));
    };
    img.src = url;
  });
}

function sizeProblem(p: Picked): string | null {
  if (p.width !== p.height) return `정사각형이어야 합니다. (고른 이미지: ${p.width}×${p.height})`;
  if (p.width < FRAME_MIN_SIZE) return `한 변이 ${FRAME_MIN_SIZE}px 이상이어야 합니다. (고른 이미지: ${p.width}×${p.height})`;
  return null;
}

export default function AdminBorders() {
  const navigate = useNavigate();
  const [borders, setBorders] = useState<Border[] | null>(null);
  const [myIcon, setMyIcon] = useState<PublicCardIcon | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<IconCategory>("exclusive");
  const [rarity, setRarity] = useState<IconRarity>("rare");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<number | null>(null);

  const load = () =>
    listAdminBorders()
      .then((d) => setBorders(d.borders))
      .catch((e: Error) => {
        setBorders([]);
        setError(e.message || "테두리 목록을 불러오지 못했습니다.");
      });

  useEffect(() => {
    load();
    getMyAvatar().then((d) => setMyIcon(d.icon)).catch(() => {});
  }, []);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url); }, [picked]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadMsg(null);
    if (!file) { setPicked(null); return; }
    try {
      setPicked(await pickImage(file));
    } catch (err) {
      setPicked(null);
      setUploadMsg({ ok: false, text: (err as Error).message });
    }
  };

  const problem = picked ? sizeProblem(picked) : null;
  const canUpload = !!picked && !problem && !!name.trim() && !uploading;

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUpload || !picked) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const b = await createBorder(name.trim(), picked.file, category, category === "shop" ? rarity : "");
      setUploadMsg({ ok: true, text: `'${b.name}' 테두리를 올렸습니다.` });
      setPicked(null);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setUploadMsg({ ok: false, text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  /** Runs one change to a border and puts the server's answer into the list. */
  const change = async (id: number, action: () => Promise<Border | null>) => {
    setBusyId(id);
    setError("");
    try {
      const updated = await action();
      setBorders((prev) =>
        (prev || []).flatMap((b) => (b.id !== id ? [b] : updated ? [{ ...b, ...updated }] : [])),
      );
    } catch (err) {
      setError((err as Error).message || "저장하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const rename = (b: Border) => {
    const next = window.prompt("테두리 이름", b.name)?.trim();
    if (next && next !== b.name) change(b.id, () => updateBorder(b.id, { name: next }));
  };

  const remove = (b: Border) => {
    if (window.confirm(`'${b.name}' 테두리를 지울까요? 되돌릴 수 없습니다.`))
      change(b.id, () => deleteBorder(b.id).then(() => null));
  };

  const onReplacePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = replaceTarget.current;
    e.target.value = "";
    if (file && id != null) change(id, () => replaceBorderImage(id, file));
  };

  const previewBorder: Border | null = picked
    ? { id: 0, key: "preview", name: name || "미리보기", color: "", image_url: picked.url, is_default: false, uploaded: true }
    : null;

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/manage")}
        className="mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline px-2 sm:px-0"
      >
        ← 관리
      </button>
      <h1 className="text-xl font-bold mb-4 px-2 sm:px-0">🖼️ 테두리 관리</h1>

      <form onSubmit={onUpload} className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-4 sm:p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">새 테두리 올리기</h2>

        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <a
            href="/images/border-template.png"
            download="ygodecks-border-template.png"
            className="shrink-0 self-center sm:self-start rounded-lg"
            style={{ background: CHECKER }}
            title="가이드 템플릿 내려받기"
          >
            <img src="/images/border-template.png" alt="테두리 가이드 템플릿" width={160} height={160} />
          </a>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>
              <b>파일</b>: 배경이 투명한 PNG 또는 WebP, 5MB 이하. 움직이는 이미지는 안 됩니다.
            </li>
            <li>
              <b>크기</b>: 정사각형 {FRAME_SIZE}×{FRAME_SIZE}px 권장. {FRAME_MIN_SIZE}px 이상이면 받고, 올리면 {FRAME_SIZE}px로 맞춰 저장합니다.
            </li>
            <li>
              <b>아이콘 자리</b>: 가운데 지름 {ICON_DIAMETER}px(전체의 {Math.round(ICON_SHARE * 100)}%) 원. 투명하게 비워 둡니다.
            </li>
            <li>
              <b>테두리 그림</b>: 그 바깥 폭 {RING_WIDTH}px 고리에 그립니다. 네 귀퉁이까지 써도 됩니다.
            </li>
            <li>
              테두리는 아이콘 <b>위에</b> 덮어 그려집니다. 구멍을 {ICON_DIAMETER}px보다 조금 작게(370px쯤) 뚫으면 틈이 생기지 않고, 장식이 아이콘 가장자리를 살짝 덮어도 됩니다.
            </li>
            <li>32px로 작게 보이는 곳이 많습니다. 가는 선과 작은 글씨는 뭉개집니다.</li>
            <li>
              <a href="/images/border-template.png" download="ygodecks-border-template.png" className="text-blue-600 dark:text-blue-400 hover:underline">
                가이드 템플릿 내려받기
              </a>{" "}
              — 그릴 때 밑에 깔고, 저장할 때는 빼 주세요.
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block mb-1 font-semibold">이미지</span>
            <input
              ref={fileRef}
              id="border-file"
              type="file"
              accept="image/png,image/webp"
              onChange={onPick}
              className="block w-full text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 font-semibold">이름</span>
            <input
              id="border-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="예: 황금 날개"
              className="w-full border rounded-lg px-3 py-2 bg-white text-black dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 font-semibold">구분</span>
            <select
              id="border-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as IconCategory)}
              className="w-full border rounded-lg px-3 py-2 bg-white text-black dark:bg-gray-800 dark:text-white"
            >
              {(["exclusive", "shop", "default"] as IconCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 font-semibold">등급 (상점 판매일 때)</span>
            <select
              id="border-rarity"
              value={rarity}
              onChange={(e) => setRarity(e.target.value as IconRarity)}
              disabled={category !== "shop"}
              className="w-full border rounded-lg px-3 py-2 bg-white text-black dark:bg-gray-800 dark:text-white disabled:opacity-40"
            >
              {BORDER_RARITIES.map((r) => (
                <option key={r} value={r}>{RARITY_LABEL[r]}</option>
              ))}
            </select>
          </label>
        </div>

        {/* The preview keeps its height whether or not a file is picked, so the form below it does not jump. */}
        <div className="mt-4 h-40 flex items-center gap-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 overflow-x-auto">
          {previewBorder && picked ? (
            <>
              <div className="relative shrink-0 rounded-lg" style={{ width: 112, height: 112, background: CHECKER }}>
                <img src={picked.url} alt="" width={112} height={112} />
                <div
                  className="absolute rounded-full border-2 border-dashed border-blue-600 pointer-events-none"
                  style={{ inset: `${BORDER_THICKNESS_RATIO_IMAGE * 100}%` }}
                />
              </div>
              {["bg-white", "bg-gray-900"].map((bg) => (
                <div key={bg} className={`shrink-0 flex items-center gap-3 rounded-lg p-3 ${bg}`}>
                  {PREVIEW_SIZES.map((s) => (
                    <Avatar key={s} icon={myIcon} border={previewBorder} size={s} />
                  ))}
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-gray-400">이미지를 고르면 여기에 미리보기가 나옵니다. 파란 점선은 아이콘 자리입니다.</p>
          )}
        </div>
        <p
          className={`mt-2 min-h-5 text-sm ${
            problem || (uploadMsg && !uploadMsg.ok) ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
          }`}
          aria-live="polite"
        >
          {problem || uploadMsg?.text}
        </p>

        <button
          type="submit"
          disabled={!canUpload}
          className={`mt-2 w-full py-2.5 rounded-lg font-semibold transition ${
            canUpload ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {uploading ? "올리는 중…" : "올리기"}
        </button>
      </form>

      <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-4 sm:p-5">
        <h2 className="text-base font-semibold mb-3">테두리 목록{borders && ` (${borders.length}개)`}</h2>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {borders === null &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-2 h-[104px] border rounded-lg border-gray-200 dark:border-gray-700">
                <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse shrink-0" />
                <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </div>
            ))}
          {borders?.map((b) => {
            const busy = busyId === b.id;
            return (
              <div key={b.id} className="flex items-center gap-3 p-2 min-h-[104px] border rounded-lg border-gray-200 dark:border-gray-700">
                <Avatar icon={myIcon} border={b} size={56} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{b.name}</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    {b.uploaded ? "올린 이미지" : b.key}
                    {b.is_default ? " · 기본" : ""} · 보유 {b.owners ?? 0}명
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
                    <select
                      aria-label={`${b.name} 구분`}
                      value={b.category || "exclusive"}
                      onChange={(e) => change(b.id, () => updateBorder(b.id, { category: e.target.value as IconCategory }))}
                      disabled={busy}
                      className={SELECT}
                    >
                      {(["default", "shop", "exclusive"] as IconCategory[]).map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`${b.name} 등급`}
                      value={b.rarity || ""}
                      onChange={(e) => change(b.id, () => updateBorder(b.id, { rarity: e.target.value as IconRarity }))}
                      disabled={busy || b.category !== "shop"}
                      className={SELECT}
                    >
                      <option value="">(등급 없음)</option>
                      {BORDER_RARITIES.map((r) => (
                        <option key={r} value={r}>{RARITY_LABEL[r]}</option>
                      ))}
                    </select>
                    <span className={`text-xs font-bold ${b.category === "shop" ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>
                      {b.category === "shop" ? `${b.price ?? 0}P` : "—"}
                    </span>
                  </div>
                  {b.uploaded && (
                    <div className="flex gap-3 mt-1.5 text-xs">
                      <button type="button" onClick={() => rename(b)} disabled={busy} className="text-blue-600 dark:text-blue-400 hover:underline">
                        이름 변경
                      </button>
                      <button
                        type="button"
                        onClick={() => { replaceTarget.current = b.id; replaceRef.current?.click(); }}
                        disabled={busy}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        이미지 교체
                      </button>
                      <button type="button" onClick={() => remove(b)} disabled={busy} className="text-red-600 dark:text-red-400 hover:underline">
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <input ref={replaceRef} type="file" accept="image/png,image/webp" onChange={onReplacePicked} className="hidden" />
        <p className="text-[11px] text-gray-400 mt-3">
          상점 판매로 바꾸면 등급에서 가격이 자동으로 정해집니다. 올린 테두리는 이름·이미지를 바꿀 수 있고, 가진 이용자가 없을 때만 지울 수 있습니다. 사이트가 직접 그리는 기본 테두리는 등급·가격만 바꿀 수 있습니다.
        </p>
        <button type="button" onClick={() => navigate("/manage/card-icons")} className={`${SECONDARY} mt-4`}>
          아이콘 관리로
        </button>
      </div>
    </div>
  );
}
