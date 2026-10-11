import { Bone, DEG, RAD } from "./bone";
import type {
  Animation, Attachment, Color, IkData, Keys, PathAttachment, PathData, PhysicsData, SkeletonData, SlotData,
  TransformData, Vertices,
} from "./data";

export class Slot {
  color: Color = [1, 1, 1, 1];
  dark: Color | null = null;
  attachment: Attachment | null = null;
  /** Vertex offsets (weighted) or positions (plain) a deform key gave the attachment; empty for its setup shape. */
  deform: number[] = [];

  constructor(readonly data: SlotData, readonly bone: Bone, readonly skeleton: Skeleton) {
    this.setup();
  }

  setup() {
    this.color = [...this.data.color] as Color;
    this.dark = this.data.dark ? ([...this.data.dark] as Color) : null;
    this.attachment = null;
    this.deform = [];
    this.setAttachment(this.data.attachment);
  }

  /** A linked mesh moved by the same deform keys as the attachment it replaces keeps the deform. */
  setAttachment(name: string | null) {
    const att = name === null ? null : this.skeleton.data.skin[this.data.index].get(name) ?? null;
    const owner = (x: Attachment | null) => (x && x.kind === "mesh" ? x.deformOf : x);
    if (owner(att) !== owner(this.attachment)) this.deform = [];
    this.attachment = att;
  }
}

/** World positions of a mesh, path or clipping polygon's vertices (from vertex `start`, `count` values), with the
 *  slot's deform. */
export function worldVertices(slot: Slot, v: Vertices, start: number, count: number, out: number[], offset = 0) {
  const deform = slot.deform;
  const bones = v.bones;
  if (!bones) {
    const values = deform.length ? deform : v.values;
    const b = slot.bone;
    for (let i = start, w = offset; i < start + count; i += 2, w += 2) {
      const x = values[i], y = values[i + 1];
      out[w] = x * b.a + y * b.b + b.worldX;
      out[w + 1] = x * b.c + y * b.d + b.worldY;
    }
    return;
  }
  const skBones = slot.skeleton.bones;
  let bi = 0, skip = 0;
  for (let i = 0; i < start; i += 2) {
    const n = bones[bi];
    bi += n + 1;
    skip += n;
  }
  for (let w = offset, k = skip * 3, f = skip * 2, end = offset + count; w < end; w += 2) {
    let wx = 0, wy = 0;
    const n = bones[bi++] + bi;
    for (; bi < n; bi++, k += 3, f += 2) {
      const bone = skBones[bones[bi]];
      const x = v.values[k] + (deform.length ? deform[f] : 0), y = v.values[k + 1] + (deform.length ? deform[f + 1] : 0);
      const weight = v.values[k + 2];
      wx += (x * bone.a + y * bone.b + bone.worldX) * weight;
      wy += (x * bone.c + y * bone.d + bone.worldY) * weight;
    }
    out[w] = wx;
    out[w + 1] = wy;
  }
}

// ---------------------------------------------------------------- constraints

class Ik {
  mix: number; softness: number; bendDirection: number; compress: boolean; stretch: boolean;
  readonly bones: Bone[]; readonly target: Bone;
  constructor(readonly data: IkData, sk: Skeleton) {
    this.bones = data.bones.map((b) => sk.bones[b.index]);
    this.target = sk.bones[data.target.index];
    this.mix = data.mix; this.softness = data.softness; this.bendDirection = data.bendDirection;
    this.compress = data.compress; this.stretch = data.stretch;
  }
  setup() {
    const d = this.data;
    this.mix = d.mix; this.softness = d.softness; this.bendDirection = d.bendDirection;
    this.compress = d.compress; this.stretch = d.stretch;
  }
  update() {
    if (this.mix === 0) return;
    const t = this.target;
    if (this.bones.length === 1) ikOne(this.bones[0], t.worldX, t.worldY, this.compress, this.stretch, this.data.uniform, this.mix);
    else ikTwo(this.bones[0], this.bones[1], t.worldX, t.worldY, this.bendDirection, this.stretch, this.data.uniform, this.softness, this.mix);
  }
}

/** Point one bone at the target. */
function ikOne(bone: Bone, targetX: number, targetY: number, compress: boolean, stretch: boolean, uniform: boolean, alpha: number) {
  const p = bone.parent!;
  const pa = p.a, pc = p.c;
  let pb = p.b, pd = p.d;
  let rotationIK = -bone.ashearX - bone.arotation;
  let tx: number, ty: number;
  if (bone.inherit === "onlyTranslation") {
    tx = targetX - bone.worldX;
    ty = targetY - bone.worldY;
  } else {
    if (bone.inherit === "noRotationOrReflection") {
      const s = Math.abs(pa * pd - pb * pc) / Math.max(0.0001, pa * pa + pc * pc);
      pb = -pc * s;
      pd = pa * s;
      rotationIK += Math.atan2(pc, pa) * DEG;
    }
    const x = targetX - p.worldX, y = targetY - p.worldY;
    const det = pa * pd - pb * pc;
    if (Math.abs(det) <= 0.0001) {
      tx = 0;
      ty = 0;
    } else {
      tx = (x * pd - y * pb) / det - bone.ax;
      ty = (y * pa - x * pc) / det - bone.ay;
    }
  }
  rotationIK += Math.atan2(ty, tx) * DEG;
  if (bone.ascaleX < 0) rotationIK += 180;
  if (rotationIK > 180) rotationIK -= 360;
  else if (rotationIK < -180) rotationIK += 360;
  let sx = bone.ascaleX, sy = bone.ascaleY;
  if (compress || stretch) {
    if (bone.inherit === "noScale" || bone.inherit === "noScaleOrReflection") {
      tx = targetX - bone.worldX;
      ty = targetY - bone.worldY;
    }
    const b = bone.data.length * sx;
    if (b > 0.0001) {
      const dd = tx * tx + ty * ty;
      if ((compress && dd < b * b) || (stretch && dd > b * b)) {
        const s = (Math.sqrt(dd) / b - 1) * alpha + 1;
        sx *= s;
        if (uniform) sy *= s;
      }
    }
  }
  bone.updateWith(bone.ax, bone.ay, bone.arotation + rotationIK * alpha, sx, sy, bone.ashearX, bone.ashearY);
}

