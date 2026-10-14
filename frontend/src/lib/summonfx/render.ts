/** Draws the particle systems of a summon background with WebGL2 through the game's own shaders (shader_web.py
 *  translates them): billboards, stretched billboards and meshes built in world space as Unity's particle renderer
 *  builds them, the renderer's vertex streams packed into TEXCOORD0..2 in its order, the constant buffers filled by
 *  name (the camera's matrices, the material's values) and the systems sorted as Unity sorts transparent renderers. */
import { minMax, minMaxColor } from "./curves";
import type { Emitter, Particle, Vec3 } from "./particles";
import { Post } from "./post";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type Mesh = { pos: number[][]; uv: number[][]; tri: number[][] };
type Param = { name: string; offset: number; dim: number; matrix: boolean };
type Binds = { cb: Record<string, { name: string; params: Param[] }>; t: Record<string, string> };
type Factor = { name: string; value: number };
export type Shader = {
  name: string; vs: string; fs: string; attributes: Record<string, string>; vertex: Binds; pixel: Binds;
  blend: { src: Factor; dst: Factor; srcAlpha: Factor; dstAlpha: Factor };
};
export type Texture = { tex: WebGLTexture; w: number; h: number };
/** A particle system: its particles through `shader` (none when its renderer draws only trails) and its trails. */
export type System = {
  data: Json; emitter: Emitter; shader: Shader | null; textures: Record<string, Texture>; mesh: Mesh | null;
  trail: { shader: Shader; textures: Record<string, Texture> } | null;
};
/** A sprite over the whole screen (Sprites-Default: texture × colour, premultiplied), its colour animated. */
export type Sprite = { data: Json; texture: Texture };

const SPRITE_VS = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(gl_VertexID % 2 == 1 ? 1. : -1., gl_VertexID / 2 == 1 ? 1. : -1.);
  uv = p * .5 + .5;
  gl_Position = vec4(p, 0., 1.);
}`;
const SPRITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D tex;
uniform vec4 color;
in vec2 uv;
out vec4 o;
void main() {
  vec4 c = texture(tex, uv) * color;
  o = vec4(c.rgb * c.a, c.a);
}`;

const queueOf = (material: Json) => (material?.queue >= 0 ? material.queue : 3000);

/** A sprite's colour at a time: the recorded curves where the timeline animates a channel, its own colour elsewhere. */
export function spriteColor(data: Json, time: number): number[] {
  const k = Math.min(Math.max(0, Math.round(time * data.rate)), Number.MAX_SAFE_INTEGER);
  return ["r", "g", "b", "a"].map((c, i) => {
    const curve: number[] | undefined = data.curves[c];
    return curve ? curve[Math.min(k, curve.length - 1)] : data.color[i];
  });
}

const FLOATS = 19;   // position 3, colour 4, TEXCOORD0..2
const NEAR = 0.3, FAR = 1000, CAMERA_Z = -10;

/** Floats each vertex stream (ParticleSystemVertexStream) takes in the TEXCOORDs; Position (0), Normal (1),
 *  Tangent (2) and Color (3) have attributes of their own. */
const STREAM_SIZE: Record<number, number> = {
  4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1, 10: 3, 11: 1, 12: 1, 13: 2, 14: 3, 15: 1, 16: 3, 17: 1, 18: 3, 19: 3, 20: 1,
  21: 1, 22: 1, 23: 1, 24: 2, 25: 3, 26: 4, 27: 1, 28: 2, 29: 3, 30: 4, 31: 1, 32: 2, 33: 3, 34: 4, 35: 1, 36: 2,
  37: 3, 38: 4,
};
const UV_STREAM = 4;

type Slot = { stream: number; at: number; n: number };

/** Where each stream lands in the 12 TEXCOORD floats: packed in order, a stream may run on into the next TEXCOORD. */
function layout(renderer: Json): Slot[] {
  const streams: number[] = renderer.m_UseCustomVertexStreams ? renderer.m_VertexStreams : [0, 1, 3, UV_STREAM];
  const out: Slot[] = [];
  let at = 0;
  for (const s of streams) {
    const n = STREAM_SIZE[s];
    if (!n) continue;
    out.push({ stream: s, at, n });
    at += n;
  }
  return out;
}

