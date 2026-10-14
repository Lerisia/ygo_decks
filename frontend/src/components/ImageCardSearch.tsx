import { useEffect, useRef, useState } from "react";
import { getCardsByIds, type CardListItem } from "@/api/cardDexApi";
import { cardTag } from "@/lib/cardTag";

type Found = { card: CardListItem; count: number };
type Status = "idle" | "scanning" | "done" | "error";

/** AI 이미지 검색 in the card search's drop-down (/dev/cards, 참혈 2026-10-14): a picture of one card or a deck list
 *  — chosen, dropped or pasted — goes to the deck scanner (/api/classify-deck/, once every ten seconds), and the
 *  cards it names come back as rows like the typed suggestions; picking one opens its page. */
export default function ImageCardSearch({ onPickCard, onClose }: { onPickCard: (id: number) => void; onClose: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [unknown, setUnknown] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const scan = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatus("error");
      setError("사진 파일만 올릴 수 있습니다.");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setStatus("scanning");
    setError("");
    setFound([]);
    setUnknown(0);
    const form = new FormData();
    form.append("image", file);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("/api/classify-deck/", {
        method: "POST",
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("error");
        setError(res.status === 429 && data?.error ? data.error : "사진을 읽지 못했습니다.");
        return;
      }
      const rows: { card_id: number | null }[] = data?.result ?? [];
      // a deck list holds a card up to three times: one row each, with how many
      const counts = new Map<number, number>();
      for (const r of rows) if (r.card_id != null) counts.set(r.card_id, (counts.get(r.card_id) ?? 0) + 1);
      const cards = counts.size ? await getCardsByIds([...counts.keys()]) : [];
      const byId = new Map(cards.map((c) => [c.id, c]));
      setFound([...counts].flatMap(([id, count]) => (byId.has(id) ? [{ card: byId.get(id)!, count }] : [])));
      setUnknown(rows.length - [...counts.values()].reduce((a, b) => a + b, 0));
      setStatus("done");
    } catch {
      setStatus("error");
      setError("사진을 읽지 못했습니다.");
    }
  };

  // a picture pasted anywhere while the panel is open is scanned too
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file && status !== "scanning") {
        e.preventDefault();
        scan(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const choose = () => fileInput.current?.click();

  return (
    <div className="p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">AI 이미지 검색</span>
        <button type="button" onClick={onClose} aria-label="이미지 검색 닫기" className="w-6 h-6 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
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
      <button
        type="button"
        onClick={choose}
        disabled={status === "scanning"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) scan(f);
        }}
        className={`w-full min-h-24 flex items-center justify-center gap-3 rounded-lg border-2 border-dashed px-3 py-3 text-sm transition ${
          dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
        } disabled:cursor-wait`}
      >
        {preview && <img src={preview} alt="" className="h-20 w-auto max-w-[40%] object-contain rounded" />}
        <span className="text-gray-600 dark:text-gray-300 break-keep text-left">
          {status === "scanning" ? (
            "카드를 찾는 중…"
          ) : preview ? (
            "다른 사진 고르기"
          ) : (
            <>
              <span className="font-semibold">사진 고르기</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">카드 한 장이나 덱 리스트 사진 · 끌어 놓거나 붙여 넣어도 됩니다</span>
            </>
          )}
        </span>
      </button>
      {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {status === "done" && (
        found.length ? (
          <ul className="flex flex-col max-h-72 overflow-y-auto overscroll-contain -mx-3">
            {found.map(({ card, count }) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => onPickCard(card.id)}
                  className="w-full px-3 py-1.5 flex items-center gap-2.5 text-sm text-left hover:bg-blue-50 dark:hover:bg-gray-700"
                >
                  <img src={card.face_thumb_url || card.thumb_url || card.image_url || ""} alt="" loading="lazy" className="w-8 aspect-[704/1024] object-contain card-corner shrink-0" />
                  <span className="shrink-0 w-10 text-center rounded text-[11px] leading-5 font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {cardTag(card)}
                  </span>
                  <span className="min-w-0 flex-1 break-keep">{card.name}</span>
                  {count > 1 && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">×{count}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">사진에서 카드를 찾지 못했습니다.</p>
        )
      )}
      {status === "done" && unknown > 0 && found.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">알아보지 못한 카드 {unknown}장</p>
      )}
    </div>
  );
}