/** Bend a parent and child bone so the child's end reaches the target. */
function ikTwo(parent: Bone, child: Bone, targetX: number, targetY: number, bendDir: number, stretch: boolean,
               uniform: boolean, softness: number, alpha: number) {
  if (parent.inherit !== "normal" || child.inherit !== "normal") return;
  const px = parent.ax, py = parent.ay;
  let psx = parent.ascaleX, psy = parent.ascaleY, sx = psx, sy = psy, csx = child.ascaleX;
  let os1: number, os2: number, s2: number;
  if (psx < 0) { psx = -psx; os1 = 180; s2 = -1; } else { os1 = 0; s2 = 1; }
  if (psy < 0) { psy = -psy; s2 = -s2; }
  if (csx < 0) { csx = -csx; os2 = 180; } else os2 = 0;
  const cx = child.ax;
  let cy: number, cwx: number, cwy: number;
  let a = parent.a, b = parent.b, c = parent.c, d = parent.d;
  const u = Math.abs(psx - psy) <= 0.0001;
  if (!u || stretch) {
    cy = 0;
    cwx = a * cx + parent.worldX;
    cwy = c * cx + parent.worldY;
  } else {
    cy = child.ay;
    cwx = a * cx + b * cy + parent.worldX;
    cwy = c * cx + d * cy + parent.worldY;
  }
  const pp = parent.parent!;
  a = pp.a; b = pp.b; c = pp.c; d = pp.d;
  let id = a * d - b * c;
  let x = cwx - pp.worldX, y = cwy - pp.worldY;
  id = Math.abs(id) <= 0.0001 ? 0 : 1 / id;
  const dx = (x * d - y * b) * id - px, dy = (y * a - x * c) * id - py;
  const l1 = Math.sqrt(dx * dx + dy * dy);
  let l2 = child.data.length * csx, a1 = 0, a2 = 0;
  if (l1 < 0.0001) {
    ikOne(parent, targetX, targetY, false, stretch, false, alpha);
    child.updateWith(cx, cy, 0, child.ascaleX, child.ascaleY, child.ashearX, child.ashearY);
    return;
  }
  x = targetX - pp.worldX;
  y = targetY - pp.worldY;
  let tx = (x * d - y * b) * id - px, ty = (y * a - x * c) * id - py;
  let dd = tx * tx + ty * ty;
  if (softness !== 0) {
    softness *= psx * (csx + 1) * 0.5;
    const td = Math.sqrt(dd), sd = td - l1 - l2 * psx + softness;
    if (sd > 0) {
      let p = Math.min(1, sd / (softness * 2)) - 1;
      p = (sd - softness * (1 - p * p)) / td;
      tx -= p * tx;
      ty -= p * ty;
      dd = tx * tx + ty * ty;
    }
  }
  solve: if (u) {
    l2 *= psx;
    let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    if (cos < -1) {
      cos = -1;
      a2 = Math.PI * bendDir;
    } else if (cos > 1) {
      cos = 1;
      a2 = 0;
      if (stretch) {
        const s = (Math.sqrt(dd) / (l1 + l2) - 1) * alpha + 1;
        sx *= s;
        if (uniform) sy *= s;
      }
    } else a2 = Math.acos(cos) * bendDir;
    const aa = l1 + l2 * cos, bb = l2 * Math.sin(a2);
    a1 = Math.atan2(ty * aa - tx * bb, tx * aa + ty * bb);
  } else {
    const ea = psx * l2, eb = psy * l2;
    const aa = ea * ea, bb = eb * eb, ta = Math.atan2(ty, tx);
    let cc = bb * l1 * l1 + aa * dd - aa * bb;
    const c1 = -2 * bb * l1, c2 = bb - aa;
    const disc = c1 * c1 - 4 * c2 * cc;
    if (disc >= 0) {
      let q = Math.sqrt(disc);
      if (c1 < 0) q = -q;
      q = -(c1 + q) * 0.5;
      const r0 = q / c2, r1 = cc / q;
      const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
      const yy = dd - r * r;
      if (yy >= 0) {
        const yv = Math.sqrt(yy) * bendDir;
        a1 = ta - Math.atan2(yv, r);
        a2 = Math.atan2(yv / psy, (r - l1) / psx);
        break solve;
      }
    }
    let minAngle = Math.PI, minX = l1 - ea, minDist = minX * minX, minY = 0;
    let maxAngle = 0, maxX = l1 + ea, maxDist = maxX * maxX, maxY = 0;
    cc = (-ea * l1) / (aa - bb);
    if (cc >= -1 && cc <= 1) {
      cc = Math.acos(cc);
      const xx = ea * Math.cos(cc) + l1, yy = eb * Math.sin(cc), dist = xx * xx + yy * yy;
      if (dist < minDist) { minAngle = cc; minDist = dist; minX = xx; minY = yy; }
      if (dist > maxDist) { maxAngle = cc; maxDist = dist; maxX = xx; maxY = yy; }
    }
    if (dd <= (minDist + maxDist) * 0.5) {
      a1 = ta - Math.atan2(minY * bendDir, minX);
      a2 = minAngle * bendDir;
    } else {
      a1 = ta - Math.atan2(maxY * bendDir, maxX);
      a2 = maxAngle * bendDir;
    }
  }
  const os = Math.atan2(cy, cx) * s2;
  let rotation = parent.arotation;
  a1 = (a1 - os) * DEG + os1 - rotation;
  if (a1 > 180) a1 -= 360;
  else if (a1 < -180) a1 += 360;
  parent.updateWith(px, py, rotation + a1 * alpha, sx, sy, 0, 0);
  rotation = child.arotation;
  a2 = ((a2 + os) * DEG - child.ashearX) * s2 + os2 - rotation;
  if (a2 > 180) a2 -= 360;
  else if (a2 < -180) a2 += 360;
  child.updateWith(cx, cy, rotation + a2 * alpha, child.ascaleX, child.ascaleY, child.ashearX, child.ashearY);
}

