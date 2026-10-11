/** Master Duel's post-processing over the summon background, as its global volume sets it (bloom: threshold 1.1,
 *  intensity 5.5, scatter 0.4; vignette: black, intensity 0.3, smoothness 0.4; no tonemapping) and URP draws it in a
 *  gamma-space project: the scene goes to a half-float target so additive particles can pass 1; the bloom is
 *  thresholded at half size, blurred down a chain of mips (a 9-tap horizontal pass that halves, a 5-tap vertical one)
 *  and blended back up by the scatter; the last pass turns the scene linear, adds the bloom, darkens the corners and
 *  goes back to sRGB, clamped. Without float targets the scene stays 8-bit and only the vignette shows. */

const VS = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
  uv = p * .5 + .5;
  gl_Position = vec4(p, 0., 1.);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
`;

const FS = {
  prefilter: `${HEAD}
uniform vec4 params;   // threshold, knee, clamp
void main() {
  vec3 c = min(texture(src, uv).rgb, vec3(params.z));
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - params.x + params.y, 0., 2. * params.y);
  soft = soft * soft / (4. * params.y + 1e-4);
  c *= max(b - params.x, soft) / max(b, 1e-4);
  o = vec4(max(c, 0.), 1.);
}`,
  blurH: `${HEAD}
uniform float texel;   // the source's texel, doubled: this pass also halves
void main() {
  const float w[5] = float[5](.22702703, .19459459, .12162162, .05405405, .01621622);
  vec3 c = texture(src, uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(src, uv + vec2(texel * float(i), 0.)).rgb * w[i];
    c += texture(src, uv - vec2(texel * float(i), 0.)).rgb * w[i];
  }
  o = vec4(c, 1.);
}`,
  blurV: `${HEAD}
uniform float texel;
void main() {
  vec3 c = texture(src, uv).rgb * .22702703;
  c += (texture(src, uv + vec2(0., texel * 1.38461538)).rgb + texture(src, uv - vec2(0., texel * 1.38461538)).rgb) * .31621622;
  c += (texture(src, uv + vec2(0., texel * 3.23076923)).rgb + texture(src, uv - vec2(0., texel * 3.23076923)).rgb) * .07027027;
  o = vec4(c, 1.);
}`,
  upsample: `${HEAD}
uniform sampler2D low;
uniform float scatter;
void main() {
  o = vec4(mix(texture(src, uv).rgb, texture(low, uv).rgb, scatter), 1.);
}`,
  final: `${HEAD}
