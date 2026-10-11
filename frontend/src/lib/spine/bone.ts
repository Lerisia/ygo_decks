import type { BoneData, Inherit } from "./data";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** A bone in the pose: its local values as the animation set them, the applied local values the world transform was
 *  made from (constraints may change them), and the world transform (a b / c d, worldX / worldY). The skeleton itself
 *  sits at the origin, unscaled. */
export class Bone {
  children: Bone[] = [];
  x = 0; y = 0; rotation = 0; scaleX = 1; scaleY = 1; shearX = 0; shearY = 0; inherit: Inherit = "normal";
  ax = 0; ay = 0; arotation = 0; ascaleX = 1; ascaleY = 1; ashearX = 0; ashearY = 0;
  a = 1; b = 0; c = 0; d = 1; worldX = 0; worldY = 0;
  sorted = false;

  constructor(readonly data: BoneData, readonly parent: Bone | null) {
    this.setup();
  }

  setup() {
    const d = this.data;
    this.x = d.x; this.y = d.y; this.rotation = d.rotation; this.scaleX = d.scaleX; this.scaleY = d.scaleY;
    this.shearX = d.shearX; this.shearY = d.shearY; this.inherit = d.inherit;
  }

  /** The applied values start from the animated pose each frame. */
  toApplied() {
    this.ax = this.x; this.ay = this.y; this.arotation = this.rotation; this.ascaleX = this.scaleX;
    this.ascaleY = this.scaleY; this.ashearX = this.shearX; this.ashearY = this.shearY;
  }

  update() {
    this.updateWith(this.ax, this.ay, this.arotation, this.ascaleX, this.ascaleY, this.ashearX, this.ashearY);
  }

  /** World transform from these local values (which become the applied ones), through the parent as the bone
   *  inherits from it. */
  updateWith(x: number, y: number, rotation: number, scaleX: number, scaleY: number, shearX: number, shearY: number) {
    this.ax = x; this.ay = y; this.arotation = rotation; this.ascaleX = scaleX; this.ascaleY = scaleY;
    this.ashearX = shearX; this.ashearY = shearY;
    const p = this.parent;
    if (!p) {
      const rx = (rotation + shearX) * RAD, ry = (rotation + 90 + shearY) * RAD;
      this.a = Math.cos(rx) * scaleX; this.b = Math.cos(ry) * scaleY;
      this.c = Math.sin(rx) * scaleX; this.d = Math.sin(ry) * scaleY;
      this.worldX = x; this.worldY = y;
      return;
    }
    let pa = p.a, pb = p.b, pc = p.c, pd = p.d;
    this.worldX = pa * x + pb * y + p.worldX;
    this.worldY = pc * x + pd * y + p.worldY;
    switch (this.inherit) {
      case "normal": {
        const rx = (rotation + shearX) * RAD, ry = (rotation + 90 + shearY) * RAD;
        const la = Math.cos(rx) * scaleX, lb = Math.cos(ry) * scaleY, lc = Math.sin(rx) * scaleX, ld = Math.sin(ry) * scaleY;
        this.a = pa * la + pb * lc; this.b = pa * lb + pb * ld;
        this.c = pc * la + pd * lc; this.d = pc * lb + pd * ld;
        return;
      }
      case "onlyTranslation": {
        const rx = (rotation + shearX) * RAD, ry = (rotation + 90 + shearY) * RAD;
        this.a = Math.cos(rx) * scaleX; this.b = Math.cos(ry) * scaleY;
        this.c = Math.sin(rx) * scaleX; this.d = Math.sin(ry) * scaleY;
        return;
      }
      case "noRotationOrReflection": {
        // keep the parent's scale, drop its rotation (and any reflection)
        let s = pa * pa + pc * pc, prx: number;
        if (s > 0.0001) {
          s = Math.abs(pa * pd - pb * pc) / s;
          pb = pc * s;
          pd = pa * s;
          prx = Math.atan2(pc, pa) * DEG;
        } else {
          pa = 0;
          pc = 0;
          prx = 90 - Math.atan2(pd, pb) * DEG;
        }
        const rx = (rotation + shearX - prx) * RAD, ry = (rotation + shearY - prx + 90) * RAD;
        const la = Math.cos(rx) * scaleX, lb = Math.cos(ry) * scaleY, lc = Math.sin(rx) * scaleX, ld = Math.sin(ry) * scaleY;
        this.a = pa * la - pb * lc; this.b = pa * lb - pb * ld;
        this.c = pc * la + pd * lc; this.d = pc * lb + pd * ld;
        return;
      }
      case "noScale":
      case "noScaleOrReflection": {
        // keep the parent's rotation, drop its scale
        const r = rotation * RAD, cos = Math.cos(r), sin = Math.sin(r);
        let za = pa * cos + pb * sin, zc = pc * cos + pd * sin;
        let s = Math.sqrt(za * za + zc * zc);
        if (s > 0.00001) s = 1 / s;
        za *= s;
        zc *= s;
        s = Math.sqrt(za * za + zc * zc);
        if (this.inherit === "noScale" && pa * pd - pb * pc < 0) s = -s;
        const zr = Math.PI / 2 + Math.atan2(zc, za);
        const zb = Math.cos(zr) * s, zd = Math.sin(zr) * s;
        const la = Math.cos(shearX * RAD) * scaleX, lb = Math.cos((90 + shearY) * RAD) * scaleY;
        const lc = Math.sin(shearX * RAD) * scaleX, ld = Math.sin((90 + shearY) * RAD) * scaleY;
        this.a = za * la + zb * lc; this.b = za * lb + zb * ld;
        this.c = zc * la + zd * lc; this.d = zc * lb + zd * ld;
      }
    }
  }

