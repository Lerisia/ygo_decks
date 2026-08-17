import { useEffect, useState } from "react";

/** Phone orientation. Used by the DuchMind "mobile drawer focus" layout to
 *  decide whether to CSS-rotate the drawing UI (portrait phones get rotated
 *  90° so a landscape layout shows up sideways — the user holds the phone
 *  landscape to read it upright). */
export function useOrientation(): "portrait" | "landscape" {
  const [o, setO] = useState<"portrait" | "landscape">(() =>
    typeof window === "undefined" || window.innerWidth >= window.innerHeight
      ? "landscape" : "portrait"
  );
  useEffect(() => {
    const onResize = () => setO(window.innerWidth >= window.innerHeight ? "landscape" : "portrait");
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return o;
}

/** True for phone-sized devices — tablets are excluded.
 *
 * Detection uses the *shorter* viewport side rather than the current width,
 * which makes it orientation-independent: a phone reads as a phone whether
 * held portrait or landscape, and a tablet never trips the phone path even
 * in portrait. Phones top out around a 430px short side (iPhone Pro Max);
 * the smallest common tablets sit at ~744px (iPad Mini) — 600 is the safe
 * gap between them. */
function detectPhone(): boolean {
  if (typeof window === "undefined") return false;
  return Math.min(window.innerWidth, window.innerHeight) < 600;
}

export function useIsPhone(): boolean {
  const [m, setM] = useState<boolean>(detectPhone);
  useEffect(() => {
    const on = () => setM(detectPhone());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return m;
}

/** True when the UI should use the phone-style "compact + fullscreen
 *  toggle" layout. Covers:
 *    - phones in any orientation
 *    - tablets held in portrait (per user feedback: iPad portrait should
 *      behave the same as phone portrait)
 *  Tablets in landscape and desktops fall through to the regular layout.
 *
 *  Threshold: shortSide < 1100 in portrait → covers iPad Pro 12.9
 *  (1024×1366) too. Desktops are virtually never < 1100px wide.
 */
function detectCompactPortrait(): boolean {
  if (typeof window === "undefined") return false;
  if (detectPhone()) return true;
  const portrait = window.innerHeight > window.innerWidth;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return portrait && shortSide < 1100;
}

export function useIsCompactPortrait(): boolean {
  const [m, setM] = useState<boolean>(detectCompactPortrait);
  useEffect(() => {
    const on = () => setM(detectCompactPortrait());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return m;
}
