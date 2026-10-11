/** Draws a card face through Master Duel's own UI card shaders — ShineStyleUI and RoyalStyleUI — translated
 *  instruction by instruction from the game (mdpipeline/dxbc2glsl.py, 엘리스 2026-10-11). The translated shaders,
 *  their settings (finish.json) and the textures they sample are Konami's, so they are served from media rather
 *  than kept in this repository. */

export type FinishStyle = "shine" | "royal";
/** Per card: the attribute icon's tile in the shader's atlas and the level stars (a rank as a negative count). */
export type FinishParams = { attribute: number; level: number };

const BASE = "/media/md_ui/finish";
const STYLES: FinishStyle[] = ["shine", "royal"];

type StyleConfig = {
  material: number[];
  bindings: Record<string, number>;
  inputs: Record<string, number>;
  textures: Record<string, { name: string; file: string }>;
  params: { attribute?: number; level?: number };
};
type Bundle = { config: Record<FinishStyle, StyleConfig>; shaders: Record<FinishStyle, string> };

let bundle: Promise<Bundle> | null = null;

/** finish.json and the translated shaders, fetched once per visit. */
function loadBundle(): Promise<Bundle> {
  bundle ??= (async () => {
    const config = await (await fetch(`${BASE}/finish.json`)).json();
    const shaders = Object.fromEntries(
      await Promise.all(STYLES.map(async (s) => [s, await (await fetch(`${BASE}/${s}.frag`)).text()] as const)),
    ) as Record<FinishStyle, string>;
    return { config, shaders };
  })().catch((e) => {
    bundle = null;
    throw e;
  });
  return bundle;
}

export function finishSupported(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
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
};

export class CardFinish {
  private gl: WebGL2RenderingContext;
  private programs: Partial<Record<FinishStyle, { pr: WebGLProgram; sizes: Record<string, number> }>> = {};
  private textures: Record<string, WebGLTexture> = {};
  private quad: WebGLBuffer;
  private cfg!: Record<FinishStyle, StyleConfig>;

  private constructor(private canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  static async create(canvas: HTMLCanvasElement, faceUrl: string): Promise<CardFinish> {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2를 쓸 수 없습니다.");
    const f = new CardFinish(canvas, gl);
    const { config, shaders } = await loadBundle();
    f.cfg = config;
    for (const s of STYLES) f.programs[s] = f.compile(vertexSource(config[s].inputs), shaders[s]);
    const files = new Set(STYLES.flatMap((s) => Object.values(config[s].textures).map((t) => t.file)));
    await Promise.all(
      [...files].map(async (file) => {
        if (file === "@card") f.upload(file, await loadImage(faceUrl), gl.CLAMP_TO_EDGE);
        else if (SOLID[file]) f.uploadSolid(file, SOLID[file]);
        else f.upload(file, await loadImage(`${BASE}/${file}.png`), gl.REPEAT);
      }),
    );
    return f;
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
    return { pr, sizes };
  }

  private upload(key: string, source: TexImageSource, wrap: number) {
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
    this.textures[key] = t;
  }

  private uploadSolid(key: string, rgba: [number, number, number, number]) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    // no mipmaps for a single pixel: without this filter the texture is incomplete and samples as transparent black
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.textures[key] = t;
  }

  /** Draw one moment (seconds) of the style's animation. */
  draw(style: FinishStyle, time: number, params: FinishParams) {
    const gl = this.gl;
    const cfg = this.cfg[style];
    const prog = this.programs[style]!;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog.pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const [i, s] of Object.entries(cfg.textures)) {
      gl.activeTexture(gl.TEXTURE0 + Number(i));
      gl.bindTexture(gl.TEXTURE_2D, this.textures[s.file]);
      gl.uniform1i(gl.getUniformLocation(prog.pr, `t${i}`), Number(i));
    }
    const put = (a: Float32Array, row: number, vals: number[]) => vals.forEach((v, k) => { a[row * 4 + k] = v; });
    const globals = new Float32Array(134 * 4);
    put(globals, 5, [0, 0, -1, 0]);              // _MainLightPosition: the light comes from the camera
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
    for (const [name, idx] of Object.entries(cfg.bindings)) {
      const loc = gl.getUniformLocation(prog.pr, `cb${idx}`);
      const size = prog.sizes[String(idx)];
      if (loc && size && data[name]) gl.uniform4fv(loc, data[name].subarray(0, size * 4));
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    Object.values(this.textures).forEach((t) => gl.deleteTexture(t));
    Object.values(this.programs).forEach((p) => p && gl.deleteProgram(p.pr));
    gl.deleteBuffer(this.quad);
    // the context itself stays: a canvas has only one, and a renderer made after this one may be using it
  }
}
