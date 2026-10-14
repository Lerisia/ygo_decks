/** For the `cutin_illusts` management command (엘리스 2026-10-15), not the site: in a headless browser, draws a
 *  cut-in's figure at rest, large, on a transparent square, so the command can lay it on the card's art. The command
 *  bundles this file with esbuild and calls `renderCutinPose` on the page. */
import { SpinePlayer } from "../lib/spine";

/** `look` dresses the figure at rest in what the named animation shows at `t` (0..1 of its length): the eyes open,
 *  the slots the play fades in. The view is always the plain rest pose's, so every look lands on the same pixels. */
async function renderCutinPose(base: string, version: number, size: number, look?: { anim: string; t: number }): Promise<{ png: string; view: [number, number, number] }> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const player = await SpinePlayer.load(canvas, base, version, { bitmaps: true });
  try {
    const [x0, y0, x1, y1] = player.setupBounds();
    const half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.04;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const anim = look ? player.animation(look.anim) : undefined;
    player.drawSetup(cx, cy, half, half, look && anim ? { anim, time: anim.duration * look.t } : undefined);
    return { png: canvas.toDataURL("image/png"), view: [cx, cy, half] };
  } finally {
    player.dispose();   // each call makes a WebGL context; a browser keeps only so many before it loses the oldest
  }
}

(window as unknown as { renderCutinPose: typeof renderCutinPose }).renderCutinPose = renderCutinPose;
