import { useEffect, useState } from "react";
import type { PublicCardIcon } from "@/api/avatarApi";

interface Props {
  icon: PublicCardIcon | null;
  size?: number;
  className?: string;
}

/** Renders a circular crop of a card illustration as the user avatar.
 *  Falls back to a generic gray placeholder when icon is null.
 */
export default function Avatar({ icon, size = 48, className = "" }: Props) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!icon?.card_image_url) { setDims(null); return; }
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = icon.card_image_url;
  }, [icon?.card_image_url]);

  if (!icon || !icon.card_image_url) {
    return (
      <div
        className={`rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-gray-500" style={{ fontSize: size / 2 }}>?</span>
      </div>
    );
  }

  let bgWidth = size, bgHeight = size, bgX = 0, bgY = 0;
  if (dims) {
    const minDim = Math.min(dims.w, dims.h);
    const cropDiameter = 2 * icon.radius * minDim;
    const scale = size / cropDiameter;
    bgWidth = dims.w * scale;
    bgHeight = dims.h * scale;
    bgX = -(icon.center_x * dims.w * scale - size / 2);
    bgY = -(icon.center_y * dims.h * scale - size / 2);
  }

  return (
    <div
      className={`rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${icon.card_image_url})`,
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
        backgroundPosition: `${bgX + 1}px ${bgY}px`,
        backgroundRepeat: "no-repeat",
      }}
      aria-label={icon.title || icon.card_name}
    />
  );
}
