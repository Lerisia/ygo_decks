/** A Unity ParticleSystem replayed from its serialized modules, as far as Master Duel's summon backgrounds use them:
 *  emission (rate over time and bursts), cone / circle / sphere shapes, start values, size / colour / rotation /
 *  velocity over lifetime, the velocity limit, texture sheet frames and custom data. Written from Unity's documented
 *  behaviour; its random numbers are not Unity's, so the particles fall differently each run, as Unity's do between
 *  seeds. Positions are in the system's own space (its renderer places them in the world). */
import { minMax, minMaxColor, type RGBA } from "./curves";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** A small seeded random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Particle = {
  pos: Vec3; vel: Vec3; age: number; life: number;
  size0: Vec3; rot: Vec3; color0: RGBA;
  /** Stable random numbers per particle, for the "between two curves / constants" choices over its life. */
  r: number[];
  /** The StableRandom vertex stream: four numbers that stay with the particle. */
  sr: number[];
  /** Where it has been (oldest first), when the trail module gives it a trail, and how long a point of it lasts. */
  trail?: TrailPoint[];
  trailLife?: number;
};

export type TrailPoint = { pos: Vec3; t: number };

/** Rotation of a vector by Euler angles in degrees, in Unity's order (z, then x, then y). */
export function euler(v: Vec3, e: { x: number; y: number; z: number }): Vec3 {
  let [x, y, z] = v;
  let c = Math.cos(e.z * RAD), s = Math.sin(e.z * RAD);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(e.x * RAD); s = Math.sin(e.x * RAD);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(e.y * RAD); s = Math.sin(e.y * RAD);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}

export class Emitter {
  particles: Particle[] = [];
  /** Dead particles whose trails stay until their points expire (the trail module's dieWithParticles off). */
  ghosts: Particle[] = [];
  private t = 0;
  private delay = 0;
  private carry = 0;
  private random: () => number;

  /** `world`: the system's matrix (column-major), for velocities the module gives in world space. */
  constructor(readonly ps: Json, seed: number, private world: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {
    this.random = rng(seed);
    this.reset(seed);
  }

  reset(seed: number) {
    this.random = rng(seed);
    this.particles = [];
    this.ghosts = [];
    this.t = 0;
    this.carry = 0;
    this.delay = minMax(this.ps.startDelay, 0, this.random());
  }

  /** Advance the system by dt seconds of its own time. */
  step(dt: number) {
    const ps = this.ps, dur = ps.lengthInSec || 1;
    const before = this.t - this.delay;
    this.t += dt * (ps.simulationSpeed ?? 1);
    const now = this.t - this.delay;
    this.age(dt * (ps.simulationSpeed ?? 1));
    if (now <= 0) return;
    const from = Math.max(0, before);
    if (!ps.looping && from >= dur) return;
    const until = ps.looping ? now : Math.min(now, dur);
    const em = ps.EmissionModule;
    if (em) {
      const rate = minMax(em.rateOverTime, ((from % dur) + dur) % dur / dur, this.random());
      this.carry += rate * (until - from);
      while (this.carry >= 1) {
        this.carry -= 1;
        this.emit(from / dur);
      }
      for (const b of em.m_Bursts ?? []) {
        const cycles = b.cycleCount || 1;
        for (let k = 0; k < cycles; k++) {
          const at = b.time + k * (b.repeatInterval || 0);
          const hit = ps.looping ? (from % dur) <= at % dur && at % dur < (from % dur) + (until - from)
                                 : from <= at && at < until || (at === 0 && from === 0);
          if (!hit || this.random() > (b.probability ?? 1)) continue;
          const n = Math.round(minMax(b.countCurve, at / dur, this.random()));
          for (let i = 0; i < n; i++) this.emit(at / dur);
        }
      }
    }
  }

  private emit(e: number) {
    const ps = this.ps, ini = ps.InitialModule;
    if (this.particles.length >= (ini.maxNumParticles ?? 1000)) return;
    const R = this.random;
    const life = Math.max(0.0001, minMax(ini.startLifetime, e, R()));
    const speed = minMax(ini.startSpeed, e, R());
    const s = minMax(ini.startSize, e, R());
    const size0: Vec3 = ini.size3D ? [s, minMax(ini.startSizeY, e, R()), minMax(ini.startSizeZ, e, R())] : [s, s, s];
    const flip = R() < (ini.randomizeRotationDirection ?? 0) ? -1 : 1;
    const rot: Vec3 = ini.rotation3D
      ? [minMax(ini.startRotationX, e, R()) * flip, minMax(ini.startRotationY, e, R()) * flip, minMax(ini.startRotation, e, R()) * flip]
      : [0, 0, minMax(ini.startRotation, e, R()) * flip];
    const color0 = minMaxColor(ini.startColor, e, R());
    const [pos, dir] = this.shape();
    const p: Particle = {
      pos, vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed], age: 0, life, size0, rot, color0,
      r: [R(), R(), R(), R(), R(), R(), R(), R()], sr: [R(), R(), R(), R()],
    };
    const tm = ps.TrailModule;
    if (tm && R() < (tm.ratio ?? 1)) {
      p.trail = [{ pos: [...pos], t: this.t }];
      p.trailLife = minMax(tm.lifetime, e, R()) * life;
    }
    this.particles.push(p);
  }

