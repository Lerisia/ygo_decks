import { useEffect, useState } from "react";
import type { PublicCardIcon, Border } from "@/api/avatarApi";

interface Props {
  icon: PublicCardIcon | null;
  border?: Border | null;
  size?: number;
  className?: string;
}

const BORDER_THICKNESS_RATIO = 0.05; // ring thickness as fraction of size

/** Renders a circular crop of a card illustration as the user avatar.
 *  Falls back to a generic gray placeholder when icon is null.
 */
export default function Avatar({ icon, border, size = 48, className = "" }: Props) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!icon?.card_image_url) { setDims(null); return; }
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = icon.card_image_url;
  }, [icon?.card_image_url]);

  // Border ring takes thickness from total size; inner icon shrinks accordingly.
  const ringThickness = border ? Math.max(2, Math.round(size * BORDER_THICKNESS_RATIO)) : 0;
  const innerSize = size - ringThickness * 2;

  // Compute background positioning for the inner icon (innerSize)
  let bgWidth = innerSize, bgHeight = innerSize, bgX = 0, bgY = 0;
  if (icon && dims) {
    const minDim = Math.min(dims.w, dims.h);
    const cropDiameter = 2 * icon.radius * minDim;
    const scale = innerSize / cropDiameter;
    bgWidth = dims.w * scale;
    bgHeight = dims.h * scale;
    bgX = -(icon.center_x * dims.w * scale - innerSize / 2);
    bgY = -(icon.center_y * dims.h * scale - innerSize / 2);
  }

  // Wrapper handles the ring; inner div renders the icon
  const ringStyle: React.CSSProperties = border
    ? border.image_url
      ? { backgroundImage: `url(${border.image_url})`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" }
      : { background: border.color || "#ffffff" }
    : {};

  return (
    <div
      className={`rounded-full flex items-center justify-center ${className}`}
      style={{ width: size, height: size, ...ringStyle }}
      aria-label={icon ? (icon.title || icon.card_name) : undefined}
    >
      {(!icon || !icon.card_image_url) ? (
        <div
          className="rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center"
          style={{ width: innerSize, height: innerSize }}
        >
          <span className="text-gray-500" style={{ fontSize: innerSize / 2 }}>?</span>
        </div>
      ) : (
        <div
          className="rounded-full bg-gray-200 dark:bg-gray-700"
          style={{
            width: innerSize,
            height: innerSize,
            backgroundImage: `url(${icon.card_image_url})`,
            backgroundSize: `${bgWidth}px ${bgHeight}px`,
            backgroundPosition: `${bgX + 2}px ${bgY}px`,
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
    </div>
  );
}
