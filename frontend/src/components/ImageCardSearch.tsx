import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import LogoLoader from "@/components/LogoLoader";
import { cardTag } from "@/lib/cardTag";
import { type ImageScan, type ScanStatus, useImageScan } from "@/hooks/useImageScan";

// as tall as the typed suggestions at their fullest (ten rows and the hint line), and always so (참혈 2026-10-14)
export const IMAGE_SEARCH_HEIGHT = "h-[396px]";

/** The picture sent, large over the page (참혈 2026-10-16): ✕ at its top right, a press outside it or Esc closes it.
 *  At the body's end, so no blurred floating panel holds it in, and marked as the card search's own overlay
 *  (data-dex-overlay) so a press on it does not close the search under it. */
export function PicturePreview({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    // ahead of the search's own Esc, which would close the search too
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return createPortal(
    <div
      data-dex-overlay
      role="dialog"
      aria-modal="true"
      aria-label="올린 사진"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="올린 사진" className="block max-w-[calc(100vw-2rem)] max-h-[calc(100svh-2rem)] object-contain rounded-lg shadow-2xl" />
        <button
          type="button"
          onClick={onClose}
          aria-label="미리보기 닫기"
          className="absolute top-2 right-2 w-8 h-8 p-0 grid place-items-center rounded-full border-0 bg-black/60 text-white text-sm leading-none hover:bg-black/80"
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** One row on phones and computers alike (참혈 2026-10-16): the picture sent as a small thumbnail — pressed, shown
 *  large — how many cards were read, and 다른 사진 at the right end. compact: a size smaller, for the deck builder's
 *  narrow column. */
export function ScanInfoRow({ scan, compact = false, className = "" }: { scan: ImageScan; compact?: boolean; className?: string }) {
  const [big, setBig] = useState(false);
  return (
    <div className={`flex items-center ${compact ? "gap-2 text-xs" : "gap-2.5 text-sm"} ${className}`}>
      {scan.preview && (
        <button type="button" onClick={() => setBig(true)} aria-label="올린 사진 크게 보기" title="크게 보기" className="shrink-0 p-0 border-0 rounded bg-transparent">
          <img src={scan.preview} alt="올린 사진" className={`block h-7 w-auto ${compact ? "max-w-[3.5rem]" : "max-w-[5.5rem]"} object-cover rounded`} />
        </button>
      )}
      <span className="min-w-0 truncate">
        <span className="font-semibold">인식된 카드 {scan.recognized}장</span>
        {/* short, so the row stays one line in the deck builder's narrow column and on phones */}
        {scan.unknown > 0 && <span className="text-xs text-gray-500 dark:text-gray-400"> · 미인식 {scan.unknown}장</span>}
      </span>
      <button
        type="button"
        onClick={scan.choose}
        className={`ml-auto shrink-0 h-7 ${compact ? "px-2" : "px-2.5"} rounded-md text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700`}
      >
        다른 사진
      </button>
      {big && scan.preview && <PicturePreview src={scan.preview} onClose={() => setBig(false)} />}
    </div>
  );
}

/** Before a picture, while it goes up and is read, and when it could not be: the place to choose or drop one, the
 *  logo loader saying which, or why with 다시 고르기. small: in one row of cards (the deck builder below lg). */
export function ScanState({ scan, small = false, className = "" }: { scan: ImageScan; small?: boolean; className?: string }) {
  const { status } = scan;
  if (status.kind === "idle") {
    return (
      <button
        type="button"
        onClick={scan.choose}
        className={`w-full flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 text-sm transition ${
          scan.dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
        } ${className}`}
      >
        <span className="font-semibold text-gray-700 dark:text-gray-200">사진 고르기</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 break-keep text-center">
          카드 한 장이나 덱 리스트 사진{small ? "" : " · 끌어 놓거나 붙여 넣어도 됩니다"}
        </span>
      </button>
    );
  }
  if (status.kind === "uploading" || status.kind === "analyzing") {
    return (
      <div className={`flex items-center justify-center ${small ? "gap-2" : "flex-col gap-3"} ${className}`} aria-live="polite">
        <LogoLoader size={small ? 56 : 120} label={status.kind === "analyzing" ? "분석 중" : "업로드 중"} />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{busyText(status)}</span>
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <div className={`flex items-center justify-center text-center ${small ? "gap-3" : "flex-col gap-3"} ${className}`}>
        <p className="m-0 text-sm text-red-600 dark:text-red-400 break-keep">{status.message}</p>
        <button type="button" onClick={scan.choose} className="shrink-0 h-9 px-4 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">다시 고르기</button>
      </div>
    );
  }
  return null;
}

const busyText = (s: Extract<ScanStatus, { kind: "uploading" | "analyzing" }>) =>
  s.kind === "analyzing" ? "분석 중…" : `업로드 중… ${s.percent}%`;

/** AI 이미지 검색 in the card search's drop-down (/dev/cards, 참혈 2026-10-14): the picture goes to the deck scanner
 *  (useImageScan) and the cards it names come back; picking one opens its page. The panel keeps one height
 *  throughout. While the picture goes up and is read, the logo loader says which. Then one row with the picture,
 *  how many cards were read and 다른 사진 (phones too from 2026-10-16, the large picture gone — pressing the small one
 *  shows it), and the cards: from sm as rows like the typed suggestions, on a phone as card pictures, rows of five
 *  that scroll down in the room the large picture had. */
export default function ImageCardSearch({ onPickCard, onClose }: { onPickCard: (id: number) => void; onClose: () => void }) {
  const scan = useImageScan(true);
  const { status, found } = scan;

  return (
    <div className={`${IMAGE_SEARCH_HEIGHT} p-3 flex flex-col gap-2.5`} {...scan.drop}>
      <div className="shrink-0 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">AI 이미지 검색</span>
        <button type="button" onClick={onClose} aria-label="이미지 검색 닫기" className="w-7 h-7 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
      </div>
      <input {...scan.fileInput} />

      <ScanState scan={scan} className="flex-1 min-h-0" />

      {status.kind === "done" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <ScanInfoRow scan={scan} className="shrink-0 h-9 sm:px-3 border-b border-gray-100 dark:border-gray-700" />
          {found.length ? (
            <>
              <ul className="hidden sm:block flex-1 min-h-0 overflow-y-auto overscroll-contain py-1">
                {found.map(({ card, count }) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => onPickCard(card.id)}
                      className="w-full px-3 py-2 border-0 rounded-none bg-transparent flex items-center justify-between gap-3 text-sm text-left hover:bg-blue-50 dark:hover:bg-gray-700"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 w-10 text-center rounded text-[11px] leading-5 font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {cardTag(card)}
                        </span>
                        <span className="break-keep">{card.name}</span>
                      </span>
                      {count > 1 && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">×{count}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <ul className="sm:hidden flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 grid grid-cols-5 gap-1.5 content-start">
                {found.map(({ card, count }) => (
                  <li key={card.id}>
                    <button type="button" onClick={() => onPickCard(card.id)} title={card.name} aria-label={`${card.name} 열기`} className="relative block w-full p-0 border-0 bg-transparent">
                      <img src={card.face_thumb_url || card.thumb_url || card.image_url || ""} alt={card.name} loading="lazy" className="w-full aspect-[704/1024] object-contain card-corner" />
                      {count > 1 && (
                        <span className="absolute bottom-1 right-1 rounded px-1 text-[10px] leading-4 font-bold bg-black/75 text-white tabular-nums">×{count}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">사진에서 카드를 찾지 못했습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