const wrapPi = (r: number) => (r > Math.PI ? r - 2 * Math.PI : r < -Math.PI ? r + 2 * Math.PI : r);
const wrap180 = (r: number) => r - Math.ceil(r / 360 - 0.5) * 360;

function rotateWorld(bone: Bone, r: number) {
  const cos = Math.cos(r), sin = Math.sin(r);
  const a = bone.a, b = bone.b, c = bone.c, d = bone.d;
  bone.a = cos * a - sin * c; bone.b = cos * b - sin * d;
  bone.c = sin * a + cos * c; bone.d = sin * b + cos * d;
}

class Transform {
  mixRotate: number; mixX: number; mixY: number; mixScaleX: number; mixScaleY: number; mixShearY: number;
  readonly bones: Bone[]; readonly target: Bone;
  constructor(readonly data: TransformData, sk: Skeleton) {
    this.bones = data.bones.map((b) => sk.bones[b.index]);
    this.target = sk.bones[data.target.index];
    this.mixRotate = data.mixRotate; this.mixX = data.mixX; this.mixY = data.mixY;
    this.mixScaleX = data.mixScaleX; this.mixScaleY = data.mixScaleY; this.mixShearY = data.mixShearY;
  }
  setup() {
    const d = this.data;
    this.mixRotate = d.mixRotate; this.mixX = d.mixX; this.mixY = d.mixY;
    this.mixScaleX = d.mixScaleX; this.mixScaleY = d.mixScaleY; this.mixShearY = d.mixShearY;
  }
  update() {
    if (!this.mixRotate && !this.mixX && !this.mixY && !this.mixScaleX && !this.mixScaleY && !this.mixShearY) return;
    if (this.data.local) {
      if (this.data.relative) this.relativeLocal();
      else this.absoluteLocal();
    } else if (this.data.relative) this.relativeWorld();
    else this.absoluteWorld();
  }
  private absoluteWorld() {
    const d = this.data, t = this.target;
    const ta = t.a, tb = t.b, tc = t.c, td = t.d;
    const reflect = ta * td - tb * tc > 0 ? RAD : -RAD;
    const offRot = d.offsetRotation * reflect, offShear = d.offsetShearY * reflect;
    const translate = this.mixX !== 0 || this.mixY !== 0;
    for (const bone of this.bones) {
      if (this.mixRotate !== 0) {
        const r = wrapPi(Math.atan2(tc, ta) - Math.atan2(bone.c, bone.a) + offRot) * this.mixRotate;
        rotateWorld(bone, r);
      }
      if (translate) {
        const [x, y] = t.toWorld(d.offsetX, d.offsetY);
        bone.worldX += (x - bone.worldX) * this.mixX;
        bone.worldY += (y - bone.worldY) * this.mixY;
      }
      if (this.mixScaleX !== 0) {
        let s = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
        if (s !== 0) s = (s + (Math.sqrt(ta * ta + tc * tc) - s + d.offsetScaleX) * this.mixScaleX) / s;
        bone.a *= s;
        bone.c *= s;
      }
      if (this.mixScaleY !== 0) {
        let s = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
        if (s !== 0) s = (s + (Math.sqrt(tb * tb + td * td) - s + d.offsetScaleY) * this.mixScaleY) / s;
        bone.b *= s;
        bone.d *= s;
      }
      if (this.mixShearY > 0) {
        const b = bone.b, dd = bone.d;
        const by = Math.atan2(dd, b);
        const r = wrapPi(Math.atan2(td, tb) - Math.atan2(tc, ta) - (by - Math.atan2(bone.c, bone.a)));
        const nr = by + (r + offShear) * this.mixShearY;
        const s = Math.sqrt(b * b + dd * dd);
        bone.b = Math.cos(nr) * s;
        bone.d = Math.sin(nr) * s;
      }
      bone.updateApplied();
    }
  }
  private relativeWorld() {
    const d = this.data, t = this.target;
    const ta = t.a, tb = t.b, tc = t.c, td = t.d;
    const reflect = ta * td - tb * tc > 0 ? RAD : -RAD;
    const offRot = d.offsetRotation * reflect, offShear = d.offsetShearY * reflect;
    const translate = this.mixX !== 0 || this.mixY !== 0;
    for (const bone of this.bones) {
      if (this.mixRotate !== 0) rotateWorld(bone, wrapPi(Math.atan2(tc, ta) + offRot) * this.mixRotate);
      if (translate) {
        const [x, y] = t.toWorld(d.offsetX, d.offsetY);
        bone.worldX += x * this.mixX;
        bone.worldY += y * this.mixY;
      }
      if (this.mixScaleX !== 0) {
        const s = (Math.sqrt(ta * ta + tc * tc) - 1 + d.offsetScaleX) * this.mixScaleX + 1;
        bone.a *= s;
        bone.c *= s;
      }
      if (this.mixScaleY !== 0) {
        const s = (Math.sqrt(tb * tb + td * td) - 1 + d.offsetScaleY) * this.mixScaleY + 1;
        bone.b *= s;
        bone.d *= s;
      }
      if (this.mixShearY > 0) {
        const r = wrapPi(Math.atan2(td, tb) - Math.atan2(tc, ta));
        const b = bone.b, dd = bone.d;
        const nr = Math.atan2(dd, b) + (r - Math.PI / 2 + offShear) * this.mixShearY;
        const s = Math.sqrt(b * b + dd * dd);
        bone.b = Math.cos(nr) * s;
        bone.d = Math.sin(nr) * s;
      }
      bone.updateApplied();
    }
  }
  private absoluteLocal() {
    const d = this.data, t = this.target;
    for (const bone of this.bones) {
      let rotation = bone.arotation;
      if (this.mixRotate !== 0) rotation += wrap180(t.arotation - rotation + d.offsetRotation) * this.mixRotate;
      let x = bone.ax, y = bone.ay;
      x += (t.ax - x + d.offsetX) * this.mixX;
      y += (t.ay - y + d.offsetY) * this.mixY;
      let scaleX = bone.ascaleX, scaleY = bone.ascaleY;
      if (this.mixScaleX !== 0 && scaleX !== 0) scaleX += (t.ascaleX - scaleX + d.offsetScaleX) * this.mixScaleX;
      if (this.mixScaleY !== 0 && scaleY !== 0) scaleY += (t.ascaleY - scaleY + d.offsetScaleY) * this.mixScaleY;
      let shearY = bone.ashearY;
      if (this.mixShearY !== 0) shearY += wrap180(t.ashearY - shearY + d.offsetShearY) * this.mixShearY;
      bone.updateWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
    }
  }
  private relativeLocal() {
    const d = this.data, t = this.target;
    for (const bone of this.bones) {
      bone.updateWith(
        bone.ax + (t.ax + d.offsetX) * this.mixX, bone.ay + (t.ay + d.offsetY) * this.mixY,
        bone.arotation + (t.arotation + d.offsetRotation) * this.mixRotate,
        bone.ascaleX * ((t.ascaleX - 1 + d.offsetScaleX) * this.mixScaleX + 1),
        bone.ascaleY * ((t.ascaleY - 1 + d.offsetScaleY) * this.mixScaleY + 1),
        bone.ashearX, bone.ashearY + (t.ashearY + d.offsetShearY) * this.mixShearY,
      );
    }
  }
}

