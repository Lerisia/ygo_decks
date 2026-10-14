import type { AtlasPage, AtlasRegion } from "./atlas";
import type { Blend, MeshAttachment, RegionAttachment } from "./data";
import { RAD } from "./bone";
import { type Skeleton, type Slot, worldVertices } from "./skeleton";

const VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; in vec4 a_light; in vec3 a_dark;
uniform vec4 u_view;
out vec2 v_uv; out vec4 v_light; out vec3 v_dark;
void main() {
  v_uv = a_uv; v_light = a_light; v_dark = a_dark;
  gl_Position = vec4((a_pos - u_view.xy) / u_view.zw, 0., 1.);
}`;

// textures are premultiplied, so no colour may exceed its alpha: the pages' lossy compression leaves colour noise under
// clear pixels, which would otherwise add a faint box around every image; a dark colour (two-colour tint) lifts the
// shadows, black leaves the light tint alone
const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv; in vec4 v_light; in vec3 v_dark;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  t.rgb = min(t.rgb, vec3(t.a));
  o.a = t.a * v_light.a;
  o.rgb = (t.a - t.rgb) * v_dark + t.rgb * v_light.rgb;
}`;

const FLOATS = 11;   // x y u v r g b a dr dg db

/** Draws a posed skeleton with WebGL2: its region and mesh attachments in draw order, each slot's blend mode, and the
 *  clipping polygons. */
