import type { CardDoc } from "@/api/cardDexApi";

/** A deck cover made from a card's Master Duel art, picked in the card book (특이점 2026-10-17). Covers are square, so a
 *  taller art (펜듈럼 512×653, 오버프레임 512×1024) gives the square at its top, middle or bottom. */
export type CoverSpot = "top" | "center" | "bottom";
export const COVER_SPOTS: { key: CoverSpot; label: string }[] = [
  { key: "top", label: "위" },
  { key: "center", label: "가운데" },
  { key: "bottom", label: "아래" },
];
const SPOT_AT: Record<CoverSpot, number> = { top: 0, center: 0.5, bottom: 1 };

type Art = CardDoc["arts"][number];

/** 기본 / 다른 일러 n / 오버프레임 (n counts the card's prints, as on the card page), and 일본판 / 한국판 when the regions
 *  differ. */
export function artLabels(arts: Art[]) {
  const prints = [...new Set(arts.map((a) => a.id))];
  return arts.map((a) => {
    const i = prints.indexOf(a.id);
    return {
      print: a.overframe ? "오버프레임" : i === 0 ? "기본 일러스트" : `다른 일러 ${i}`,
      version: a.version === "ocg" ? "일본판" : a.version === "tcg" ? "한국판" : "",
    };
  });
}

/** Where the square comes from in the art's pixels. An 오버프레임 art is kept squeezed to 512 wide; on the card it is
 *  704 wide, so the square is drawn back out to that. */
export function coverCrop(w: number, h: number, overframe: boolean, spot: CoverSpot) {
  const shownW = overframe ? (h * 704) / 1024 : w;
  const side = Math.min(shownW, h);
  const sw = (side * w) / shownW;
  return { sx: (w - sw) / 2, sy: (h - side) * SPOT_AT[spot], sw, sh: side, side: Math.round(side) };
}

export const defaultSpot = (overframe: boolean): CoverSpot => (overframe ? "center" : "top");

/** The cover file to upload: a square art as it is, any other cut to the square. */
export async function cardArtCover(art: Art, spot: CoverSpot): Promise<File> {
  const res = await fetch(art.url);
  if (!res.ok) throw new Error("일러스트를 불러오지 못했습니다.");
  const blob = await res.blob();
  const name = `card-${art.id}-${art.version}`;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width === bitmap.height && !art.overframe) {
      return new File([blob], `${name}.webp`, { type: blob.type || "image/webp" });
    }
    const c = coverCrop(bitmap.width, bitmap.height, art.overframe, spot);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = c.side;
    canvas.getContext("2d")?.drawImage(bitmap, c.sx, c.sy, c.sw, c.sh, 0, 0, c.side, c.side);
    const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!png) throw new Error("일러스트를 자르지 못했습니다.");
    return new File([png], `${name}.png`, { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