class Path {
  position: number; spacing: number; mixRotate: number; mixX: number; mixY: number;
  readonly bones: Bone[]; readonly target: Slot;
  private world: number[] = [];
  private curves: number[] = [];
  private segments: number[] = new Array(10).fill(0);
  constructor(readonly data: PathData, sk: Skeleton) {
    this.bones = data.bones.map((b) => sk.bones[b.index]);
    this.target = sk.slots[data.target.index];
    this.position = data.position; this.spacing = data.spacing;
    this.mixRotate = data.mixRotate; this.mixX = data.mixX; this.mixY = data.mixY;
  }
  setup() {
    const d = this.data;
    this.position = d.position; this.spacing = d.spacing;
    this.mixRotate = d.mixRotate; this.mixX = d.mixX; this.mixY = d.mixY;
  }
  update() {
    const att = this.target.attachment;
    if (!att || att.kind !== "path") return;
    const mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY;
    if (mixRotate === 0 && mixX === 0 && mixY === 0) return;
    const d = this.data;
    const tangents = d.rotateMode === "tangent", scale = d.rotateMode === "chainScale";
    const bones = this.bones, boneCount = bones.length, spacesCount = tangents ? boneCount : boneCount + 1;
    const spaces = new Array<number>(spacesCount).fill(0), lengths: number[] = scale ? new Array(boneCount).fill(0) : [];
    const spacing = this.spacing;
    if (d.spacingMode === "percent") {
      if (scale) {
        for (let i = 0; i < spacesCount - 1; i++) {
          const bone = bones[i], l = bone.data.length;
          lengths[i] = Math.hypot(l * bone.a, l * bone.c);
        }
      }
      for (let i = 1; i < spacesCount; i++) spaces[i] = spacing;
    } else if (d.spacingMode === "proportional") {
      let sum = 0;
      for (let i = 0, n = spacesCount - 1; i < n; ) {
        const bone = bones[i], l = bone.data.length;
        if (l < 0.00001) {
          if (scale) lengths[i] = 0;
          spaces[++i] = spacing;
        } else {
          const length = Math.hypot(l * bone.a, l * bone.c);
          if (scale) lengths[i] = length;
          spaces[++i] = length;
          sum += length;
        }
      }
      if (sum > 0) {
        sum = (spacesCount / sum) * spacing;
        for (let i = 1; i < spacesCount; i++) spaces[i] *= sum;
      }
    } else {
      const lengthSpacing = d.spacingMode === "length";
      for (let i = 0, n = spacesCount - 1; i < n; ) {
        const bone = bones[i], l = bone.data.length;
        if (l < 0.00001) {
          if (scale) lengths[i] = 0;
          spaces[++i] = spacing;
        } else {
          const length = Math.hypot(l * bone.a, l * bone.c);
          if (scale) lengths[i] = length;
          spaces[++i] = ((lengthSpacing ? l + spacing : spacing) * length) / l;
        }
      }
    }
    const positions = this.positions(att, spacesCount, tangents, spaces);
    let boneX = positions[0], boneY = positions[1], offsetRotation = d.offsetRotation, tip: boolean;
    if (offsetRotation === 0) tip = d.rotateMode === "chain";
    else {
      tip = false;
      const p = this.target.bone;
      offsetRotation *= p.a * p.d - p.b * p.c > 0 ? RAD : -RAD;
    }
    for (let i = 0, p = 3; i < boneCount; i++, p += 3) {
      const bone = bones[i];
      bone.worldX += (boneX - bone.worldX) * mixX;
      bone.worldY += (boneY - bone.worldY) * mixY;
      const x = positions[p], y = positions[p + 1], dx = x - boneX, dy = y - boneY;
      if (scale) {
        const length = lengths[i];
        if (length !== 0) {
          const s = (Math.sqrt(dx * dx + dy * dy) / length - 1) * mixRotate + 1;
          bone.a *= s;
          bone.c *= s;
        }
      }
      boneX = x;
      boneY = y;
      if (mixRotate > 0) {
        const a = bone.a, c = bone.c;
        let r: number;
        if (tangents) r = positions[p - 1];
        else if (spaces[i + 1] === 0) r = positions[p + 2];
        else r = Math.atan2(dy, dx);
        r -= Math.atan2(c, a);
        if (tip) {
          const cos = Math.cos(r), sin = Math.sin(r), length = bone.data.length;
          boneX += (length * (cos * a - sin * c) - dx) * mixRotate;
          boneY += (length * (sin * a + cos * c) - dy) * mixRotate;
        } else r += offsetRotation;
        rotateWorld(bone, wrapPi(r) * mixRotate);
      }
      bone.updateApplied();
    }
  }