  /** Where a new particle starts and which way it goes, in the system's space. */
  private shape(): [Vec3, Vec3] {
    const sh = this.ps.ShapeModule, R = this.random;
    if (!sh) return [[0, 0, 0], [0, 0, 1]];
    const radius = sh.radius?.value ?? 1, thick = sh.radiusThickness ?? 1;
    const arc = (sh.arc?.value ?? 360) * RAD;
    const th = R() * arc;
    const rho = Math.sqrt((1 - thick) ** 2 + (1 - (1 - thick) ** 2) * R());   // even over the ring's area
    let pos: Vec3, dir: Vec3;
    switch (sh.type) {
      case 4: case 7: case 8: case 9: {   // cone: from the base, leaning out as far as the point lies from the axis
        const lean = (radius > 0 ? rho : Math.sqrt(R())) * (sh.angle ?? 25) * RAD;
        pos = [rho * radius * Math.cos(th), rho * radius * Math.sin(th), 0];
        dir = [Math.sin(lean) * Math.cos(th), Math.sin(lean) * Math.sin(th), Math.cos(lean)];
        if (sh.type === 8 || sh.type === 9) {
          const along = R() * (sh.length ?? 5);
          pos = [pos[0] + dir[0] * along, pos[1] + dir[1] * along, dir[2] * along];
        }
        break;
      }
      case 10: case 11:   // circle: outwards in its plane
        dir = [Math.cos(th), Math.sin(th), 0];
        pos = [dir[0] * radius * (sh.type === 11 ? 1 : rho), dir[1] * radius * (sh.type === 11 ? 1 : rho), 0];
        break;
      default: {          // sphere (and anything else): any direction
        const z = 2 * R() - 1, a = R() * 2 * Math.PI, w = Math.sqrt(1 - z * z);
        dir = [w * Math.cos(a), w * Math.sin(a), z];
        const r = radius * Math.cbrt(1 - (1 - (1 - thick) ** 3) * R());
        pos = [dir[0] * r, dir[1] * r, dir[2] * r];
        if (sh.type === 2 || sh.type === 3) {   // hemisphere
          dir[2] = Math.abs(dir[2]);
          pos[2] = Math.abs(pos[2]);
        }
      }
    }
    const randomDir = sh.randomDirectionAmount ?? 0;
    if (randomDir > 0) {
      const z = 2 * R() - 1, a = R() * 2 * Math.PI, w = Math.sqrt(1 - z * z);
      dir = norm([dir[0] + (w * Math.cos(a) - dir[0]) * randomDir, dir[1] + (w * Math.sin(a) - dir[1]) * randomDir, dir[2] + (z - dir[2]) * randomDir]);
    }
    const sc = sh.m_Scale ?? { x: 1, y: 1, z: 1 }, p = sh.m_Position ?? { x: 0, y: 0, z: 0 };
    pos = euler([pos[0] * sc.x, pos[1] * sc.y, pos[2] * sc.z], sh.m_Rotation ?? { x: 0, y: 0, z: 0 });
    pos = [pos[0] + p.x, pos[1] + p.y, pos[2] + p.z];
    dir = norm(euler([dir[0] * sc.x, dir[1] * sc.y, dir[2] * sc.z], sh.m_Rotation ?? { x: 0, y: 0, z: 0 }));
    return [pos, dir];
  }