export class SpineRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private textures = new Map<AtlasPage, WebGLTexture>();
  private uvCache = new Map<object, number[]>();
  private regionCache = new Map<RegionAttachment, number[]>();
  private verts: number[] = [];
  private indices: number[] = [];
  private page: AtlasPage | null = null;
  private blend: Blend = "normal";
  private world: number[] = [];

  constructor(private canvas: HTMLCanvasElement, private regions: Map<string, AtlasRegion>) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) throw new Error("WebGL2를 쓸 수 없습니다.");
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || "program");
    this.program = pr;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(pr, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, offset * 4);
    };
    attr("a_pos", 2, 0);
    attr("a_uv", 2, 2);
    attr("a_light", 4, 4);
    attr("a_dark", 3, 8);
    gl.bindVertexArray(null);
  }

  addPage(page: AtlasPage, image: TexImageSource) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !page.pma);   // everything is drawn premultiplied
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);   // as the atlases ask (no mipmaps)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(page, t);
  }

  /** Wait until the GPU has done all it was asked. */
  finish() {
    this.gl.finish();
  }

  /** Draw the skeleton through a view centred on (cx, cy) showing halfW / halfH skeleton units each way. */
  draw(sk: Skeleton, cx: number, cy: number, halfW: number, halfH: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform4f(gl.getUniformLocation(this.program, "u_view"), cx, cy, halfW, halfH);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_tex"), 0);
    gl.enable(gl.BLEND);
    this.page = null;
    let clip: Clip | null = null;
    for (const slot of sk.drawOrder) {
      const att = slot.attachment;
      if (att && slot.bone && slot.data.visible) {
        if (att.kind === "clipping") {
          if (!clip) {
            const poly: number[] = [];
            worldVertices(slot, att.vertices, 0, att.vertices.worldLength, poly);
            clip = new Clip(poly, att.end);
          }
        } else if (att.kind === "region" || att.kind === "mesh") {
          const region = this.regions.get(att.path);
          if (region) this.add(slot, att, region, clip);
        }
      }
      if (clip && clip.end === slot.data) clip = null;
    }
    this.flush();
  }

  /** The box (minX, minY, maxX, maxY) around everything the pose would draw. */
  bounds(sk: Skeleton): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const world = this.world;
    for (const slot of sk.drawOrder) {
      const att = slot.attachment;
      if (!att || !slot.data.visible || slot.color[3] === 0) continue;
      let n = 0;
      if (att.kind === "region") {
        const region = this.regions.get(att.path);
        if (!region) continue;
        const o = this.regionOffsets(att, region), b = slot.bone;
        for (let i = 0; i < 8; i += 2) {
          world[i] = o[i] * b.a + o[i + 1] * b.b + b.worldX;
          world[i + 1] = o[i] * b.c + o[i + 1] * b.d + b.worldY;
        }
        n = 8;
      } else if (att.kind === "mesh") {
        worldVertices(slot, att.vertices, 0, att.vertices.worldLength, world);
        n = att.vertices.worldLength;
      }
      for (let i = 0; i < n; i += 2) {
        x0 = Math.min(x0, world[i]); x1 = Math.max(x1, world[i]);
        y0 = Math.min(y0, world[i + 1]); y1 = Math.max(y1, world[i + 1]);
      }
    }
    return [x0, y0, x1, y1];
  }

  private add(slot: Slot, att: RegionAttachment | MeshAttachment, region: AtlasRegion, clip: Clip | null) {
    let pos: number[], uvs: number[], tris: number[];
    const world = this.world;
    if (att.kind === "region") {
      const offset = this.regionOffsets(att, region);
      const b = slot.bone;
      for (let i = 0; i < 8; i += 2) {
        world[i] = offset[i] * b.a + offset[i + 1] * b.b + b.worldX;
        world[i + 1] = offset[i] * b.c + offset[i + 1] * b.d + b.worldY;
      }
      pos = world.slice(0, 8);
      uvs = regionUVs(region);
      tris = [0, 1, 2, 2, 3, 0];
    } else {
      worldVertices(slot, att.vertices, 0, att.vertices.worldLength, world);
      pos = world.slice(0, att.vertices.worldLength);
      uvs = this.meshUVs(att, region);
      tris = att.triangles;
    }
    const sc = slot.color, ac = att.color;
    const alpha = sc[3] * ac[3];
    if (alpha === 0) return;
    const light = [sc[0] * ac[0] * alpha, sc[1] * ac[1] * alpha, sc[2] * ac[2] * alpha, alpha];
    const dark = slot.dark ? [slot.dark[0], slot.dark[1], slot.dark[2]] : [0, 0, 0];
    if (clip) [pos, uvs, tris] = clip.triangles(pos, uvs, tris);
    if (!tris.length) return;
    if (region.page !== this.page || slot.data.blend !== this.blend) {
      this.flush();
      this.page = region.page;
      this.blend = slot.data.blend;
    }
    const base = this.verts.length / FLOATS;
    for (let i = 0; i < pos.length; i += 2) {
      this.verts.push(pos[i], pos[i + 1], uvs[i], uvs[i + 1], light[0], light[1], light[2], light[3], dark[0], dark[1], dark[2]);
    }
    for (const t of tris) this.indices.push(base + t);
  }

  private flush() {
    if (!this.indices.length || !this.page) {
      this.verts.length = 0;
      this.indices.length = 0;
      return;
    }
    const gl = this.gl;
    switch (this.blend) {
      case "additive": gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE); break;
      case "multiply": gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break;
      case "screen": gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      default: gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(this.page)!);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.verts), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices), gl.STREAM_DRAW);
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    this.verts.length = 0;
    this.indices.length = 0;
  }

  /** A region attachment's corners in its bone's space: the image laid out at its size, rotation and offset, the
   *  stripped whitespace taken into account. */
  private regionOffsets(att: RegionAttachment, region: AtlasRegion): number[] {
    let o = this.regionCache.get(att);
    if (o) return o;
    const rsx = (att.width / region.originalWidth) * att.scaleX, rsy = (att.height / region.originalHeight) * att.scaleY;
    const lx = (-att.width / 2) * att.scaleX + region.offsetX * rsx, ly = (-att.height / 2) * att.scaleY + region.offsetY * rsy;
    const lx2 = lx + region.width * rsx, ly2 = ly + region.height * rsy;
    const r = att.rotation * RAD, cos = Math.cos(r), sin = Math.sin(r);
    const corner = (x: number, y: number) => [x * cos - y * sin + att.x, x * sin + y * cos + att.y];
    o = [...corner(lx, ly), ...corner(lx, ly2), ...corner(lx2, ly2), ...corner(lx2, ly)];
    this.regionCache.set(att, o);
    return o;
  }

  /** A mesh's texture coordinates on the page: its uvs are given over the whole original image of its region. */
  private meshUVs(att: MeshAttachment, region: AtlasRegion): number[] {
    let uvs = this.uvCache.get(att);
    if (uvs) return uvs;
    const src = att.uvs, n = src.length, pw = region.page.width, ph = region.page.height;
    uvs = new Array<number>(n);
    let u = region.u, v = region.v, w: number, h: number;
    switch (region.degrees) {
      case 90:
        u -= (region.originalHeight - region.offsetY - region.height) / pw;
        v -= (region.originalWidth - region.offsetX - region.width) / ph;
        w = region.originalHeight / pw;
        h = region.originalWidth / ph;
        for (let i = 0; i < n; i += 2) {
          uvs[i] = u + src[i + 1] * w;
          uvs[i + 1] = v + (1 - src[i]) * h;
        }
        break;
      case 180:
        u -= (region.originalWidth - region.offsetX - region.width) / pw;
        v -= region.offsetY / ph;
        w = region.originalWidth / pw;
        h = region.originalHeight / ph;
        for (let i = 0; i < n; i += 2) {
          uvs[i] = u + (1 - src[i]) * w;
          uvs[i + 1] = v + (1 - src[i + 1]) * h;
        }
        break;
      case 270:
        u -= region.offsetY / pw;
        v -= region.offsetX / ph;
        w = region.originalHeight / pw;
        h = region.originalWidth / ph;
        for (let i = 0; i < n; i += 2) {
          uvs[i] = u + (1 - src[i + 1]) * w;
          uvs[i + 1] = v + src[i] * h;
        }
        break;
      default:
        u -= region.offsetX / pw;
        v -= (region.originalHeight - region.offsetY - region.height) / ph;
        w = region.originalWidth / pw;
        h = region.originalHeight / ph;
        for (let i = 0; i < n; i += 2) {
          uvs[i] = u + src[i] * w;
          uvs[i + 1] = v + src[i + 1] * h;
        }
    }
    this.uvCache.set(att, uvs);
    return uvs;
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

/** Page coordinates of a region attachment's corners, in the order of its offsets. */
function regionUVs(r: AtlasRegion): number[] {
  if (r.degrees === 90) return [r.u2, r.v2, r.u, r.v2, r.u, r.v, r.u2, r.v];
  return [r.u, r.v2, r.u, r.v, r.u2, r.v, r.u2, r.v2];
}

/** A clipping polygon: what is drawn until its end slot is cut to it. The polygon is split into triangles (each
 *  convex) and every triangle drawn is cut against each of them. */
class Clip {
  private pieces: number[][];

  constructor(polygon: number[], readonly end: import("./data").SlotData | null) {
    let area = 0;
    for (let i = 0, n = polygon.length; i < n; i += 2) {
      const j = (i + 2) % n;
      area += polygon[i] * polygon[j + 1] - polygon[j] * polygon[i + 1];
    }
    if (area < 0) {
      const flipped: number[] = [];
      for (let i = polygon.length - 2; i >= 0; i -= 2) flipped.push(polygon[i], polygon[i + 1]);
      polygon = flipped;
    }
    this.pieces = earClip(polygon);
  }

  triangles(pos: number[], uvs: number[], tris: number[]): [number[], number[], number[]] {
    const outPos: number[] = [], outUV: number[] = [], outTris: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const tri: number[][] = [0, 1, 2].map((k) => {
        const v = tris[t + k];
        return [pos[v * 2], pos[v * 2 + 1], uvs[v * 2], uvs[v * 2 + 1]];
      });
      for (const piece of this.pieces) {
        const poly = clipConvex(tri, piece);
        if (poly.length < 3) continue;
        const base = outPos.length / 2;
        for (const p of poly) {
          outPos.push(p[0], p[1]);
          outUV.push(p[2], p[3]);
        }
        for (let k = 1; k < poly.length - 1; k++) outTris.push(base, base + k, base + k + 1);
      }
    }
    return [outPos, outUV, outTris];
  }
}

/** Sutherland–Hodgman: the part of a polygon (x, y, u, v points) inside a counter-clockwise convex polygon. */
function clipConvex(subject: number[][], clip: number[]): number[][] {
  let out = subject;
  for (let i = 0, n = clip.length; i < n && out.length; i += 2) {
    const ax = clip[i], ay = clip[i + 1], bx = clip[(i + 2) % n], by = clip[(i + 3) % n];
    const side = (p: number[]) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k], q = input[(k + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push(p.map((v, m) => v + (q[m] - v) * t));
      }
    }
  }
  return out;
}

/** A simple counter-clockwise polygon cut into triangles (ear clipping), each as a flat x, y list. */
function earClip(poly: number[]): number[][] {
  const idx: number[] = [];
  for (let i = 0; i < poly.length / 2; i++) idx.push(i);
  const out: number[][] = [];
  const x = (i: number) => poly[i * 2], y = (i: number) => poly[i * 2 + 1];
  const cross = (a: number, b: number, c: number) => (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([x(a), y(a), x(b), y(b), x(c), y(c)]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.flatMap((i) => [x(i), y(i)]));
  return out;
}
