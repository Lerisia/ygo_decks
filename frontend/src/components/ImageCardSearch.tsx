import { useEffect, useRef, useState } from "react";
import { getCardsByIds, type CardListItem } from "@/api/cardDexApi";
import LogoLoader from "@/components/LogoLoader";
import { cardTag } from "@/lib/cardTag";

type Found = { card: CardListItem; count: number };
type Status = { kind: "idle" } | { kind: "uploading"; percent: number } | { kind: "analyzing" } | { kind: "done" } | { kind: "error"; message: string };

// as tall as the typed suggestions at their fullest (ten rows and the hint line), and always so (참혈 2026-10-14)
export const IMAGE_SEARCH_HEIGHT = "h-[396px]";

/** Sends the picture to the deck scanner, telling how much of it has gone up (fetch cannot), then that it is being
 *  read; resolves with the scanner's rows. */
function scanPicture(file: File, onProgress: (s: Status) => void): Promise<{ card_id: number | null }[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/classify-deck/");
    const token = localStorage.getItem("access_token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      onProgress(percent >= 100 ? { kind: "analyzing" } : { kind: "uploading", percent });
    };
    xhr.upload.onload = () => onProgress({ kind: "analyzing" });
    xhr.onload = () => {
      let data: { result?: { card_id: number | null }[]; error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data?.result ?? []);
      else reject(new Error(xhr.status === 429 && data?.error ? data.error : "사진을 읽지 못했습니다."));
    };
    xhr.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    const form = new FormData();
    form.append("image", file);
    onProgress({ kind: "uploading", percent: 0 });
    xhr.send(form);
  });
}

/** AI 이미지 검색 in the card search's drop-down (/dev/cards, 참혈 2026-10-14): a picture of one card or a deck list
 *  — chosen, dropped or pasted — goes to the deck scanner (/api/classify-deck/, once every ten seconds), and the
 *  cards it names come back; picking one opens its page. The panel keeps one height throughout. While the picture
 *  goes up and is read, the logo loader says which. Then, from sm, a row with the picture and how many cards were
 *  read, and the cards as rows like the typed suggestions; on a phone the picture above and the cards below in one
 *  row that scrolls sideways, as card pictures like the deck builder's search. */
export default function ImageCardSearch({ onPickCard, onClose }: { onPickCard: (id: number) => void; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [unknown, setUnknown] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status.kind === "uploading" || status.kind === "analyzing";
  const recognized = found.reduce((n, f) => n + f.count, 0);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const scan = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatus({ kind: "error", message: "사진 파일만 올릴 수 있습니다." });
      return;
    }
    setPreview(URL.createObjectURL(file));
    setFound([]);
    setUnknown(0);
    try {
      const rows = await scanPicture(file, setStatus);
      // a deck list holds a card up to three times: one each, with how many
      const counts = new Map<number, number>();
      for (const r of rows) if (r.card_id != null) counts.set(r.card_id, (counts.get(r.card_id) ?? 0) + 1);
      const cards = counts.size ? await getCardsByIds([...counts.keys()]) : [];
      const byId = new Map(cards.map((c) => [c.id, c]));
      setFound([...counts].flatMap(([id, count]) => (byId.has(id) ? [{ card: byId.get(id)!, count }] : [])));
      setUnknown(rows.length - [...counts.values()].reduce((a, b) => a + b, 0));
      setStatus({ kind: "done" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "사진을 읽지 못했습니다." });
    }
  };

  // a picture pasted anywhere while the panel is open is read too
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file && !busy) {
        e.preventDefault();
        scan(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const choose = () => !busy && fileInput.current?.click();
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f && !busy) scan(f);
    },
  };

  const picture = preview && <img src={preview} alt="올린 사진" className="w-full h-full object-contain rounded-md" />;

  return (
    <div className={`${IMAGE_SEARCH_HEIGHT} p-3 flex flex-col gap-2.5`} {...drop}>
      <div className="shrink-0 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">AI 이미지 검색</span>
        <span className="flex items-center gap-1">
          {(status.kind === "done" || status.kind === "error") && (
            <button type="button" onClick={choose} className="h-7 px-2.5 rounded-md text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700">
              다른 사진
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="이미지 검색 닫기" className="w-7 h-7 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
        </span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) scan(f);
        }}
      />

      {status.kind === "idle" && (
        <button
          type="button"
          onClick={choose}
          className={`flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 text-sm transition ${
            dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
          }`}
        >
          <span className="font-semibold text-gray-700 dark:text-gray-200">사진 고르기</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 break-keep text-center">카드 한 장이나 덱 리스트 사진 · 끌어 놓거나 붙여 넣어도 됩니다</span>
        </button>
      )}

      {busy && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3" aria-live="polite">
          <LogoLoader size={120} label={status.kind === "analyzing" ? "분석 중" : "업로드 중"} />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
            {status.kind === "analyzing" ? "분석 중…" : `업로드 중… ${status.percent}%`}
          </span>
        </div>
      )}

      {status.kind === "error" && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 break-keep">{status.message}</p>
          <button type="button" onClick={choose} className="h-9 px-4 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">다시 고르기</button>
        </div>
      )}

      {status.kind === "done" && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* from sm (참혈 2026-10-14, the side-by-side dropped): the picture in a row as tall as a suggestion, how many
              cards were read beside it, then the cards as rows like the typed suggestions */}
          <div className="hidden sm:flex shrink-0 h-9 px-3 items-center gap-2.5 text-sm border-b border-gray-100 dark:border-gray-700">
            {preview && <img src={preview} alt="올린 사진" className="h-7 w-auto max-w-[5.5rem] object-cover rounded" />}
            <span className="font-semibold">인식된 카드 {recognized}장</span>
            {unknown > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">· 알아보지 못한 카드 {unknown}장</span>}
          </div>
          {found.length ? (
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
          ) : (
            <p className="hidden sm:flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">사진에서 카드를 찾지 못했습니다.</p>
          )}

          {/* phones, as before: the picture above, the cards below in one row of card pictures that scrolls sideways */}
          <div className="sm:hidden flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-900/40 rounded-md">{picture}</div>
            {found.length ? (
              <ul className="shrink-0 flex gap-1.5 overflow-x-auto overscroll-contain pb-1">
                {found.map(({ card, count }) => (
                  <li key={card.id} className="shrink-0">
                    <button type="button" onClick={() => onPickCard(card.id)} title={card.name} aria-label={`${card.name} 열기`} className="relative block w-16">
                      <img src={card.face_thumb_url || card.thumb_url || card.image_url || ""} alt={card.name} loading="lazy" className="w-full aspect-[704/1024] object-contain card-corner" />
                      {count > 1 && (
                        <span className="absolute bottom-1 right-1 rounded px-1 text-[10px] leading-4 font-bold bg-black/75 text-white tabular-nums">×{count}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="shrink-0 text-sm text-center text-gray-500 dark:text-gray-400">사진에서 카드를 찾지 못했습니다.</p>
            )}
            <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
              인식된 카드 {recognized}장{unknown > 0 && ` · 알아보지 못한 카드 ${unknown}장`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
