/** Master Duel's attribute background behind a summon, replayed from the game's particle data (엘리스 2026-10-11):
 *  load a background (fx.json, its shaders, textures and meshes) and draw any moment of it. The timeline's control
 *  clips say when each particle system plays; each is simulated from its start in steps of a 60th of a second. */
import { Emitter } from "./particles";
import { FxRenderer, type Mesh, type Shader, type Sprite, type System, type Texture } from "./render";

const STEP = 1 / 60;

export class SummonFx {
  private time = 0;

  private constructor(private renderer: FxRenderer, private systems: System[], private sprites: Sprite[], readonly length: number) {}

  /** `version` goes on every file's address, so that browsers holding an older export (media is cached for years)
   *  fetch the new one. */
  static async load(canvas: HTMLCanvasElement, base: string, version = 0): Promise<SummonFx> {
    const url = (path: string) => `${base}/${path}${version ? `?v=${version}` : ""}`;
    const json = async (path: string) => {
      const r = await fetch(url(path));
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    };
    const fx = await json("fx.json");
    const renderer = new FxRenderer(canvas);
    const textures = new Map<string, Texture>(), meshes = new Map<string, Mesh>(), shaders = new Map<string, Shader>();
    const systems: System[] = [];
    for (const data of fx.systems) {
      const own: Record<string, Texture> = {};
      for (const [name, t] of Object.entries<{ file: string; wrap: [number, number] }>(data.material.textures)) {
        if (!textures.has(t.file)) {
          const im = new Image();
          im.src = url(`tex/${t.file}.png`);
          await im.decode();
          textures.set(t.file, renderer.texture(im, t.wrap));
        }
        own[name] = textures.get(t.file)!;
      }
      const program = data.material.program;
      if (!shaders.has(program)) shaders.set(program, await json(`shader/${program}.json`));
      const meshName = data.renderer.mesh;
      if (meshName && !meshes.has(meshName)) meshes.set(meshName, await json(`mesh/${meshName}.json`));
      systems.push({ data, emitter: new Emitter(data.ps, data.seed), shader: shaders.get(program)!, textures: own,
                     mesh: meshName ? meshes.get(meshName)! : null });
    }
    const sprites: Sprite[] = [];
    for (const data of fx.sprites ?? []) {
      const im = new Image();
      im.src = url(`tex/${data.file}.png`);
      await im.decode();
      sprites.push({ data, texture: renderer.texture(im, [1, 1]) });
    }
    return new SummonFx(renderer, systems, sprites, fx.length);
  }

  /** Let the GPU memory go. */
  dispose() {
    this.renderer.dispose();
  }

  /** Back to the start. */
  restart() {
    this.time = 0;
    for (const s of this.systems) s.emitter.reset(s.data.seed);
  }

  /** Move on to `time` (seconds since the start) and draw it through the view. */
  draw(time: number, cx: number, cy: number, halfW: number, halfH: number) {
    while (this.time + STEP <= time) {
      const t = this.time;
      for (const s of this.systems) if (t >= s.data.start && t < s.data.start + s.data.duration) s.emitter.step(STEP);
      this.time += STEP;
    }
    const now = this.time;
    this.renderer.draw(this.systems, this.sprites, (s) => now >= s.data.start && now < s.data.start + s.data.duration, now, cx, cy, halfW, halfH);
  }
}
