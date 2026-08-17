import { useState } from "react";
import Avatar from "@/components/Avatar";
import type { PublicCardIcon, Border } from "@/api/avatarApi";
import type { CapturedTurn } from "@/components/multiplayer/DuchMindGameView";

export type RankedPlayer = {
  player: {
    id: number;
    display_name: string;
    avatar_icon: PublicCardIcon | null;
    border: Border | null;
  };
  score: number;
  points_awarded: number;
};

interface Props {
  ranked: RankedPlayer[];
  gameLabel?: string;
  onBackToLobby: () => void;
  // DuchMind-only: per-turn capture gallery (drawing + answer card + drawer).
  // Persisted only in memory — clicking back-to-lobby drops it.
  gallery?: CapturedTurn[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Compose drawing + answer card + label into one PNG and trigger a download.
// Falls back to drawing-only if the card image fails to load (CORS, 404, etc).
async function downloadComposite(cap: CapturedTurn) {
  let drawingImg: HTMLImageElement;
  try {
    drawingImg = await loadImage(cap.drawingDataUrl);
  } catch {
    return;
  }
  let cardImg: HTMLImageElement | null = null;
  if (cap.cardImageUrl) {
    try { cardImg = await loadImage(cap.cardImageUrl); } catch { cardImg = null; }
  }
  const dW = drawingImg.naturalWidth || 1280;
  const dH = drawingImg.naturalHeight || 800;
  const gap = 16;
  const labelH = 56;
  const cardH = dH;
  // Match typical card aspect (~0.69) so it doesn't squish.
  const cardW = cardImg ? Math.round(cardH * (cardImg.naturalWidth / cardImg.naturalHeight)) : 0;
  const totalW = dW + (cardImg ? gap + cardW : 0);
  const totalH = dH + labelH;
  const cv = document.createElement("canvas");
  cv.width = totalW;
  cv.height = totalH;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.drawImage(drawingImg, 0, 0, dW, dH);
  if (cardImg) ctx.drawImage(cardImg, dW + gap, 0, cardW, cardH);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(`${cap.drawerName}의 그림 — 정답: ${cap.word}`, 16, dH + labelH / 2);
  let url = "";
  try { url = cv.toDataURL("image/png"); } catch { return; }
  if (!url) return;
  const safeName = `${cap.drawerName}_${cap.word}`.replace(/[^\w가-힣]+/g, "_").slice(0, 60);
  const a = document.createElement("a");
  a.href = url;
  a.download = `duchmind_${safeName}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function GalleryCard({ cap }: { cap: CapturedTurn }) {
  const [busy, setBusy] = useState(false);
  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try { await downloadComposite(cap); } finally { setBusy(false); }
  };
  return (
    <div className="border-2 border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className="grid grid-cols-[2fr_1fr] gap-1 bg-gray-50 dark:bg-gray-800 p-1">
        <img
          src={cap.drawingDataUrl}
          alt="drawing"
          className="w-full h-auto rounded bg-white object-contain"
        />
        {cap.cardImageUrl ? (
          <img
            src={cap.cardImageUrl}
            alt={cap.word}
            className="w-full h-auto rounded object-contain bg-white"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-white rounded">
            (이미지 없음)
          </div>
        )}
      </div>
      <div className="p-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar icon={cap.drawerAvatarIcon} border={cap.drawerBorder} size={24} />
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{cap.drawerName}</div>
            <div className="text-xs text-blue-700 dark:text-blue-400 font-bold truncate">
              정답: {cap.word}
            </div>
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={busy}
          className="shrink-0 px-2 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
          title="그림 + 정답 카드 합쳐서 PNG로 저장"
        >
          {busy ? "..." : "💾 저장"}
        </button>
      </div>
    </div>
  );
}

export default function GameResultScreen({ ranked, gameLabel, onBackToLobby, gallery }: Props) {
  const handleLeave = () => {
    if (!confirm("로비로 돌아가면 이 결과 화면(그림 갤러리 포함)을 다시 볼 수 없습니다.\n계속하시겠습니까?")) return;
    onBackToLobby();
  };
  return (
    <div className="bg-white dark:bg-gray-800 sm:rounded-xl sm:shadow px-3 py-5 sm:p-6">
      <h2 className="text-2xl font-bold text-center mb-1">🏆 게임 종료</h2>
      {gameLabel && (
        <p className="text-center text-sm text-gray-500 mb-5">{gameLabel}</p>
      )}

      {ranked.length === 0 ? (
        <p className="text-center text-sm text-gray-500 mb-5">결과 데이터가 없습니다.</p>
      ) : (
        <div className="space-y-2 mb-5">
          {ranked.map((entry, i) => (
            <div
              key={entry.player.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                i === 0 ? "bg-yellow-100 dark:bg-yellow-900/30"
                : i === 1 ? "bg-gray-100 dark:bg-gray-700"
                : i === 2 ? "bg-orange-100 dark:bg-orange-900/30"
                : "bg-gray-50 dark:bg-gray-900"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-lg w-7 text-center shrink-0">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                </span>
                <Avatar icon={entry.player.avatar_icon} border={entry.player.border} size={36} />
                <span className="font-semibold truncate">{entry.player.display_name}</span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="font-bold text-lg leading-tight">{entry.score}점</span>
                {entry.points_awarded > 0 && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    +{entry.points_awarded}P
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {gallery && gallery.length > 0 && (
        <div className="mb-5">
          <h3 className="text-lg font-bold mb-2">🎨 이번 판 그림들</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            저장 버튼을 누르면 그림 + 정답 카드가 합쳐진 PNG로 저장돼요.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {gallery.map((cap) => <GalleryCard key={cap.id} cap={cap} />)}
          </div>
        </div>
      )}

      <button
        onClick={handleLeave}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-base hover:bg-blue-700 transition"
      >
        ← 로비로 돌아가기
      </button>
    </div>
  );
}