  /** The applied local values that give the current world transform (after a constraint changed it). */
  updateApplied() {
    const p = this.parent;
    if (!p) {
      this.ax = this.worldX; this.ay = this.worldY;
      this.arotation = Math.atan2(this.c, this.a) * DEG;
      this.ascaleX = Math.sqrt(this.a * this.a + this.c * this.c);
      this.ascaleY = Math.sqrt(this.b * this.b + this.d * this.d);
      this.ashearX = 0;
      this.ashearY = Math.atan2(this.a * this.b + this.c * this.d, this.a * this.d - this.b * this.c) * DEG;
      return;
    }
    let pa = p.a, pb = p.b, pc = p.c, pd = p.d;
    let pid = 1 / (pa * pd - pb * pc);
    let ia = pd * pid, ib = pb * pid, ic = pc * pid, id = pa * pid;
    const dx = this.worldX - p.worldX, dy = this.worldY - p.worldY;
    this.ax = dx * ia - dy * ib;
    this.ay = dy * id - dx * ic;
    let ra: number, rb: number, rc: number, rd: number;
    if (this.inherit === "onlyTranslation") {
      ra = this.a; rb = this.b; rc = this.c; rd = this.d;
    } else {
      if (this.inherit === "noRotationOrReflection") {
        const s = Math.abs(pa * pd - pb * pc) / (pa * pa + pc * pc);
        pb = -pc * s;
        pd = pa * s;
        pid = 1 / (pa * pd - pb * pc);
        ia = pd * pid;
        ib = pb * pid;
      } else if (this.inherit === "noScale" || this.inherit === "noScaleOrReflection") {
        const r = this.rotation * RAD, cos = Math.cos(r), sin = Math.sin(r);
        pa = pa * cos + pb * sin;
        pc = pc * cos + pd * sin;
        let s = Math.sqrt(pa * pa + pc * pc);
        if (s > 0.00001) s = 1 / s;
        pa *= s;
        pc *= s;
        s = Math.sqrt(pa * pa + pc * pc);
        if (this.inherit === "noScale" && pid < 0) s = -s;
        const zr = Math.PI / 2 + Math.atan2(pc, pa);
        pb = Math.cos(zr) * s;
        pd = Math.sin(zr) * s;
        pid = 1 / (pa * pd - pb * pc);
        ia = pd * pid; ib = pb * pid; ic = pc * pid; id = pa * pid;
      }
      ra = ia * this.a - ib * this.c; rb = ia * this.b - ib * this.d;
      rc = id * this.c - ic * this.a; rd = id * this.d - ic * this.b;
    }
    this.ashearX = 0;
    this.ascaleX = Math.sqrt(ra * ra + rc * rc);
    if (this.ascaleX > 0.0001) {
      const det = ra * rd - rb * rc;
      this.ascaleY = det / this.ascaleX;
      this.ashearY = -Math.atan2(ra * rb + rc * rd, det) * DEG;
      this.arotation = Math.atan2(rc, ra) * DEG;
    } else {
      this.ascaleX = 0;
      this.ascaleY = Math.sqrt(rb * rb + rd * rd);
      this.ashearY = 0;
      this.arotation = 90 - Math.atan2(rd, rb) * DEG;
    }
  }

  worldScaleX() {
    return Math.sqrt(this.a * this.a + this.c * this.c);
  }

  /** A point given in the bone's own space, in the world. */
  toWorld(x: number, y: number): [number, number] {
    return [this.a * x + this.b * y + this.worldX, this.c * x + this.d * y + this.worldY];
  }
}

export { RAD, DEG };
