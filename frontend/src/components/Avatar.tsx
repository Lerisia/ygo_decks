import { useEffect, useState } from "react";
import type { Border } from "@/api/avatarApi";
import AnimatedBorder from "./AnimatedBorder";

const ANIMATED_BORDER_KEYS = ["fire", "water", "wind", "earth", "light", "dark", "labrynth", "melodious", "skystriker"] as const;
type AnimatedKey = (typeof ANIMATED_BORDER_KEYS)[number];
const isAnimatedKey = (k: string | undefined): k is AnimatedKey =>
  !!k && (ANIMATED_BORDER_KEYS as readonly string[]).includes(k);

// Overlay borders cover the icon (icon stays full-size, decorations float on top).
const OVERLAY_BORDER_KEYS = new Set(["melodious", "skystriker"]);

export type AvatarIcon = {
  title?: string;
  card_name?: string;
  card_image_url: string | null;
  // Server-side pre-cropped square (256x256). When present, the Avatar can
  // skip per-icon positioning math entirely and just render the image.
  cropped_image_url?: string | null;
  center_x: number;
  center_y: number;
  radius: number;
};

interface Props {
  icon: AvatarIcon | null;
  border?: Border | null;
  size?: number;
  className?: string;
}

// Solid-color borders use a thin ring; image borders need more room for the artwork.
const BORDER_THICKNESS_RATIO_PLAIN = 0.05;
const BORDER_THICKNESS_RATIO_IMAGE = 0.13;

// Cache natural dimensions per URL across all Avatar instances so we don't
// decode the same image dozens of times on shop/admin pages.
const dimsCache = new Map<string, { w: number; h: number }>();
const dimsPending = new Map<string, Promise<{ w: number; h: number }>>();

function loadDims(url: string): Promise<{ w: number; h: number }> {
  const cached = dimsCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = dimsPending.get(url);
  if (inflight) return inflight;
  const p = new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight };
      dimsCache.set(url, dims);
      dimsPending.delete(url);
      resolve(dims);
    };
    img.onerror = (e) => {
      dimsPending.delete(url);
      reject(e);
    };
    img.src = url;
  });
  dimsPending.set(url, p);
  return p;
}

/** Renders a circular crop of a card illustration as the user avatar.
 *  Falls back to a generic gray placeholder when icon is null.
 */
// All cropped card illustrations are stored at 624×624. Skipping the natural-
// dimension fetch saves ~1 image decode per Avatar instance — meaningful on
// pages like the icon shop with 500+ tiles rendering at once.
const STANDARD_ILLUST_RE = /\/card_illusts\/[^/]+\.(jpg|jpeg|png)$/i;

export default function Avatar({ icon, border, size = 48, className = "" }: Props) {
  const url = icon?.card_image_url || null;
  const isStandard = !!url && STANDARD_ILLUST_RE.test(url);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(() => {
    if (!url) return null;
    if (dimsCache.get(url)) return dimsCache.get(url) || null;
    if (isStandard) return { w: 624, h: 624 };
    return null;
  });

  useEffect(() => {
    if (!url) { setDims(null); return; }
    const cached = dimsCache.get(url);
    if (cached) { setDims(cached); return; }
    if (isStandard) {
      // Trust the standard 624x624 layout — no extra fetch needed.
      setDims({ w: 624, h: 624 });
      return;
    }
    let cancelled = false;
    loadDims(url).then((d) => { if (!cancelled) setDims(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url, isStandard]);

  // Border ring takes thickness from total size; inner icon shrinks accordingly.
  // Overlay borders shrink the icon like other borders, but draw decorations on top.
  const animated = isAnimatedKey(border?.key);
  const overlay = !!border && OVERLAY_BORDER_KEYS.has(border.key);
  const ratio = !animated && border?.image_url
    ? BORDER_THICKNESS_RATIO_IMAGE
    : BORDER_THICKNESS_RATIO_PLAIN;
  const ringThickness = border ? Math.max(2, Math.round(size * ratio)) : 0;
  const innerSize = size - ringThickness * 2;

  // Compute background positioning for the inner icon (innerSize)
  let bgWidth = innerSize, bgHeight = innerSize, bgX = 0, bgY = 0, nudgeX = 0;
  if (icon && dims) {
    const minDim = Math.min(dims.w, dims.h);
    const cropDiameter = 2 * icon.radius * minDim;
    const scale = innerSize / cropDiameter;
    bgWidth = dims.w * scale;
    bgHeight = dims.h * scale;
    bgX = -(icon.center_x * dims.w * scale - innerSize / 2);
    bgY = -(icon.center_y * dims.h * scale - innerSize / 2);
    // Optical right-nudge, scaled with size so it's proportional (not a fixed 2px on tiny avatars).
    const target = Math.max(0, Math.floor(innerSize / 48));
    nudgeX = Math.min(target, Math.max(0, -bgX));
  }

  // Wrapper handles the ring; inner div renders the icon
  const ringStyle: React.CSSProperties = animated
    ? { background: "transparent", position: "relative" }
    : border
    ? border.image_url
      ? { backgroundImage: `url(${border.image_url})`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" }
      : { background: border.color || "#ffffff" }
    : {};

  // Admin border gets a subtle moving-gradient animation so it stands out
  // even at small avatar sizes where a static color would blend in.
  const METAL_KEYS = ["iron", "bronze", "silver", "gold", "platinum", "diamond"];
  const animClass =
    border?.key === "admin"
      ? " admin-border-anim"
      : border && METAL_KEYS.includes(border.key)
      ? " metal-border-anim"
      : "";

  return (
    <div
      className={`rounded-full flex items-center justify-center ${className}${animClass}`}
      style={{ width: size, height: size, ...ringStyle }}
      aria-label={icon ? (icon.title || icon.card_name) : undefined}
    >
      {animated && border && !overlay && <AnimatedBorder type={border.key as AnimatedKey} size={size} />}
      {(!icon || (!icon.card_image_url && !icon.cropped_image_url)) ? (
        <div
          className="rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center"
          style={{ width: innerSize, height: innerSize, position: "relative", zIndex: 1 }}
        >
          <span className="text-gray-500" style={{ fontSize: innerSize / 2 }}>?</span>
        </div>
      ) : icon.cropped_image_url ? (
        // Pre-cropped path: server already produced a 256x256 square, so we
        // can just stretch it. No positioning math, no second image fetch.
        <div
          className="rounded-full bg-gray-200 dark:bg-gray-700"
          style={{
            width: innerSize,
            height: innerSize,
            backgroundImage: `url(${icon.cropped_image_url})`,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
            position: "relative",
            zIndex: 1,
          }}
        />
      ) : (
        <div
          className="rounded-full bg-gray-200 dark:bg-gray-700"
          style={{
            width: innerSize,
            height: innerSize,
            backgroundImage: `url(${icon.card_image_url})`,
            backgroundSize: `${bgWidth}px ${bgHeight}px`,
            backgroundPosition: `${bgX + nudgeX}px ${bgY}px`,
            backgroundRepeat: "no-repeat",
            position: "relative",
            zIndex: 1,
          }}
        />
      )}
      {animated && border && overlay && (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
          <AnimatedBorder type={border.key as AnimatedKey} size={size} />
        </div>
      )}
    </div>
  );
}