  /** x, y and the tangent's angle along the path for each space. */
  private positions(path: PathAttachment, spacesCount: number, tangents: boolean, spaces: number[]): number[] {
    const target = this.target;
    let position = this.position;
    const out = new Array<number>(spacesCount * 3 + 2).fill(0);
    const closed = path.closed;
    let verticesLength = path.vertices.worldLength, curveCount = verticesLength / 6, prevCurve = -1;
    const d = this.data;
    if (!path.constantSpeed) {
      const lengths = path.lengths;
      curveCount -= closed ? 1 : 2;
      const pathLength = lengths[curveCount];
      if (d.positionMode === "percent") position *= pathLength;
      const multiplier = d.spacingMode === "percent" ? pathLength : d.spacingMode === "proportional" ? pathLength / spacesCount : 1;
      const world = this.world;
      for (let i = 0, o = 0, curve = 0; i < spacesCount; i++, o += 3) {
        const space = spaces[i] * multiplier;
        position += space;
        let p = position;
        if (closed) {
          p %= pathLength;
          if (p < 0) p += pathLength;
          curve = 0;
        } else if (p < 0) {
          if (prevCurve !== -2) {
            prevCurve = -2;
            worldVertices(target, path.vertices, 2, 4, world, 0);
          }
          before(p, world, 0, out, o);
          continue;
        } else if (p > pathLength) {
          if (prevCurve !== -3) {
            prevCurve = -3;
            worldVertices(target, path.vertices, verticesLength - 6, 4, world, 0);
          }
          after(p - pathLength, world, 0, out, o);
          continue;
        }
        for (;; curve++) {
          const length = lengths[curve];
          if (p > length) continue;
          if (curve === 0) p /= length;
          else {
            const prev = lengths[curve - 1];
            p = (p - prev) / (length - prev);
          }
          break;
        }
        if (curve !== prevCurve) {
          prevCurve = curve;
          if (closed && curve === curveCount) {
            worldVertices(target, path.vertices, verticesLength - 4, 4, world, 0);
            worldVertices(target, path.vertices, 0, 4, world, 4);
          } else worldVertices(target, path.vertices, curve * 6 + 2, 8, world, 0);
        }
        onCurve(p, world[0], world[1], world[2], world[3], world[4], world[5], world[6], world[7], out, o,
                tangents || (i > 0 && space === 0));
      }
      return out;
    }

    // constant speed: measure the curves, then walk them by length
    let world: number[];
    if (closed) {
      verticesLength += 2;
      world = this.world;
      worldVertices(target, path.vertices, 2, verticesLength - 4, world, 0);
      worldVertices(target, path.vertices, 0, 2, world, verticesLength - 4);
      world[verticesLength - 2] = world[0];
      world[verticesLength - 1] = world[1];
    } else {
      curveCount--;
      verticesLength -= 4;
      world = this.world;
      worldVertices(target, path.vertices, 2, verticesLength, world, 0);
    }
    const curves = this.curves;
    curves.length = curveCount;
    let pathLength = 0;
    let x1 = world[0], y1 = world[1], cx1 = 0, cy1 = 0, cx2 = 0, cy2 = 0, x2 = 0, y2 = 0;
    for (let i = 0, w = 2; i < curveCount; i++, w += 6) {
      cx1 = world[w]; cy1 = world[w + 1]; cx2 = world[w + 2]; cy2 = world[w + 3]; x2 = world[w + 4]; y2 = world[w + 5];
      pathLength += curveLength(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 4, null);
      curves[i] = pathLength;
      x1 = x2;
      y1 = y2;
    }
    if (d.positionMode === "percent") position *= pathLength;
    const multiplier = d.spacingMode === "percent" ? pathLength : d.spacingMode === "proportional" ? pathLength / spacesCount : 1;
    const segments = this.segments;
    let curveLen = 0;
    for (let i = 0, o = 0, curve = 0, segment = 0; i < spacesCount; i++, o += 3) {
      const space = spaces[i] * multiplier;
      position += space;
      let p = position;
      if (closed) {
        p %= pathLength;
        if (p < 0) p += pathLength;
        curve = 0;
      } else if (p < 0) {
        before(p, world, 0, out, o);
        continue;
      } else if (p > pathLength) {
        after(p - pathLength, world, verticesLength - 4, out, o);
        continue;
      }
      for (;; curve++) {
        const length = curves[curve];
        if (p > length) continue;
        if (curve === 0) p /= length;
        else {
          const prev = curves[curve - 1];
          p = (p - prev) / (length - prev);
        }
        break;
      }
      if (curve !== prevCurve) {
        prevCurve = curve;
        const ii = curve * 6;
        x1 = world[ii]; y1 = world[ii + 1]; cx1 = world[ii + 2]; cy1 = world[ii + 3];
        cx2 = world[ii + 4]; cy2 = world[ii + 5]; x2 = world[ii + 6]; y2 = world[ii + 7];
        curveLen = curveLength(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 10, segments);
        segment = 0;
      }
      p *= curveLen;
      for (;; segment++) {
        const length = segments[segment];
        if (p > length) continue;
        if (segment === 0) p /= length;
        else {
          const prev = segments[segment - 1];
          p = segment + (p - prev) / (length - prev);
        }
        break;
      }
      onCurve(p * 0.1, x1, y1, cx1, cy1, cx2, cy2, x2, y2, out, o, tangents || (i > 0 && space === 0));
    }
    return out;
  }
}

/** Length of a cubic Bézier walked in n equal steps of its parameter (running totals into segments when given). */
function curveLength(x1: number, y1: number, cx1: number, cy1: number, cx2: number, cy2: number, x2: number, y2: number,
                     n: number, segments: number[] | null): number {
  let total = 0, px = x1, py = y1;
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
    const y = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2;
    total += Math.hypot(x - px, y - py);
    if (segments) segments[k - 1] = total;
    px = x;
    py = y;
  }
  return total;
}

function before(p: number, w: number[], i: number, out: number[], o: number) {
  const x1 = w[i], y1 = w[i + 1], r = Math.atan2(w[i + 3] - y1, w[i + 2] - x1);
  out[o] = x1 + p * Math.cos(r);
  out[o + 1] = y1 + p * Math.sin(r);
  out[o + 2] = r;
}

