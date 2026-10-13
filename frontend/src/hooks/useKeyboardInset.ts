import { useEffect, useState } from "react";

/** How much of the bottom of the screen the on-screen keyboard covers (0 without one). Phones keep the layout viewport,
 *  where `position: fixed; bottom: …` is measured from, when the keyboard opens and only shrink or pan the part that is
 *  seen, so a box fixed to the bottom slides under the keyboard — and stays there as the page is moved — unless it is
 *  lifted by this much. */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const covered = window.innerHeight - vv.height - vv.offsetTop;
        // browser bars and rounding move the seen part a little, a keyboard far more; a pinch zoom is not a keyboard
        setInset(covered > 80 && Math.abs(vv.scale - 1) < 0.01 ? Math.round(covered) : 0);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