type Mat4 = number[];   // column-major
const mul = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const GL_BLEND = (gl: WebGL2RenderingContext) => [gl.ZERO, gl.ONE, gl.DST_COLOR, gl.SRC_COLOR, gl.ONE_MINUS_DST_COLOR,
  gl.SRC_ALPHA, gl.ONE_MINUS_SRC_COLOR, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.SRC_ALPHA_SATURATE, gl.ONE_MINUS_SRC_ALPHA];

const NO_STREAMS = new Array(12).fill(0);

/** Vertices, FLOATS each, in one Float32Array that grows as needed and is used again frame after frame. */
class Verts {
  data = new Float32Array(FLOATS * 4096);
  n = 0;

  reset() {
    this.n = 0;
  }

  /** One vertex: position, colour, the TEXCOORD streams, and the UV at `uvAt` in them (-1: none). */
  put(x: number, y: number, z: number, c: number[], tc: number[], uvAt: number, u: number, v: number) {
    if ((this.n + 1) * FLOATS > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data, o = this.n * FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = c[3];
    for (let i = 0; i < 12; i++) d[o + 7 + i] = tc[i];
    if (uvAt >= 0) { d[o + 7 + uvAt] = u; d[o + 8 + uvAt] = v; }
    this.n++;
  }
}

/** A mesh's triangles laid out once, vertex by vertex: x, y, z, u, v. */
function meshFlat(m: Mesh & { _flat?: Float32Array }): Float32Array {
  if (!m._flat) {
    const out: number[] = [];
    for (const t of m.tri) for (const i of t) out.push(m.pos[i][0], m.pos[i][1], m.pos[i][2], m.uv[i]?.[0] ?? 0, m.uv[i]?.[1] ?? 0);
    m._flat = new Float32Array(out);
  }
  return m._flat;
}

/** A mesh particle's 3×3 (column-major): its size, then its rotation (z, x, y), then the system's turn when the
 *  particles are aligned to it. */
function particleMatrix(rot: Vec3, size: number[], world: number[] | null): number[] {
  const [ax, ay, az] = rot;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Ry · Rx · Rz, column by column
  let m = [
    cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz,
    -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz,
    sy * cx, -sx, cy * cx,
  ];
  if (world) {
    const w = [world[0], world[1], world[2], world[4], world[5], world[6], world[8], world[9], world[10]];
    const r = m;
    m = new Array(9);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) {
      m[col * 3 + row] = w[row] * r[col * 3] + w[3 + row] * r[col * 3 + 1] + w[6 + row] * r[col * 3 + 2];
    }
  }
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) m[col * 3 + row] *= size[col];
  return m;
}

type Program = {
  pr: WebGLProgram;
  arrays: { name: string; size: number; cb: number; pixel: boolean }[];
  attrs: { loc: number; sem: string }[];
};