function after(p: number, w: number[], i: number, out: number[], o: number) {
  const x1 = w[i + 2], y1 = w[i + 3], r = Math.atan2(y1 - w[i + 1], x1 - w[i]);
  out[o] = x1 + p * Math.cos(r);
  out[o + 1] = y1 + p * Math.sin(r);
  out[o + 2] = r;
}

function onCurve(p: number, x1: number, y1: number, cx1: number, cy1: number, cx2: number, cy2: number, x2: number,
                 y2: number, out: number[], o: number, tangents: boolean) {
  if (p === 0 || Number.isNaN(p)) {
    out[o] = x1;
    out[o + 1] = y1;
    out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
    return;
  }
  const tt = p * p, ttt = tt * p, u = 1 - p, uu = u * u, uuu = uu * u;
  const ut = u * p, ut3 = ut * 3, uut3 = u * ut3, utt3 = ut3 * p;
  const x = x1 * uuu + cx1 * uut3 + cx2 * utt3 + x2 * ttt, y = y1 * uuu + cy1 * uut3 + cy2 * utt3 + y2 * ttt;
  out[o] = x;
  out[o + 1] = y;
  if (tangents) {
    if (p < 0.001) out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
    else out[o + 2] = Math.atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt), x - (x1 * uu + cx1 * ut * 2 + cx2 * tt));
  }
}

class Physics {
  inertia: number; strength: number; damping: number; massInverse: number; wind: number; gravity: number; mix: number;
  readonly bone: Bone;
  private reset = true;
  private ux = 0; private uy = 0; private cx = 0; private cy = 0; private tx = 0; private ty = 0;
  private xOffset = 0; private xVelocity = 0; private yOffset = 0; private yVelocity = 0;
  private rotateOffset = 0; private rotateVelocity = 0; private scaleOffset = 0; private scaleVelocity = 0;
  private lastTime = 0; private remaining = 0;

  constructor(readonly data: PhysicsData, private readonly sk: Skeleton) {
    this.bone = sk.bones[data.bone.index];
    this.inertia = data.inertia; this.strength = data.strength; this.damping = data.damping;
    this.massInverse = data.massInverse; this.wind = data.wind; this.gravity = data.gravity; this.mix = data.mix;
  }
  setup() {
    const d = this.data;
    this.inertia = d.inertia; this.strength = d.strength; this.damping = d.damping;
    this.massInverse = d.massInverse; this.wind = d.wind; this.gravity = d.gravity; this.mix = d.mix;
  }
  restart() {
    this.reset = true;
    this.remaining = 0;
    this.lastTime = this.sk.time;
    this.xOffset = this.xVelocity = this.yOffset = this.yVelocity = 0;
    this.rotateOffset = this.rotateVelocity = this.scaleOffset = this.scaleVelocity = 0;
  }
  update() {
    const mix = this.mix;
    if (mix === 0) return;
    const d = this.data, bone = this.bone, l = bone.data.length;
    const x = d.x > 0, y = d.y > 0, rotateOrShearX = d.rotate > 0 || d.shearX > 0, scaleX = d.scaleX > 0;
    const delta = Math.max(this.sk.time - this.lastTime, 0);
    this.remaining += delta;
    this.lastTime = this.sk.time;
    const bx = bone.worldX, by = bone.worldY;
    if (this.reset) {
      this.reset = false;
      this.ux = bx;
      this.uy = by;
    } else {
      let a = this.remaining;
      const i = this.inertia, t = d.step, f = this.sk.data.referenceScale;
      let dmp = -1, m = 0, e = 0, w = 0, g = 0;
      const qx = d.limit * delta, qy = qx;
      const forces = () => {
        dmp = Math.pow(this.damping, 60 * t);
        m = this.massInverse * t;
        e = this.strength;
        w = this.wind * f;
        g = this.gravity * f;
      };
      if (x || y) {
        if (x) {
          const u = (this.ux - bx) * i;
          this.xOffset += u > qx ? qx : u < -qx ? -qx : u;
          this.ux = bx;
        }
        if (y) {
          const u = (this.uy - by) * i;
          this.yOffset += u > qy ? qy : u < -qy ? -qy : u;
          this.uy = by;
        }
        if (a >= t) {
          forces();
          do {
            if (x) {
              this.xVelocity += (w - this.xOffset * e) * m;
              this.xOffset += this.xVelocity * t;
              this.xVelocity *= dmp;
            }
            if (y) {
              this.yVelocity -= (g + this.yOffset * e) * m;
              this.yOffset += this.yVelocity * t;
              this.yVelocity *= dmp;
            }
            a -= t;
          } while (a >= t);
        }
        if (x) bone.worldX += this.xOffset * mix * d.x;
        if (y) bone.worldY += this.yOffset * mix * d.y;
      }
      if (rotateOrShearX || scaleX) {
        const ca = Math.atan2(bone.c, bone.a);
        let c = 0, s = 0, mr = 0;
        let dx = this.cx - bone.worldX, dy = this.cy - bone.worldY;
        dx = Math.max(-qx, Math.min(qx, dx));
        dy = Math.max(-qy, Math.min(qy, dy));
        if (rotateOrShearX) {
          mr = (d.rotate + d.shearX) * mix;
          let r = Math.atan2(dy + this.ty, dx + this.tx) - ca - this.rotateOffset * mr;
          this.rotateOffset += (r - Math.ceil(r / (2 * Math.PI) - 0.5) * 2 * Math.PI) * i;
          r = this.rotateOffset * mr + ca;
          c = Math.cos(r);
          s = Math.sin(r);
          if (scaleX) {
            const len = l * bone.worldScaleX();
            if (len > 0) this.scaleOffset += ((dx * c + dy * s) * i) / len;
          }
        } else {
          c = Math.cos(ca);
          s = Math.sin(ca);
          const len = l * bone.worldScaleX();
          if (len > 0) this.scaleOffset += ((dx * c + dy * s) * i) / len;
        }
        a = this.remaining;
        if (a >= t) {
          if (dmp === -1) forces();
          const h = l / f;
          for (;;) {
            a -= t;
            if (scaleX) {
              this.scaleVelocity += (w * c - g * s - this.scaleOffset * e) * m;
              this.scaleOffset += this.scaleVelocity * t;
              this.scaleVelocity *= dmp;
            }
            if (rotateOrShearX) {
              this.rotateVelocity -= ((w * s + g * c) * h + this.rotateOffset * e) * m;
              this.rotateOffset += this.rotateVelocity * t;
              this.rotateVelocity *= dmp;
              if (a < t) break;
              const r = this.rotateOffset * mr + ca;
              c = Math.cos(r);
              s = Math.sin(r);
            } else if (a < t) break;
          }
        }
      }
      this.remaining = a;
    }
    this.cx = bone.worldX;
    this.cy = bone.worldY;
    if (rotateOrShearX) {
      let o = this.rotateOffset * mix;
      if (d.shearX > 0) {
        let r = 0;
        if (d.rotate > 0) {
          r = o * d.rotate;
          const s = Math.sin(r), c = Math.cos(r), b = bone.b;
          bone.b = c * b - s * bone.d;
          bone.d = s * b + c * bone.d;
        }
        r += o * d.shearX;
        const s = Math.sin(r), c = Math.cos(r), a = bone.a;
        bone.a = c * a - s * bone.c;
        bone.c = s * a + c * bone.c;
      } else {
        o *= d.rotate;
        rotateWorld(bone, o);
      }
    }
    if (scaleX) {
      const s = 1 + this.scaleOffset * mix * d.scaleX;
      bone.a *= s;
      bone.c *= s;
    }
    this.tx = l * bone.a;
    this.ty = l * bone.c;
    bone.updateApplied();
  }
}