  /** Age and move the particles; the dead ones go. */
  private age(dt: number) {
    const ps = this.ps, ini = ps.InitialModule;
    const gravity = minMax(ini.gravityModifier, 0, 0.5) * 9.81;
    const clamp = ps.ClampVelocityModule, vel = ps.VelocityModule;
    const tm = ps.TrailModule;
    const live: Particle[] = [];
    // a trail's points last trailLife seconds
    const expire = (p: Particle) => {
      const trail = p.trail!;
      while (trail.length && trail[0].t < this.t - p.trailLife!) trail.shift();
    };
    this.ghosts = this.ghosts.filter((g) => (expire(g), g.trail!.length > 1));
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) {
        if (p.trail && tm && !tm.dieWithParticles) this.ghosts.push(p);
        continue;
      }
      const u = p.age / p.life;
      p.vel[1] -= gravity * dt;
      if (clamp) {
        const limit = clamp.separateAxis ? Infinity : minMax(clamp.magnitude, u, p.r[2]);
        const speed = Math.hypot(...p.vel);
        if (speed > limit && speed > 0) {
          // the share above the limit fades by dampen each 30th of a second
          const target = limit + (speed - limit) * Math.pow(1 - (clamp.dampen ?? 1), dt * 30);
          const k = target / speed;
          p.vel = [p.vel[0] * k, p.vel[1] * k, p.vel[2] * k];
        }
        const drag = minMax(clamp.drag, u, p.r[2]);
        if (drag > 0) {
          const k = Math.max(0, 1 - drag * dt);
          p.vel = [p.vel[0] * k, p.vel[1] * k, p.vel[2] * k];
        }
      }
      // the velocity module: a velocity added on top (in world space turned into the system's), the particle's own
      // velocity scaled by the speed modifier, then a turn round the orbit's centre and a push away from it
      let add: Vec3 = [0, 0, 0];
      if (vel) {
        add = [minMax(vel.x, u, p.r[3]), minMax(vel.y, u, p.r[3]), minMax(vel.z, u, p.r[3])];
        if (vel.inWorldSpace) add = this.fromWorld(add);
      }
      const k = vel?.speedModifier ? minMax(vel.speedModifier, u, p.r[3]) : 1;
      p.pos = [p.pos[0] + (p.vel[0] * k + add[0]) * dt, p.pos[1] + (p.vel[1] * k + add[1]) * dt, p.pos[2] + (p.vel[2] * k + add[2]) * dt];
      if (vel) {
        const o = { x: minMax(vel.orbitalX, u, p.r[3]) * dt, y: minMax(vel.orbitalY, u, p.r[3]) * dt, z: minMax(vel.orbitalZ, u, p.r[3]) * dt };
        const radial = minMax(vel.radial, u, p.r[3]);
        if (o.x || o.y || o.z || radial) {
          const c: Vec3 = [minMax(vel.orbitalOffsetX, u, p.r[3]), minMax(vel.orbitalOffsetY, u, p.r[3]), minMax(vel.orbitalOffsetZ, u, p.r[3])];
          let rel: Vec3 = [p.pos[0] - c[0], p.pos[1] - c[1], p.pos[2] - c[2]];
          rel = euler(rel, { x: o.x / RAD, y: o.y / RAD, z: o.z / RAD });
          const d = norm(rel);
          p.pos = [c[0] + rel[0] + d[0] * radial * dt, c[1] + rel[1] + d[1] * radial * dt, c[2] + rel[2] + d[2] * radial * dt];
        }
      }
      if (p.trail) {
        const last = p.trail[p.trail.length - 1].pos;
        if (Math.hypot(p.pos[0] - last[0], p.pos[1] - last[1], p.pos[2] - last[2]) >= (tm.minVertexDistance ?? 0.1)) {
          p.trail.push({ pos: [...p.pos], t: this.t });
        }
        expire(p);
      }
      const rm = ps.RotationModule;
      if (rm) {
        p.rot[2] += minMax(rm.curve, u, p.r[4]) * dt;
        if (rm.separateAxes) {
          p.rot[0] += minMax(rm.x, u, p.r[4]) * dt;
          p.rot[1] += minMax(rm.y, u, p.r[4]) * dt;
        }
      }
      live.push(p);
    }
    this.particles = live;
  }

  /** A direction in the world as the system's own (the inverse of its matrix's 3×3). */
  private fromWorld(v: Vec3): Vec3 {
    const m = this.world;
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g) || 1;
    return [
      ((e * i - f * h) * v[0] - (b * i - c * h) * v[1] + (b * f - c * e) * v[2]) / det,
      (-(d * i - f * g) * v[0] + (a * i - c * g) * v[1] - (a * f - c * d) * v[2]) / det,
      ((d * h - e * g) * v[0] - (a * h - b * g) * v[1] + (a * e - b * d) * v[2]) / det,
    ];
  }

  /** What a particle looks like now: its size, colour, texture frame and custom data. */
  look(p: Particle) {
    const ps = this.ps, u = p.age / p.life;
    let size: Vec3 = [...p.size0];
    const sm = ps.SizeModule;
    if (sm) {
      const k = minMax(sm.curve, u, p.r[0]);
      size = sm.separateAxes ? [size[0] * k, size[1] * minMax(sm.y, u, p.r[0]), size[2] * minMax(sm.z, u, p.r[0])]
                             : [size[0] * k, size[1] * k, size[2] * k];
    }
    let color: RGBA = [...p.color0];
    const cm = ps.ColorModule;
    if (cm) {
      const c = minMaxColor(cm.gradient, u, p.r[1]);
      color = [color[0] * c[0], color[1] * c[1], color[2] * c[2], color[3] * c[3]];
    }
    let frame = 0, frames = 1, tiles: [number, number] = [1, 1];
    const uv = ps.UVModule;
    if (uv) {
      tiles = [uv.tilesX || 1, uv.tilesY || 1];
      frames = uv.animationType === 1 ? tiles[0] : tiles[0] * tiles[1];
      const f = minMax(uv.frameOverTime, u, p.r[5]) * (uv.cycles || 1) + minMax(uv.startFrame, 0, p.r[6]);
      frame = Math.min(frames - 1, Math.floor((f % 1) * frames));
      if (uv.animationType === 1) frame += (uv.rowIndex ?? 0) * tiles[0];
    }
    const custom: number[][] = [[], []];
    const cd = ps.CustomDataModule;
    if (cd) {
      for (const k of [0, 1]) {
        if (cd[`mode${k}`] === 1) {
          for (let i = 0; i < (cd[`vectorComponentCount${k}`] ?? 4); i++) custom[k].push(minMax(cd[`vector${k}_${i}`], u, p.r[7]));
        } else if (cd[`mode${k}`] === 2) custom[k] = minMaxColor(cd[`color${k}`], u, p.r[7]);
      }
    }
    return { size, color, frame, tiles, custom, agePercent: u };
  }
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
