import { useEffect, useState, type RefObject } from "react";

// What the keyboard did the last time it came up for the box: how much it covered, and whether the browser panned the
// page up instead (iOS) — then the box rises with the page and needs no lift of its own.
let lastUp: { covered: number; panned: boolean } | null = null;

/** How much of the bottom of the screen the on-screen keyboard covers (0 without one), and whether a change of it
 *  should glide. Phones keep the layout viewport, where `position: fixed; bottom: …` is measured from, when the
 *  keyboard opens and only shrink or pan the part that is seen, so a box fixed to the bottom slides under the keyboard
 *  — and stays there as the page is moved — unless it is lifted by this much. The keyboard coming or going changes
 *  the seen height: the lift glides with it (참혈 2026-10-14), starting as the box is focused when the last keyboard
 *  showed how far it would go, and falling as it is left. The page moved under a keyboard already up only pans the
 *  seen part: the lift follows at once. */
export function useKeyboardInset(box: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ inset: 0, glide: false });
  useEffect(() => {
    const vv = window.visualViewport;
    const el = box.current;
    if (!vv) return;
    let frame = 0;
    let height = vv.height;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const covered = window.innerHeight - vv.height - vv.offsetTop;
        // browser bars and rounding move the seen part a little, a keyboard far more; a pinch zoom is not a keyboard
        const inset = covered > 80 && Math.abs(vv.scale - 1) < 0.01 ? Math.round(covered) : 0;
        const glide = Math.abs(vv.height - height) > 1;
        height = vv.height;
        if (window.innerHeight - vv.height > 80) lastUp = { covered: inset, panned: vv.offsetTop > 1 };
        setState({ inset, glide });
      });
    };
    const onFocus = () => {
      if (lastUp && !lastUp.panned && lastUp.covered) setState({ inset: lastUp.covered, glide: true });
    };
    const onBlur = () => setState((s) => (s.inset ? { inset: 0, glide: true } : s));
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    el?.addEventListener("focus", onFocus);
    el?.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
      el?.removeEventListener("focus", onFocus);
      el?.removeEventListener("blur", onBlur);
    };
  }, [box]);
  return state;
}