type Constraint = Ik | Transform | Path | Physics;

// ---------------------------------------------------------------- skeleton

export class Skeleton {
  readonly bones: Bone[];
  readonly slots: Slot[];
  drawOrder: Slot[];
  readonly constraints: Constraint[];
  private cache: (Bone | Constraint)[] = [];
  time = 0;

  constructor(readonly data: SkeletonData) {
    this.bones = [];
    for (const b of data.bones) {
      const bone = new Bone(b, b.parent ? this.bones[b.parent.index] : null);
      bone.parent?.children.push(bone);
      this.bones.push(bone);
    }
    this.slots = data.slots.map((s) => new Slot(s, this.bones[s.bone.index], this));
    this.drawOrder = this.slots.slice();
    this.constraints = data.constraints.map((c) =>
      c.kind === "ik" ? new Ik(c, this) : c.kind === "transform" ? new Transform(c, this)
        : c.kind === "path" ? new Path(c, this) : new Physics(c, this));
    this.buildCache();
  }

  /** The order bones and constraints update in: each constraint after the bones it reads, its bones after it. */
  private buildCache() {
    const cache: (Bone | Constraint)[] = [];
    const sortBone = (bone: Bone) => {
      if (bone.sorted) return;
      if (bone.parent) sortBone(bone.parent);
      bone.sorted = true;
      cache.push(bone);
    };
    const sortReset = (bones: Bone[]) => {
      for (const bone of bones) {
        if (bone.sorted) sortReset(bone.children);
        bone.sorted = false;
      }
    };
    for (const b of this.bones) b.sorted = false;
    const ordered = this.constraints.slice().sort((p, q) => p.data.order - q.data.order);
    for (const c of ordered) {
      if (c instanceof Ik) {
        sortBone(c.target);
        const parent = c.bones[0];
        sortBone(parent);
        if (c.bones.length === 1) {
          cache.push(c);
          sortReset(parent.children);
        } else {
          const child = c.bones[c.bones.length - 1];
          sortBone(child);
          cache.push(c);
          sortReset(parent.children);
          child.sorted = true;
        }
      } else if (c instanceof Transform) {
        sortBone(c.target);
        for (const bone of c.bones) {
          if (c.data.local) {
            if (bone.parent) sortBone(bone.parent);
            sortBone(bone);
          } else sortBone(bone);
        }
        cache.push(c);
        for (const bone of c.bones) sortReset(bone.children);
        for (const bone of c.bones) bone.sorted = true;
      } else if (c instanceof Path) {
        const slotBone = c.target.bone;
        const sortPath = (att: Attachment | null | undefined) => {
          if (!att || att.kind !== "path") return;
          if (!att.vertices.bones) sortBone(slotBone);
          else {
            const bs = att.vertices.bones;
            for (let i = 0; i < bs.length; ) {
              let n = bs[i++];
              for (n += i; i < n; i++) sortBone(this.bones[bs[i]]);
            }
          }
        };
        for (const att of this.data.skin[c.target.data.index].values()) sortPath(att);
        sortPath(c.target.attachment);
        for (const bone of c.bones) sortBone(bone);
        cache.push(c);
        for (const bone of c.bones) sortReset(bone.children);
        for (const bone of c.bones) bone.sorted = true;
      } else {
        const bone = c.bone;
        sortBone(bone);
        cache.push(c);
        sortReset(bone.children);
        bone.sorted = true;
      }
    }
    for (const b of this.bones) sortBone(b);
    this.cache = cache;
  }

  setupPose() {
    for (const b of this.bones) b.setup();
    for (const s of this.slots) s.setup();
    for (const c of this.constraints) c.setup();
    this.drawOrder = this.slots.slice();
  }

  /** Start again from the first frame: the physics forget their motion. */
  restart() {
    this.time = 0;
    for (const c of this.constraints) if (c instanceof Physics) c.restart();
  }

  updateWorld() {
    for (const b of this.bones) b.toApplied();
    for (const item of this.cache) item.update();
  }

