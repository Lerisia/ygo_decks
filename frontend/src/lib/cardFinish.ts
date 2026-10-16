/** Draws a card face through Master Duel's own UI card shaders — ShineStyleUI and RoyalStyleUI — translated
 *  instruction by instruction from the game (mdpipeline/dxbc2glsl.py, 엘리스 2026-10-11). The translated shaders,
 *  their settings (finish.json) and the textures they sample are Konami's, so they are served from media rather
 *  than kept in this repository. */

export type FinishStyle = "shine" | "royal";
/** The frame whose lines and relief the finish lights: a print in 오버프레임 has none. */
export type FinishFrame = "normal" | "link" | "pendulum" | "overframe";
/** Per card: the attribute icon's tile in the shader's atlas, the level stars (a rank as a negative count), the frame
 *  and the picture of its name alone, which the finishes paint (Royal in gold, Shine in white). */
export type FinishParams = { attribute: number; level: number; frame: FinishFrame; name?: string | null };

const BASE = "/media/md_ui/finish";
// Toward the light: straight from the viewer, the brightest (엘리스 10/11; a low light from the upper left matched a
// deck screen screenshot better but darkened both finishes)
const LIGHT = [0, 0, -1, 0];
const STYLES: FinishStyle[] = ["shine", "royal"];

type StyleConfig = {
  material: number[];
  bindings: Record<string, number>;
  inputs: Record<string, number>;
  textures: Record<string, { name: string; file: string }>;
  frames: Partial<Record<FinishFrame, Record<string, string>>>;
  params: { attribute?: number; level?: number };
};
type Bundle = { config: Record<FinishStyle, StyleConfig>; shaders: Record<FinishStyle, string> };

let bundle: Promise<Bundle> | null = null;

/** finish.json and the translated shaders, fetched once per visit; media is cached for years, so they are
 *  revalidated, as a rebuilt bundle keeps their names. */
function loadBundle(): Promise<Bundle> {
  bundle ??= (async () => {
    const config = await (await fetch(`${BASE}/finish.json`, { cache: "no-cache" })).json();
    const shaders = Object.fromEntries(
      await Promise.all(STYLES.map(async (s) => [s, await (await fetch(`${BASE}/${s}.frag`, { cache: "no-cache" })).text()] as const)),
    ) as Record<FinishStyle, string>;
    return { config, shaders };
  })().catch((e) => {
    bundle = null;
    throw e;
  });
  return bundle;
}

let supported: boolean | null = null;

/** Whether the browser draws WebGL 2, asked once: each asking made a context it never let go of, and a phone keeps
 *  only so many — the pack simulator, asking for every finished card, made Safari drop the ones on screen (엘리스 10/13:
 *  "결과창의 로얄카드가 갑자기 사라졌어요"). */
export function finishSupported(): boolean {
  if (supported === null) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      supported = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      supported = false;
    }
  }
  return supported;
}

/** Let a canvas's context go now rather than when the page is collected (a phone keeps only so many). */
export function releaseContext(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
}

