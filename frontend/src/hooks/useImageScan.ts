import { useEffect, useRef, useState } from "react";
import { getCardsByIds, type CardListItem } from "@/api/cardDexApi";

export type ScanFound = { card: CardListItem; count: number };
export type ScanStatus =
  | { kind: "idle" } | { kind: "uploading"; percent: number } | { kind: "analyzing" } | { kind: "done" } | { kind: "error"; message: string };

/** Sends the picture to the deck scanner, telling how much of it has gone up (fetch cannot), then that it is being
 *  read; resolves with the scanner's rows. */
function scanPicture(file: File, onProgress: (s: ScanStatus) => void): Promise<{ card_id: number | null }[]> {
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

/** AI 이미지 검색's state (참혈 2026-10-14, shared with the deck builder 2026-10-16): a picture of one card or a deck
 *  list — chosen, dropped, or pasted anywhere while `listening` — goes to the deck scanner (/api/classify-deck/, once
 *  every ten seconds), and the cards it names come back, each once with how many. The file input's props go on a
 *  hidden <input>; drop's on the area a picture may be dropped on. */
export function useImageScan(listening: boolean) {
  const [status, setStatus] = useState<ScanStatus>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [found, setFound] = useState<ScanFound[]>([]);
  const [unknown, setUnknown] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status.kind === "uploading" || status.kind === "analyzing";

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

  // a picture pasted anywhere while the search is open is read too
  useEffect(() => {
    if (!listening) return;
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
  return {
    status, preview, found, unknown, dragging, busy, choose,
    recognized: found.reduce((n, f) => n + f.count, 0),
    fileInput: {
      ref: fileInput,
      type: "file",
      accept: "image/*",
      className: "hidden",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) scan(f);
      },
    },
    drop: {
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
    },
  };
}

export type ImageScan = ReturnType<typeof useImageScan>;