  /** Pose the skeleton at `time` seconds of the animation, from the setup pose. */
  apply(anim: Animation, time: number) {
    this.setupPose();
    for (const tl of anim.timelines) {
      switch (tl.kind) {
        case "rotate": case "translate": case "translatex": case "translatey": case "scale": case "scalex":
        case "scaley": case "shear": case "shearx": case "sheary": {
          const bone = this.bones[tl.bone], k = tl.keys;
          if (time < k.frames[0]) break;
          const d = bone.data;
          const v0 = sample(k, time, 0);
          switch (tl.kind) {
            case "rotate": bone.rotation = d.rotation + v0; break;
            case "translate": bone.x = d.x + v0; bone.y = d.y + sample(k, time, 1); break;
            case "translatex": bone.x = d.x + v0; break;
            case "translatey": bone.y = d.y + v0; break;
            case "scale": bone.scaleX = d.scaleX * v0; bone.scaleY = d.scaleY * sample(k, time, 1); break;
            case "scalex": bone.scaleX = d.scaleX * v0; break;
            case "scaley": bone.scaleY = d.scaleY * v0; break;
            case "shear": bone.shearX = d.shearX + v0; bone.shearY = d.shearY + sample(k, time, 1); break;
            case "shearx": bone.shearX = d.shearX + v0; break;
            case "sheary": bone.shearY = d.shearY + v0; break;
          }
          break;
        }
        case "inherit": {
          const i = stepIndex(tl.times, time);
          if (i >= 0) this.bones[tl.bone].inherit = tl.values[i];
          break;
        }
        case "rgba": case "alpha": case "rgba2": {
          const slot = this.slots[tl.slot], k = tl.keys;
          if (time < k.frames[0]) break;
          if (tl.kind === "alpha") slot.color[3] = sample(k, time, 0);
          else {
            for (let c = 0; c < 4; c++) slot.color[c] = sample(k, time, c);
            if (tl.kind === "rgba2") slot.dark = [sample(k, time, 4), sample(k, time, 5), sample(k, time, 6), 1];
          }
          break;
        }
        case "attachment": {
          const i = stepIndex(tl.times, time);
          if (i >= 0) this.slots[tl.slot].setAttachment(tl.names[i]);
          break;
        }
        case "drawOrder": {
          const i = stepIndex(tl.times, time);
          const order = i >= 0 ? tl.orders[i] : null;
          if (order) this.drawOrder = order.map((s) => this.slots[s]);
          break;
        }
        case "ik": {
          const c = this.constraints[tl.constraint] as Ik, k = tl.keys;
          if (time < k.frames[0]) break;
          c.mix = sample(k, time, 0);
          c.softness = sample(k, time, 1);
          const i = stepIndex(k.frames.filter((_, n) => n % k.stride === 0), time);
          c.bendDirection = tl.bend[i];
          c.compress = tl.compress[i];
          c.stretch = tl.stretch[i];
          break;
        }
        case "transform": {
          const c = this.constraints[tl.constraint] as Transform, k = tl.keys;
          if (time < k.frames[0]) break;
          c.mixRotate = sample(k, time, 0); c.mixX = sample(k, time, 1); c.mixY = sample(k, time, 2);
          c.mixScaleX = sample(k, time, 3); c.mixScaleY = sample(k, time, 4); c.mixShearY = sample(k, time, 5);
          break;
        }
        case "pathPosition": case "pathSpacing": case "pathMix": {
          const c = this.constraints[tl.constraint] as Path, k = tl.keys;
          if (time < k.frames[0]) break;
          if (tl.kind === "pathPosition") c.position = sample(k, time, 0);
          else if (tl.kind === "pathSpacing") c.spacing = sample(k, time, 0);
          else {
            c.mixRotate = sample(k, time, 0);
            c.mixX = sample(k, time, 1);
            c.mixY = sample(k, time, 2);
          }
          break;
        }
        case "physicsWind": case "physicsGravity": {
          const c = this.constraints[tl.constraint] as Physics, k = tl.keys;
          if (time < k.frames[0]) break;
          if (tl.kind === "physicsWind") c.wind = sample(k, time, 0);
          else c.gravity = sample(k, time, 0);
          break;
        }
        case "deform": {
          const slot = this.slots[tl.slot], att = slot.attachment;
          if (!att || att.kind === "region") break;
          const owner = att.kind === "mesh" ? att.deformOf : att;
          if (owner !== tl.attachment) break;
          const times = tl.times;
          if (time < times[0]) {
            slot.deform = [];
            break;
          }
          const i = stepIndex(times, time);
          if (i === times.length - 1) {
            slot.deform = tl.deforms[i].slice();
            break;
          }
          const percent = curvePercent(tl.curves[i], times[i], times[i + 1], time);
          const a = tl.deforms[i], b = tl.deforms[i + 1];
          slot.deform = a.map((v, n) => v + (b[n] - v) * percent);
          break;
        }
      }
    }
  }
}

/** Index of the last time not after t (-1 before the first). */
function stepIndex(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  if (t < times[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Value `channel` of the keys at time t (t at or after the first key). */
function sample(k: Keys, t: number, channel: number): number {
  const s = k.stride, n = k.frames.length / s;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (k.frames[mid * s] <= t) lo = mid;
    else hi = mid - 1;
  }
  const f = lo, v1 = k.frames[f * s + 1 + channel];
  if (f === n - 1) return v1;
  const t1 = k.frames[f * s], t2 = k.frames[(f + 1) * s], v2 = k.frames[(f + 1) * s + 1 + channel];
  const curve = k.curves[f];
  if (curve === "stepped") return v1;
  if (curve === "linear") return v1 + ((v2 - v1) * (t - t1)) / (t2 - t1);
  const i = channel * 4;
  return bezier(t, t1, v1, curve[i], curve[i + 1], curve[i + 2], curve[i + 3], t2, v2);
}

/** How far (0..1) between two deform keys, by their curve. */
function curvePercent(curve: number[] | "linear" | "stepped", t1: number, t2: number, t: number): number {
  if (curve === "stepped") return 0;
  if (curve === "linear") return (t - t1) / (t2 - t1);
  return bezier(t, t1, 0, curve[0], curve[1], curve[2], curve[3], t2, 1);
}

/** The value of a cubic Bézier through (t1, v1) and (t2, v2) at time t: its parameter found by bisection. */
function bezier(t: number, t1: number, v1: number, cx1: number, cy1: number, cx2: number, cy2: number, t2: number, v2: number) {
  let lo = 0, hi = 1, s = 0.5;
  for (let n = 0; n < 24; n++) {
    s = (lo + hi) / 2;
    const u = 1 - s;
    const x = u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2;
    if (x < t) lo = s;
    else hi = s;
  }
  const u = 1 - s;
  return u * u * u * v1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * v2;
}