function vertexSource(inputs: Record<string, number>): string {
  // A flat card facing the camera, as in the deck screen.
  const value: Record<string, string> = {
    tangent: "vec4(1., 0., 0., 1.)",
    uv: "vec4(uv, 0., 0.)",
    color: "vec4(1.)",
    pos: "vec4((uv - .5) * vec2(7.04, 10.24), 0., 1.)",
    normal: "vec4(0., 0., -1., 0.)",
  };
  return `#version 300 es
in vec2 p;
${Object.values(inputs).map((i) => `out vec4 v${i};`).join("\n")}
void main() {
  vec2 uv = p * .5 + .5;
${Object.entries(inputs).map(([k, i]) => `  v${i} = ${value[k]};`).join("\n")}
  gl_Position = vec4(p, 0., 1.);
}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.src = src;
  return im.decode().then(() => im);
}

const SOLID: Record<string, [number, number, number, number]> = {
  "@white": [255, 255, 255, 255],
  "@black": [0, 0, 0, 0],
  "@gray": [128, 128, 128, 255],
  "@bump": [128, 128, 255, 255],
  "@overframe": [0, 62, 0, 255],   // a frame mask with no lines, all art
  "@name": [0, 0, 0, 255],         // no name to paint
};

/** One WebGL 2 context's finish shaders, compiled once, and the textures every card shares; a card's face and name
 *  come with each draw. The card page draws one card on its own canvas (CardFinish); a deck's small cards are drawn
 *  one after another in a single shared one (finishTiles, 참혈 2026-10-16), so a page holds one context, not one a card. */
export class FinishShaders {
  private programs: Partial<Record<FinishStyle, { pr: WebGLProgram; sizes: Record<string, number>; locs: Map<string, WebGLUniformLocation | null> }>> = {};
  private shared: Record<string, WebGLTexture> = {};
  private loading: Record<string, Promise<void>> = {};
  private quad: WebGLBuffer;
  private cfg!: Record<FinishStyle, StyleConfig>;
  private disposed = false;

  private constructor(readonly gl: WebGL2RenderingContext) {
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  static async create(gl: WebGL2RenderingContext): Promise<FinishShaders> {
    const f = new FinishShaders(gl);
    const { config, shaders } = await loadBundle();
    f.cfg = config;
    for (const s of STYLES) f.programs[s] = f.compile(vertexSource(config[s].inputs), shaders[s]);
    return f;
  }

  /** The shared textures a card of this frame samples in either finish, each loaded once. */
  prepare(frame: FinishFrame): Promise<void> {
    const files = new Set(STYLES.flatMap((s) => Object.keys(this.cfg[s].textures).map((i) => this.fileAt(s, i, frame))));
    return Promise.all([...files].filter((file) => file !== "@card" && file !== "@name").map((file) => {
      if (this.shared[file]) return;
      if (SOLID[file]) {
        this.shared[file] = this.solid(SOLID[file]);
        return;
      }
      this.loading[file] ??= loadImage(`${BASE}/${file}.png`).then(
        (im) => {
          if (!this.shared[file] && !this.disposed) this.shared[file] = this.texture(im, this.gl.REPEAT);
        },
        (e) => {
          delete this.loading[file];
          throw e;
        },
      );
      return this.loading[file];
    })).then(() => undefined);
  }

  /** What texture slot i of the style samples for a card of this frame. */
  private fileAt(style: FinishStyle, i: string, frame: FinishFrame): string {
    return this.cfg[style].frames?.[frame]?.[i] ?? this.cfg[style].textures[i].file;
  }

  private compile(vs: string, fs: string) {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, "p");
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || "program");
    const sizes: Record<string, number> = {};
    for (const m of fs.matchAll(/uniform vec4 cb(\d+)\[(\d+)\]/g)) sizes[m[1]] = Number(m[2]);
    return { pr, sizes, locs: new Map<string, WebGLUniformLocation | null>() };
  }

  private loc(style: FinishStyle, name: string) {
    const prog = this.programs[style]!;
    if (!prog.locs.has(name)) prog.locs.set(name, this.gl.getUniformLocation(prog.pr, name));
    return prog.locs.get(name)!;
  }

  /** A picture as a texture: a card's face or name clamped at its edges, a shared pattern repeated. */
  texture(source: TexImageSource, wrap: number = this.gl.CLAMP_TO_EDGE): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // Unity's uv starts at the bottom left
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  private solid(rgba: [number, number, number, number]): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    // no mipmaps for a single pixel: without this filter the texture is incomplete and samples as transparent black
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  /** Draw one moment (seconds) of the style's animation on a card with this face and name (none: no name painted),
   *  over the whole canvas, cleared first, or in `rect` ([x, y, w, h] from the bottom left), which it covers. */
  draw(style: FinishStyle, time: number, params: FinishParams, card: WebGLTexture, name: WebGLTexture | null, rect?: number[]) {
    if (this.disposed) return;
    const gl = this.gl;
    const cfg = this.cfg[style];
    const prog = this.programs[style]!;
    if (rect) gl.viewport(rect[0], rect[1], rect[2], rect[3]);
    else gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(prog.pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (!name) this.shared["@name"] ??= this.solid(SOLID["@name"]);
    for (const i of Object.keys(cfg.textures)) {
      const file = this.fileAt(style, i, params.frame);
      gl.activeTexture(gl.TEXTURE0 + Number(i));
      gl.bindTexture(gl.TEXTURE_2D, file === "@card" ? card : file === "@name" ? (name ?? this.shared["@name"]) : this.shared[file]);
      gl.uniform1i(this.loc(style, `t${i}`), Number(i));
    }
    const put = (a: Float32Array, row: number, vals: number[]) => vals.forEach((v, k) => { a[row * 4 + k] = v; });
    const globals = new Float32Array(134 * 4);
    put(globals, 5, LIGHT);                      // _MainLightPosition
    put(globals, 6, [1, 1, 1, 1]);               // _MainLightColor
    put(globals, 19, [time, Math.sin(time), Math.cos(time), 0]);   // _TimeParameters drives the sweep
    put(globals, 21, [0, 0, -30, 0]);            // _WorldSpaceCameraPos, in front of the card
    put(globals, 66, [1, 0, 0, 0]); put(globals, 67, [0, 1, 0, 0]); put(globals, 68, [0, 0, 1, 0]); put(globals, 69, [0, 0, 0, 1]);
    const draw = new Float32Array(45 * 4);
    put(draw, 9, [0, 0, 0, 1]);                  // unity_WorldTransformParams
    const material = new Float32Array(cfg.material);
    if (cfg.params.attribute !== undefined) material[cfg.params.attribute] = params.attribute;
    if (cfg.params.level !== undefined) material[cfg.params.level] = params.level;
    const data: Record<string, Float32Array> = { $Globals: globals, UnityPerDraw: draw, UnityPerMaterial: material };
    for (const [bound, idx] of Object.entries(cfg.bindings)) {
      const loc = this.loc(style, `cb${idx}`);
      const size = prog.sizes[String(idx)];
      if (loc && size && data[bound]) gl.uniform4fv(loc, data[bound].subarray(0, size * 4));
    }
    if (!rect) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.disposed = true;
    const gl = this.gl;
    Object.values(this.shared).forEach((t) => gl.deleteTexture(t));
    Object.values(this.programs).forEach((p) => p && gl.deleteProgram(p.pr));
    gl.deleteBuffer(this.quad);
  }
}

/** One card on its own canvas (the card page, its zoom, the info sheet, the pack simulator). */
export class CardFinish {
  private card: WebGLTexture | null = null;
  private name: WebGLTexture | null = null;
  private frame: FinishFrame = "normal";
  private faceCalls = 0;
  private disposed = false;

  private constructor(private shaders: FinishShaders) {}

  /** A renderer for the canvas with the shaders compiled, made once: a face is put on it with setFace, and changing
   *  the face later swaps only its texture (no compiling again, and never two renderers on one canvas). */
  static async create(canvas: HTMLCanvasElement): Promise<CardFinish> {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2를 쓸 수 없습니다.");
    return new CardFinish(await FinishShaders.create(gl));
  }

  /** Put a face, its frame and its name on the card; false when a later call has taken its place meanwhile. */
  async setFace(faceUrl: string, frame: FinishFrame, nameUrl?: string | null): Promise<boolean> {
    const call = ++this.faceCalls;
    const [face, name] = await Promise.all([
      loadImage(faceUrl),
      nameUrl ? loadImage(nameUrl) : Promise.resolve(null),
      this.shaders.prepare(frame),
    ]);
    if (call !== this.faceCalls || this.disposed) return false;
    const gl = this.shaders.gl;
    if (this.card) gl.deleteTexture(this.card);
    this.card = this.shaders.texture(face);
    if (this.name) gl.deleteTexture(this.name);
    this.name = name ? this.shaders.texture(name) : null;
    this.frame = frame;
    return true;
  }

  /** Leave the canvas empty, so the plain face behind it shows until the next draw. */
  clear() {
    const gl = this.shaders.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draw one moment (seconds) of the style's animation. */
  draw(style: FinishStyle, time: number, params: FinishParams) {
    if (this.disposed || !this.card) return;
    this.shaders.draw(style, time, { ...params, frame: this.frame }, this.card, this.name);
  }

  dispose() {
    this.disposed = true;
    const gl = this.shaders.gl;
    [this.card, this.name].forEach((t) => t && gl.deleteTexture(t));
    this.shaders.dispose();
    // the context itself stays: a canvas has only one, and a renderer made after this one may be using it
  }
}
