import { Suspense, useEffect } from "react";
import { lazyChunk } from "@/lib/lazyChunk";
import type { FinishParams, FinishStyle } from "@/lib/cardFinish";

const CardFinishCanvas = lazyChunk(() => import("@/components/CardFinishCanvas"));

/** A card filling the screen, in its finish (샤인 / 로얄 drawn with the game's shaders); a tap or Esc closes it. The
 *  card page and the pack simulator's results share it. */
export default function CardZoom({ src, alt, finish, params, onClose }: {
  src: string; alt: string; finish: "normal" | FinishStyle; params: FinishParams; onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      {finish === "normal" ? (
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain card-corner" />
      ) : (
        <Suspense fallback={<img src={src} alt={alt} className="max-h-full max-w-full object-contain card-corner" />}>
          <CardFinishCanvas faceUrl={src} style={finish} params={params} alt={alt} className="block aspect-[704/1024] w-[min(100%,704px,calc((100svh_-_2rem)*0.6875))] card-corner" />
        </Suspense>
      )}
    </div>
  );
}