uniform sampler2D bloom;
uniform float intensity;
uniform vec4 vignette;   // centre x, y, intensity, smoothness
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c));
}
void main() {
  vec3 c = toLinear(max(texture(src, uv).rgb, 0.));
  c += texture(bloom, uv).rgb * intensity;
  vec2 d = abs(uv - vignette.xy) * vignette.z;
  c *= pow(clamp(1. - dot(d, d), 0., 1.), vignette.w);
  o = vec4(toSrgb(clamp(c, 0., 1.)), 1.);
}`,
};

// Master Duel's GlobalPostProcessVolume Profile
const BLOOM = { threshold: 1.1, intensity: 5.5, scatter: 0.4, clamp: 65472, skipIterations: 1, maxIterations: 6 };
const VIGNETTE = { intensity: 0.3, smoothness: 0.4 };

/** The vignette's darkening at a point of the screen (u, v in 0..1), as a black layer's opacity over the finished
 *  picture: URP multiplies the linear colour by f, which in sRGB is close to multiplying by f^(1/2.2). For a page that
 *  lays the vignette over more than the background (the cut-in drawn on top of it). */
export function vignetteAlpha(u: number, v: number): number {
  const dx = Math.abs(u - 0.5) * VIGNETTE.intensity * 3, dy = Math.abs(v - 0.5) * VIGNETTE.intensity * 3;
  const f = Math.pow(Math.min(Math.max(1 - (dx * dx + dy * dy), 0), 1), VIGNETTE.smoothness * 5);
  return 1 - Math.pow(f, 1 / 2.2);
}

type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };

export class Post {
  private programs: Record<keyof typeof FS, WebGLProgram>;
  private vao: WebGLVertexArrayObject;
  private hdr: boolean;
  private scene: Target | null = null;
  private down: Target[] = [];
  private up: Target[] = [];
  private tmp: Target[] = [];

  /** `vignette` off when the page lays it over the whole picture itself (vignetteAlpha). */
  constructor(private gl: WebGL2RenderingContext, private vignette = true) {
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "post shader");
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VS);
    const make = (fs: string) => {
      const pr = gl.createProgram()!;
      gl.attachShader(pr, vs);
      gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || "post program");
      return pr;
    };
    this.programs = Object.fromEntries(Object.entries(FS).map(([k, fs]) => [k, make(fs)])) as Post["programs"];
    this.vao = gl.createVertexArray()!;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private release(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  dispose() {
    for (const t of [this.scene, ...this.down, ...this.up, ...this.tmp]) this.release(t);
    for (const pr of Object.values(this.programs)) this.gl.deleteProgram(pr);
    this.gl.deleteVertexArray(this.vao);
  }

  /** Bind the scene target (made again when the canvas changes size) and clear it to black. */
  begin(w: number, h: number) {
    const gl = this.gl;
    if (!this.scene || this.scene.w !== w || this.scene.h !== h) {
      for (const t of [this.scene, ...this.down, ...this.up, ...this.tmp]) this.release(t);
      this.scene = this.target(w, h);
      // the bloom's chain: half size first, as many halvings as URP takes for this size
      const tw = Math.max(1, w >> 1), th = Math.max(1, h >> 1);
      const iterations = Math.floor(Math.log2(Math.max(tw, th)) - 1);
      const mips = Math.min(Math.max(iterations - BLOOM.skipIterations, 1), BLOOM.maxIterations);
      this.down = []; this.up = []; this.tmp = [];
      for (let i = 0; i < mips; i++) {
        const mw = Math.max(1, tw >> i), mh = Math.max(1, th >> i);
        this.down.push(this.target(mw, mh));
        this.up.push(this.target(mw, mh));
        this.tmp.push(this.target(mw, mh));
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private pass(program: WebGLProgram, dst: Target | null, w: number, h: number, inputs: [string, WebGLTexture][], set?: (pr: WebGLProgram) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    inputs.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(program, name), i);
    });
    set?.(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Bloom the scene and draw it to the canvas. */
  end(w: number, h: number) {
    const gl = this.gl, P = this.programs, scene = this.scene!;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const threshold = Math.pow(BLOOM.threshold, 2.2);   // Mathf.GammaToLinearSpace, as URP passes it
    this.pass(P.prefilter, this.down[0], this.down[0].w, this.down[0].h, [["src", scene.tex]], (pr) =>
      gl.uniform4f(gl.getUniformLocation(pr, "params"), threshold, threshold * 0.5, BLOOM.clamp, 0));
    for (let i = 1; i < this.down.length; i++) {
      const src = this.down[i - 1], d = this.down[i], t = this.tmp[i];
      this.pass(P.blurH, t, t.w, t.h, [["src", src.tex]], (pr) => gl.uniform1f(gl.getUniformLocation(pr, "texel"), 2 / src.w));
      this.pass(P.blurV, d, d.w, d.h, [["src", t.tex]], (pr) => gl.uniform1f(gl.getUniformLocation(pr, "texel"), 1 / t.h));
    }
    const scatter = 0.05 + (0.95 - 0.05) * BLOOM.scatter;
    for (let i = this.down.length - 2; i >= 0; i--) {
      const low = i === this.down.length - 2 ? this.down[i + 1] : this.up[i + 1];
      const d = this.up[i];
      this.pass(P.upsample, d, d.w, d.h, [["src", this.down[i].tex], ["low", low.tex]], (pr) =>
        gl.uniform1f(gl.getUniformLocation(pr, "scatter"), scatter));
    }
    const bloom = this.down.length > 1 ? this.up[0] : this.down[0];
    this.pass(P.final, null, w, h, [["src", scene.tex], ["bloom", bloom.tex]], (pr) => {
      gl.uniform1f(gl.getUniformLocation(pr, "intensity"), BLOOM.intensity);
      gl.uniform4f(gl.getUniformLocation(pr, "vignette"), 0.5, 0.5, this.vignette ? VIGNETTE.intensity * 3 : 0, VIGNETTE.smoothness * 5);
    });
  }
}
