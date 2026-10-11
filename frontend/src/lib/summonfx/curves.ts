/** Unity's serialized curves and gradients, evaluated: AnimationCurve (Hermite between keys), MinMaxCurve (a constant,
 *  a curve, two curves or two constants, picked between by a random number) and MinMaxGradient / Gradient. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export function curve(c: Json, t: number): number {
  const keys: Json[] = c?.m_Curve ?? [];
  if (!keys.length) return 0;
  if (t <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.value;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].time) i++;
  const a = keys[i], b = keys[i + 1];
  const dt = b.time - a.time;
  if (!isFinite(a.outSlope) || !isFinite(b.inSlope)) return a.value;   // a stepped key
  const s = (t - a.time) / dt, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a.value + (s3 - 2 * s2 + s) * a.outSlope * dt + (-2 * s3 + 3 * s2) * b.value + (s3 - s2) * b.inSlope * dt;
}

/** A MinMaxCurve at time t (0..1 of its span) for the random number r. */
export function minMax(c: Json, t: number, r: number): number {
  if (!c) return 0;
  switch (c.minMaxState) {
    case 0: return c.scalar;
    case 1: return curve(c.maxCurve, t) * c.scalar;
    case 2: return (curve(c.minCurve, t) + (curve(c.maxCurve, t) - curve(c.minCurve, t)) * r) * c.scalar;
    case 3: return c.minScalar + (c.scalar - c.minScalar) * r;
    default: return c.scalar ?? 0;
  }
}

export type RGBA = [number, number, number, number];

export function gradient(g: Json, t: number): RGBA {
  const nc = g.m_NumColorKeys ?? 2, na = g.m_NumAlphaKeys ?? 2;
  const key = (i: number) => g[`key${i}`];
  const ct = (i: number) => g[`ctime${i}`] / 65535, at = (i: number) => g[`atime${i}`] / 65535;
  const fixed = g.m_Mode === 1;
  const pick = (n: number, time: (i: number) => number, get: (i: number) => number[]): number[] => {
    if (t <= time(0)) return get(0);
    for (let i = 0; i < n - 1; i++) {
      if (t <= time(i + 1)) {
        if (fixed) return get(i + 1);
        const f = (t - time(i)) / Math.max(1e-6, time(i + 1) - time(i));
        const a = get(i), b = get(i + 1);
        return a.map((v, k) => v + (b[k] - v) * f);
      }
    }
    return get(n - 1);
  };
  const rgb = pick(nc, ct, (i) => [key(i).r, key(i).g, key(i).b]);
  const [a] = pick(na, at, (i) => [key(i).a]);
  return [rgb[0], rgb[1], rgb[2], a];
}

const color = (c: Json): RGBA => [c.r, c.g, c.b, c.a];

/** A MinMaxGradient at time t (0..1) for the random number r. */
export function minMaxColor(c: Json, t: number, r: number): RGBA {
  if (!c) return [1, 1, 1, 1];
  switch (c.minMaxState) {
    case 0: return color(c.maxColor);
    case 1: return gradient(c.maxGradient, t);
    case 2: {
      const a = color(c.minColor), b = color(c.maxColor);
      return a.map((v, k) => v + (b[k] - v) * r) as RGBA;
    }
    case 3: {
      const a = gradient(c.minGradient, t), b = gradient(c.maxGradient, t);
      return a.map((v, k) => v + (b[k] - v) * r) as RGBA;
    }
    case 4: return gradient(c.maxGradient, r);
    default: return color(c.maxColor);
  }
}