export class FxRenderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private white: Texture;
  private depth: Texture;
  private verts = new Verts();
  private post: Post;
  private sprite: WebGLProgram;
  private made: WebGLTexture[] = [];

  constructor(private canvas: HTMLCanvasElement, vignette = true) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2를 쓸 수 없습니다.");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.white = this.pixel([255, 255, 255, 255]);
    this.depth = this.pixel([0, 0, 0, 0]);   // reversed depth: 0 is as far as it goes, so nothing fades a particle
    this.post = new Post(gl, vignette);
    this.sprite = this.program({ name: "Sprites-Default", vs: SPRITE_VS, fs: SPRITE_FS, attributes: {}, vertex: { cb: {}, t: {} },
                                 pixel: { cb: {}, t: {} }, blend: null as never }).pr;
  }

  /** Compile every system's shaders now. */
  prepare(systems: System[]) {
    for (const s of systems) {
      if (s.shader) this.program(s.shader);
      if (s.trail) this.program(s.trail.shader);
    }
  }

  /** Wait until the GPU has done all it was asked. */
  finish() {
    this.gl.finish();
  }

  /** Delete what this renderer made (not the context: a canvas's context is shared by whoever asks it). */
  dispose() {
    const gl = this.gl;
    for (const t of this.made) gl.deleteTexture(t);
    for (const p of this.programs.values()) gl.deleteProgram(p.pr);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    this.post.dispose();
  }

  private pixel(rgba: number[]): Texture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    this.made.push(tex);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    return { tex, w: 1, h: 1 };
  }

  texture(image: HTMLImageElement, wrap: [number, number]): Texture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    this.made.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // Unity's v runs up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const mode = (w: number) => [gl.REPEAT, gl.CLAMP_TO_EDGE, gl.MIRRORED_REPEAT][w] ?? gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode(wrap[0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode(wrap[1]));
    return { tex: t, w: image.naturalWidth, h: image.naturalHeight };
  }

  private program(sh: Shader): Program {
    const have = this.programs.get(sh.name);
    if (have) return have;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${sh.name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, sh.vs));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, sh.fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`${sh.name}: ${gl.getProgramInfoLog(pr)}`);
    const arrays: Program["arrays"] = [];
    for (const [src, pixel] of [[sh.vs, false], [sh.fs, true]] as const) {
      for (const m of src.matchAll(/uniform vec4 (p?cb)(\d+)\[(\d+)\];/g)) {
        arrays.push({ name: `${m[1]}${m[2]}`, cb: +m[2], size: +m[3], pixel });
      }
    }
    const attrs = Object.entries(sh.attributes).map(([a, sem]) => ({ loc: gl.getAttribLocation(pr, a), sem }));
    const p = { pr, arrays, attrs };
    this.programs.set(sh.name, p);
    return p;
  }

  /** Draw the systems (those playing) and the sprites at `time` through the view: centre (cx, cy), half width / height
   *  in world units; then the game's bloom and vignette. */
  draw(systems: System[], sprites: Sprite[], playing: (s: System) => boolean, time: number, cx: number, cy: number, halfW: number, halfH: number) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    this.post.begin(W, H);
    gl.enable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);

    // the camera: orthographic, at (cx, cy, -10) looking along +z, as Unity's view space (looking down -z) has it
    const V: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, -cx, -cy, CAMERA_Z, 1];
    const P: Mat4 = [1 / halfW, 0, 0, 0, 0, 1 / halfH, 0, 0, 0, 0, -2 / (FAR - NEAR), 0, 0, 0, -(FAR + NEAR) / (FAR - NEAR), 1];
    const invV: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, cx, cy, CAMERA_Z, 1];
    const invP: Mat4 = [halfW, 0, 0, 0, 0, halfH, 0, 0, 0, 0, -(FAR - NEAR) / 2, 0, 0, 0, -(FAR + NEAR) / 2, 1];
    const zb = -1 + FAR / NEAR;
    const globals: Record<string, number[]> = {
      unity_MatrixV: V, unity_MatrixInvV: invV, glstate_matrix_projection: P, unity_MatrixP: P,
      unity_MatrixVP: mul(P, V), unity_MatrixInvVP: mul(invV, invP), unity_MatrixInvP: invP,
      unity_ObjectToWorld: IDENTITY, unity_WorldToObject: IDENTITY, unity_WorldTransformParams: [0, 0, 0, 1],
      _WorldSpaceCameraPos: [cx, cy, CAMERA_Z], unity_OrthoParams: [halfW, halfH, 0, 1],
      _ProjectionParams: [1, NEAR, FAR, 1 / FAR], _ZBufferParams: [zb, 1, zb / FAR, 1 / FAR],
      _ScreenParams: [W, H, 1 + 1 / W, 1 + 1 / H], _ScaledScreenParams: [W, H, 1 + 1 / W, 1 + 1 / H],
      _Time: [time / 20, time, time * 2, time * 3], _TimeParameters: [time, Math.sin(time), Math.cos(time), 0],
      _SinTime: [Math.sin(time / 8), Math.sin(time / 4), Math.sin(time / 2), Math.sin(time)],
      _CosTime: [Math.cos(time / 8), Math.cos(time / 4), Math.cos(time / 2), Math.cos(time)],
      unity_DeltaTime: [1 / 60, 60, 1 / 60, 60], _GlobalMipBias: [0, 0], _RTHandleScale: [1, 1, 1, 1],
      _CameraDepthTexture_TexelSize: [1 / W, 1 / H, W, H],
    };

    // Unity's order for transparent renderers: sorting order, render queue, then further first (a particle system's
    // sorting fudge counts as distance)
    type Item = { order: number; queue: number; distance: number; draw: () => void };
    const items: Item[] = [
      ...systems.filter(playing).map((s) => ({
        order: s.data.renderer.m_SortingOrder ?? 0, queue: queueOf(s.data.material ?? s.data.trail),
        distance: s.data.world[14] - CAMERA_Z + (s.data.renderer.m_SortingFudge ?? 0), draw: () => this.drawSystem(s, globals, halfH),
      })),
      ...sprites.map((s) => ({ order: s.data.order, queue: 3000, distance: s.data.z - CAMERA_Z, draw: () => this.drawSprite(s, time) })),
    ];
    items.sort((a, b) => a.order - b.order || a.queue - b.queue || b.distance - a.distance);
    for (const it of items) it.draw();
    this.post.end(W, H);
  }

  private drawSprite(s: Sprite, time: number) {
    const gl = this.gl;
    const c = spriteColor(s.data, time);
    if (c[3] <= 0) return;
    gl.useProgram(this.sprite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.texture.tex);
    gl.uniform1i(gl.getUniformLocation(this.sprite, "tex"), 0);
    gl.uniform4f(gl.getUniformLocation(this.sprite, "color"), c[0], c[1], c[2], c[3]);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawSystem(s: System, globals: Record<string, number[]>, halfH: number) {
    if (s.shader && s.data.material) {
      this.geometry(s, halfH);
      this.drawMesh(s.data.material, s.shader, s.textures, globals);
    }
    if (s.trail && s.data.trail) {
      this.trails(s);
      this.drawMesh(s.data.trail, s.trail.shader, s.trail.textures, globals);
    }
  }

  /** The vertices in this.verts (FLOATS each) as triangles through a material's shader. */
  private drawMesh(m: Json, shader: Shader, textures: Record<string, Texture>, globals: Record<string, number[]>) {
    const gl = this.gl;
    const BL = GL_BLEND(gl);
    if (!this.verts.n) return;
    const prog = this.program(shader);
    gl.useProgram(prog.pr);
    const value = (name: string): number[] | undefined => {
      if (name in globals) return globals[name];
      if (name in m.floats) return [m.floats[name]];
      if (name in m.colors) return m.colors[name];
      const tex = name.replace(/_(ST|TexelSize)$/, "");
      const t = m.textures[tex];
      if (t && name.endsWith("_ST")) return [t.scale[0], t.scale[1], t.offset[0], t.offset[1]];
      const T = textures[tex];
      if (T && name.endsWith("_TexelSize")) return [1 / T.w, 1 / T.h, T.w, T.h];
      return undefined;
    };
    for (const a of prog.arrays) {
      const bind = (a.pixel ? shader.pixel : shader.vertex).cb[a.cb];
      const data = new Float32Array(a.size * 4);
      for (const p of bind?.params ?? []) {
        const v = value(p.name);
        if (!v) continue;
        const at = p.offset / 4;
        for (let i = 0; i < Math.min(v.length, p.dim) && at + i < data.length; i++) data[at + i] = v[i];
      }
      gl.uniform4fv(gl.getUniformLocation(prog.pr, a.name), data);
    }
    let unit = 0;
    for (const [binds, prefix] of [[shader.vertex, "t"], [shader.pixel, "pt"]] as const) {
      for (const [reg, name] of Object.entries(binds.t)) {
        const loc = gl.getUniformLocation(prog.pr, `${prefix}${reg}`);
        if (!loc) continue;
        const T = textures[name] ?? (name === "_CameraDepthTexture" ? this.depth : this.white);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, T.tex);
        gl.uniform1i(loc, unit++);
      }
    }
    const factor = (f: Factor) => BL[f.name && f.name !== "<noninit>" ? m.floats[f.name] ?? f.value : f.value] ?? gl.ONE;
    const b = shader.blend;
    gl.blendFuncSeparate(factor(b.src), factor(b.dst), factor(b.srcAlpha), factor(b.dstAlpha));

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.data.subarray(0, this.verts.n * FLOATS), gl.STREAM_DRAW);
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    for (const { loc, sem } of prog.attrs) {
      if (loc < 0) continue;
      const tc = /^TEXCOORD(\d)$/.exec(sem);
      const pointer = (size: number, off: number) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off * 4);
      };
      if (sem === "POSITION0") pointer(3, 0);
      else if (sem === "COLOR0") pointer(4, 3);
      else if (tc && +tc[1] < 3) pointer(4, 7 + 4 * +tc[1]);
      else if (sem === "NORMAL0") gl.vertexAttrib4f(loc, 0, 0, -1, 0);
      else if (sem === "TANGENT0") gl.vertexAttrib4f(loc, 1, 0, 0, 1);
      else gl.vertexAttrib4f(loc, 0, 0, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, this.verts.n);
  }

  /** The trails as ribbons facing the camera, from each particle (u 0) back along where it has been (u 1): their width
   *  over the trail times the particle's size, their colour the particle's times the colour over its life and over the
   *  trail. The UV is the only stream a trail gets. */
  private trails(s: System) {
    const out = this.verts;
    out.reset();
    const tm = s.data.ps.TrailModule;
    const W = s.data.world as number[];
    const toWorld = (p: Vec3): Vec3 => [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13],
                                        W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]];
    const ribbon = (p: Particle, alive: boolean) => {
      const pts: Vec3[] = alive ? [toWorld(p.pos)] : [];
      for (let i = p.trail!.length - 1; i >= 0; i--) {
        const q = toWorld(p.trail![i].pos), prev = pts[pts.length - 1];
        if (!prev || Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]) > 1e-5) pts.push(q);
      }
      if (pts.length < 2) return;
      const along = [0];
      for (let i = 1; i < pts.length; i++) {
        along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      }
      const total = along[along.length - 1];
      if (total <= 0) return;
      const look = s.emitter.look(p);
      const life = minMaxColor(tm.colorOverLifetime, Math.min(1, p.age / p.life), p.r[6]);
      const base = tm.inheritParticleColor ? look.color : [1, 1, 1, 1];
      const size = tm.sizeAffectsWidth ? look.size[0] : 1;
      const edges = pts.map((q, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
        const x = along[i] / total;
        const w = (minMax(tm.widthOverTrail, x, p.r[6]) * size) / 2;
        const c = minMaxColor(tm.colorOverTrail, x, p.r[6]);
        return {
          x, color: [base[0] * life[0] * c[0], base[1] * life[1] * c[1], base[2] * life[2] * c[2], base[3] * life[3] * c[3]],
          left: [q[0] - ty * w, q[1] + tx * w, q[2]] as Vec3, right: [q[0] + ty * w, q[1] - tx * w, q[2]] as Vec3,
        };
      });
      const vert = (q: Vec3, c: number[], u: number, v: number) => out.put(q[0], q[1], q[2], c, NO_STREAMS, 0, u, v);
      for (let i = 0; i + 1 < edges.length; i++) {
        const e0 = edges[i], e1 = edges[i + 1];
        vert(e0.left, e0.color, e0.x, 1); vert(e0.right, e0.color, e0.x, 0); vert(e1.right, e1.color, e1.x, 0);
        vert(e0.left, e0.color, e0.x, 1); vert(e1.right, e1.color, e1.x, 0); vert(e1.left, e1.color, e1.x, 1);
      }
    };
    for (const p of s.emitter.particles) if (p.trail) ribbon(p, true);
    for (const g of s.emitter.ghosts) ribbon(g, false);
  }

  /** Triangles (FLOATS a vertex) for every particle of a system, in the world, into this.verts. A mesh particle's
   *  rotation is one matrix (z, then x, then y, Unity's order) for all its vertices. */
  private geometry(s: System, halfH: number) {
    const out = this.verts;
    out.reset();
    const W = s.data.world as number[];
    const toWorld = (p: Vec3): Vec3 => [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13],
                                        W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]];
    const dirWorld = (p: Vec3): Vec3 => [W[0] * p[0] + W[4] * p[1] + W[8] * p[2], W[1] * p[0] + W[5] * p[1] + W[9] * p[2],
                                         W[2] * p[0] + W[6] * p[1] + W[10] * p[2]];
    const r = s.data.renderer, mode = r.m_RenderMode;
    const slots = (s.data._slots ??= layout(r)) as Slot[];
    const uvAt = slots.find((x) => x.stream === UV_STREAM)?.at ?? -1;
    const maxSize = (r.m_MaxParticleSize ?? 10) * halfH * 2;   // a fraction of the screen's height
    const local = r.m_RenderAlignment === 2;
    for (const p of s.emitter.particles) {
      const look = s.emitter.look(p);
      const c = look.color;
      const [tx, ty] = look.tiles;
      const col = look.frame % tx, row = Math.floor(look.frame / tx);
      const u0 = col / tx, u1 = (col + 1) / tx, v1 = 1 - row / ty, v0 = 1 - (row + 1) / ty;
      const [cx, cy, cz] = toWorld(p.pos);
      const tc = streams(slots, p, look, [cx, cy, cz], dirWorld(p.vel));
      const quad = (rx: number, ry: number, rz: number, ux: number, uy: number, uz: number) => {
        const ax = cx - (rx + ux) / 2, ay = cy - (ry + uy) / 2, az = cz - (rz + uz) / 2;   // corner (-.5, -.5)
        out.put(ax, ay, az, c, tc, uvAt, u0, v0);
        out.put(ax + rx, ay + ry, az + rz, c, tc, uvAt, u1, v0);
        out.put(ax + rx + ux, ay + ry + uy, az + rz + uz, c, tc, uvAt, u1, v1);
        out.put(ax, ay, az, c, tc, uvAt, u0, v0);
        out.put(ax + rx + ux, ay + ry + uy, az + rz + uz, c, tc, uvAt, u1, v1);
        out.put(ax + ux, ay + uy, az + uz, c, tc, uvAt, u0, v1);
      };
      if (mode === 0) {
        const w = Math.min(look.size[0], maxSize), h = Math.min(look.size[1], maxSize);
        let right: Vec3 = [1, 0, 0], up: Vec3 = [0, 1, 0];
        if (local) { right = dirWorld([1, 0, 0]); up = dirWorld([0, 1, 0]); }
        const a = -p.rot[2], ca = Math.cos(a), sa = Math.sin(a);
        quad((right[0] * ca + up[0] * sa) * w, (right[1] * ca + up[1] * sa) * w, (right[2] * ca + up[2] * sa) * w,
             (up[0] * ca - right[0] * sa) * h, (up[1] * ca - right[1] * sa) * h, (up[2] * ca - right[2] * sa) * h);
      } else if (mode === 1) {
        const v = dirWorld(p.vel);
        const speed = Math.hypot(v[0], v[1]);
        const dx = speed > 1e-6 ? v[0] / speed : 1, dy = speed > 1e-6 ? v[1] / speed : 0;
        // the width is the size's x; the length its y (the same, unless the size is 3D) by the length scale, plus the speed
        const len = look.size[1] * (r.m_LengthScale ?? 1) + Math.hypot(...v) * (r.m_VelocityScale ?? 0);
        const w = Math.min(look.size[0], maxSize);
        quad(dx * len, dy * len, 0, -dy * w, dx * w, 0);
      } else if (mode === 4 && s.mesh) {
        const flat = meshFlat(s.mesh);
        const M = particleMatrix(p.rot, look.size, local ? W : null);
        for (let i = 0; i < flat.length; i += 5) {
          const x = flat[i], y = flat[i + 1], z = flat[i + 2];
          out.put(cx + M[0] * x + M[3] * y + M[6] * z, cy + M[1] * x + M[4] * y + M[7] * z, cz + M[2] * x + M[5] * y + M[8] * z,
                  c, tc, uvAt, flat[i + 3], flat[i + 4]);
        }
      }
    }
  }
}

/** The particle's values for the renderer's vertex streams, in their TEXCOORD places (the UV is filled per vertex). */
function streams(slots: Slot[], p: Particle, look: ReturnType<Emitter["look"]>, centre: Vec3, vel: Vec3): number[] {
  const tc = new Array(12).fill(0);
  for (const { stream: st, at, n } of slots) {
    let v: number[] = [];
    if (st === 9) v = [look.frame];
    else if (st === 10) v = centre;
    else if (st >= 12 && st <= 14) v = look.size;
    else if (st === 15) v = [p.rot[2]];
    else if (st === 16) v = p.rot;
    else if (st === 19) v = vel;
    else if (st === 20) v = [Math.hypot(...vel)];
    else if (st === 21) v = [look.agePercent];
    else if (st === 22) v = [1 / p.life];
    else if (st >= 23 && st <= 30) v = p.sr;
    else if (st >= 31 && st <= 34) v = look.custom[0];
    else if (st >= 35 && st <= 38) v = look.custom[1];
    for (let i = 0; i < n && at + i < 12; i++) tc[at + i] = v[i] ?? 0;
  }
  return tc;
}
