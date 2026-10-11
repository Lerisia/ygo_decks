/** The card book's own player for Master Duel's monster cut-ins (Spine 4.2 exports): loads a cut-in's skeleton, atlas
 *  and pages and draws any moment of an animation (엘리스 2026-10-11). */
import { readAtlas } from "./atlas";
import { type Animation, readSkeleton } from "./data";
import { SpineRenderer } from "./render";
import { Skeleton } from "./skeleton";

export class SpinePlayer {
  private constructor(private renderer: SpineRenderer, readonly skeleton: Skeleton) {}

  /** The cut-in under `base` (skeleton.json, atlas.txt and its pages) on the canvas. */
  static async load(canvas: HTMLCanvasElement, base: string): Promise<SpinePlayer> {
    const [json, atlasText] = await Promise.all([
      fetch(`${base}/skeleton.json`).then((r) => r.json()),
      fetch(`${base}/atlas.txt`).then((r) => r.text()),
    ]);
    const atlas = readAtlas(atlasText);
    const renderer = new SpineRenderer(canvas, atlas.regions);
    await Promise.all(atlas.pages.map(async (page) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.src = `${base}/${page.name}`;
      await im.decode();
      renderer.addPage(page, im);
    }));
    return new SpinePlayer(renderer, new Skeleton(readSkeleton(json)));
  }

  animation(name: string): Animation | undefined {
    return this.skeleton.data.animations.get(name);
  }

  /** Back to the start: the physics forget their motion. */
  restart() {
    this.skeleton.restart();
  }

  /** Pose the animation at `time` (seconds; `step` since the last frame, for the physics) and draw it through a view
   *  centred on (cx, cy) showing halfW / halfH skeleton units each way. */
  draw(anim: Animation, time: number, step: number, cx: number, cy: number, halfW: number, halfH: number) {
    const sk = this.skeleton;
    sk.time += step;
    sk.apply(anim, time);
    sk.updateWorld();
    this.renderer.draw(sk, cx, cy, halfW, halfH);
  }

  /** Where the animation's figure is at `time` (posed without drawing): minX, minY, maxX, maxY. */
  bounds(anim: Animation, time: number): [number, number, number, number] {
    const sk = this.skeleton;
    sk.apply(anim, time);
    sk.updateWorld();
    return this.renderer.bounds(sk);
  }

  dispose() {
    this.renderer.dispose();
  }
}
