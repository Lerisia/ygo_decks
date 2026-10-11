/** Spine 4.2 skeleton data read from its JSON export. Written for the card book from the format's published
 *  description, not from Esoteric Software's runtimes (a public site would need their license; 엘리스 2026-10-11),
 *  and only as far as Master Duel's monster cut-ins go: bones, slots, one skin of region / mesh / linked mesh / path /
 *  clipping attachments, IK, transform, path and physics constraints, and the animations of these. */

export type Color = [number, number, number, number];
export type Inherit = "normal" | "onlyTranslation" | "noRotationOrReflection" | "noScale" | "noScaleOrReflection";
export type Blend = "normal" | "additive" | "multiply" | "screen";

export type BoneData = {
  index: number; name: string; parent: BoneData | null; length: number;
  x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number;
  inherit: Inherit;
};

export type SlotData = {
  index: number; name: string; bone: BoneData; color: Color; dark: Color | null; attachment: string | null;
  blend: Blend; visible: boolean;
};

/** Vertices of a mesh, path or clipping polygon: plain x, y pairs on the slot's bone, or weighted — per vertex the
 *  bones it follows (count, then indices) and per bone a bind position and weight (x, y, weight). */
export type Vertices = { bones: number[] | null; values: number[]; worldLength: number };

export type RegionAttachment = {
  kind: "region"; name: string; path: string; color: Color;
  x: number; y: number; scaleX: number; scaleY: number; rotation: number; width: number; height: number;
};
export type MeshAttachment = {
  kind: "mesh"; name: string; path: string; color: Color; width: number; height: number;
  uvs: number[]; triangles: number[]; vertices: Vertices;
  deformOf: MeshAttachment;   // whose deform keys move it: itself, or a linked mesh's parent
};
export type PathAttachment = {
  kind: "path"; name: string; closed: boolean; constantSpeed: boolean; lengths: number[]; vertices: Vertices;
};
export type ClippingAttachment = { kind: "clipping"; name: string; end: SlotData | null; vertices: Vertices };
export type Attachment = RegionAttachment | MeshAttachment | PathAttachment | ClippingAttachment;

export type IkData = {
  kind: "ik"; name: string; order: number; bones: BoneData[]; target: BoneData;
  mix: number; softness: number; bendDirection: number; compress: boolean; stretch: boolean; uniform: boolean;
};
export type TransformData = {
  kind: "transform"; name: string; order: number; bones: BoneData[]; target: BoneData;
  mixRotate: number; mixX: number; mixY: number; mixScaleX: number; mixScaleY: number; mixShearY: number;
  offsetRotation: number; offsetX: number; offsetY: number; offsetScaleX: number; offsetScaleY: number;
  offsetShearY: number; relative: boolean; local: boolean;
};
export type PathData = {
  kind: "path"; name: string; order: number; bones: BoneData[]; target: SlotData;
  positionMode: "fixed" | "percent"; spacingMode: "length" | "fixed" | "percent" | "proportional";
  rotateMode: "tangent" | "chain" | "chainScale"; offsetRotation: number; position: number; spacing: number;
  mixRotate: number; mixX: number; mixY: number;
};
export type PhysicsData = {
  kind: "physics"; name: string; order: number; bone: BoneData;
  x: number; y: number; rotate: number; scaleX: number; shearX: number; limit: number; step: number;
  inertia: number; strength: number; damping: number; massInverse: number; wind: number; gravity: number; mix: number;
};
export type ConstraintData = IkData | TransformData | PathData | PhysicsData;

/** Keyed values over time: frame f has its time at frames[f * stride] and stride - 1 values after it. curves[f] says
 *  how the values go on to frame f + 1: "linear", "stepped", or a Bézier per value (cx1, cy1, cx2, cy2 in time and
 *  value, as the export writes them). */
export type Keys = { stride: number; frames: number[]; curves: (number[] | "linear" | "stepped")[] };

export type Timeline =
  | { kind: "rotate" | "translate" | "translatex" | "translatey" | "scale" | "scalex" | "scaley" | "shear" | "shearx" | "sheary"; bone: number; keys: Keys }
  | { kind: "inherit"; bone: number; times: number[]; values: Inherit[] }
  | { kind: "rgba" | "alpha" | "rgba2"; slot: number; keys: Keys }
  | { kind: "attachment"; slot: number; times: number[]; names: (string | null)[] }
  | { kind: "deform"; slot: number; attachment: MeshAttachment | PathAttachment | ClippingAttachment; times: number[]; curves: Keys["curves"]; deforms: number[][] }
  | { kind: "drawOrder"; times: number[]; orders: (number[] | null)[] }
  | { kind: "ik"; constraint: number; keys: Keys; bend: number[]; compress: boolean[]; stretch: boolean[] }
  | { kind: "transform" | "pathMix"; constraint: number; keys: Keys }
  | { kind: "pathPosition" | "pathSpacing" | "physicsWind" | "physicsGravity"; constraint: number; keys: Keys };

export type Animation = { name: string; duration: number; timelines: Timeline[] };

export type SkeletonData = {
  bones: BoneData[]; slots: SlotData[]; skin: Map<string, Attachment>[]; constraints: ConstraintData[];
  animations: Map<string, Animation>; referenceScale: number;
};

type Json = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

export function color(hex: string | undefined, d: Color = [1, 1, 1, 1]): Color {
  if (!hex) return d;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), hex.length >= 8 ? n(6) : 1];
}

function vertices(raw: number[], count: number): Vertices {
  if (raw.length === count * 2) return { bones: null, values: raw.slice(), worldLength: count * 2 };
  const bones: number[] = [], values: number[] = [];
  for (let i = 0; i < raw.length; ) {
    const n = raw[i++];
    bones.push(n);
    for (let k = 0; k < n; k++) {
      bones.push(raw[i]);
      values.push(raw[i + 1], raw[i + 2], raw[i + 3]);
      i += 4;
    }
  }
  return { bones, values, worldLength: count * 2 };
}

/** Keys of a timeline: field names in order, with their defaults. */
function keys(list: Json[], fields: [string, number][], colorField?: string): Keys {
  const channels = colorField ? 4 : fields.length;
  const stride = 1 + channels;
  const frames: number[] = [], curves: Keys["curves"] = [];
  for (const k of list) {
    frames.push(num(k.time, 0));
    if (colorField) frames.push(...color(k[colorField]));
    else for (const [f, d] of fields) frames.push(num(k[f], d));
    curves.push(k.curve === "stepped" ? "stepped" : Array.isArray(k.curve) ? k.curve : "linear");
  }
  return { stride, frames, curves };
}

export function readSkeleton(json: Json): SkeletonData {
  const bones: BoneData[] = [], byBone = new Map<string, BoneData>();
  for (const b of json.bones ?? []) {
    const bone: BoneData = {
      index: bones.length, name: b.name, parent: b.parent ? byBone.get(b.parent)! : null, length: num(b.length, 0),
      x: num(b.x, 0), y: num(b.y, 0), rotation: num(b.rotation, 0), scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1),
      shearX: num(b.shearX, 0), shearY: num(b.shearY, 0), inherit: b.inherit ?? b.transform ?? "normal",
    };
    bones.push(bone);
    byBone.set(bone.name, bone);
  }
  const slots: SlotData[] = [], bySlot = new Map<string, SlotData>();
  for (const s of json.slots ?? []) {
    const slot: SlotData = {
      index: slots.length, name: s.name, bone: byBone.get(s.bone)!, color: color(s.color),
      dark: s.dark ? color(s.dark + "ff") : null, attachment: s.attachment ?? null, blend: s.blend ?? "normal",
      visible: s.visible !== false,
    };
    slots.push(slot);
    bySlot.set(slot.name, slot);
  }

  // one skin: the cut-ins export only the default one
  const skin: Map<string, Attachment>[] = slots.map(() => new Map());
  const linked: [MeshAttachment, string, string, boolean][] = [];
  for (const sk of json.skins ?? []) {
    for (const [slotName, atts] of Object.entries<Json>(sk.attachments ?? {})) {
      const slot = bySlot.get(slotName);
      if (!slot) continue;
      for (const [name, a] of Object.entries<Json>(atts)) {
        const type = a.type ?? "region";
        const path = a.path ?? a.name ?? name;
        if (type === "region") {
          skin[slot.index].set(name, {
            kind: "region", name, path, color: color(a.color), x: num(a.x, 0), y: num(a.y, 0),
            scaleX: num(a.scaleX, 1), scaleY: num(a.scaleY, 1), rotation: num(a.rotation, 0),
            width: num(a.width, 32), height: num(a.height, 32),
          });
        } else if (type === "mesh" || type === "linkedmesh") {
          const mesh: MeshAttachment = {
            kind: "mesh", name, path, color: color(a.color), width: num(a.width, 0), height: num(a.height, 0),
            uvs: a.uvs ?? [], triangles: a.triangles ?? [],
            vertices: type === "mesh" ? vertices(a.vertices, a.uvs.length / 2) : { bones: null, values: [], worldLength: 0 },
            deformOf: null as unknown as MeshAttachment,
          };
          mesh.deformOf = mesh;
          if (type === "linkedmesh") linked.push([mesh, slotName, a.parent, a.timelines !== false]);
          skin[slot.index].set(name, mesh);
        } else if (type === "path") {
          skin[slot.index].set(name, {
            kind: "path", name, closed: !!a.closed, constantSpeed: a.constantSpeed !== false, lengths: a.lengths ?? [],
            vertices: vertices(a.vertices, a.vertexCount),
          });
        } else if (type === "clipping") {
          skin[slot.index].set(name, {
            kind: "clipping", name, end: a.end ? bySlot.get(a.end) ?? null : null, vertices: vertices(a.vertices, a.vertexCount),
          });
        }
      }
    }
  }
  for (const [mesh, slotName, parentName, timelines] of linked) {
    const parent = skin[bySlot.get(slotName)!.index].get(parentName) as MeshAttachment | undefined;
    if (!parent) continue;
    mesh.uvs = parent.uvs;
    mesh.triangles = parent.triangles;
    mesh.vertices = parent.vertices;
    mesh.deformOf = timelines ? parent.deformOf : mesh;
  }

  const constraints: ConstraintData[] = [];
  for (const c of json.ik ?? []) {
    constraints.push({
      kind: "ik", name: c.name, order: num(c.order, 0), bones: c.bones.map((n: string) => byBone.get(n)!),
      target: byBone.get(c.target)!, mix: num(c.mix, 1), softness: num(c.softness, 0),
      bendDirection: c.bendPositive === false ? -1 : 1, compress: !!c.compress, stretch: !!c.stretch, uniform: !!c.uniform,
    });
  }
  for (const c of json.transform ?? []) {
    const mixX = num(c.mixX, 1), mixScaleX = num(c.mixScaleX, 1);
    constraints.push({
      kind: "transform", name: c.name, order: num(c.order, 0), bones: c.bones.map((n: string) => byBone.get(n)!),
      target: byBone.get(c.target)!, mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX), mixScaleX,
      mixScaleY: num(c.mixScaleY, mixScaleX), mixShearY: num(c.mixShearY, 1), offsetRotation: num(c.rotation, 0),
      offsetX: num(c.x, 0), offsetY: num(c.y, 0), offsetScaleX: num(c.scaleX, 0), offsetScaleY: num(c.scaleY, 0),
      offsetShearY: num(c.shearY, 0), relative: !!c.relative, local: !!c.local,
    });
  }
  for (const c of json.path ?? []) {
    const mixX = num(c.mixX, 1);
    constraints.push({
      kind: "path", name: c.name, order: num(c.order, 0), bones: c.bones.map((n: string) => byBone.get(n)!),
      target: bySlot.get(c.target)!, positionMode: c.positionMode ?? "percent", spacingMode: c.spacingMode ?? "length",
      rotateMode: c.rotateMode ?? "tangent", offsetRotation: num(c.rotation, 0), position: num(c.position, 0),
      spacing: num(c.spacing, 0), mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX),
    });
  }
  for (const c of json.physics ?? []) {
    constraints.push({
      kind: "physics", name: c.name, order: num(c.order, 0), bone: byBone.get(c.bone)!,
      x: num(c.x, 0), y: num(c.y, 0), rotate: num(c.rotate, 0), scaleX: num(c.scaleX, 0), shearX: num(c.shearX, 0),
      limit: num(c.limit, 5000), step: 1 / num(c.fps, 60), inertia: num(c.inertia, 1), strength: num(c.strength, 100),
      damping: num(c.damping, 1), massInverse: 1 / num(c.mass, 1), wind: num(c.wind, 0), gravity: num(c.gravity, 0),
      mix: num(c.mix, 1),
    });
  }
  const constraintIndex = (kind: string, name: string) => constraints.findIndex((c) => c.kind === kind && c.name === name);

  const animations = new Map<string, Animation>();
  for (const [name, an] of Object.entries<Json>(json.animations ?? {})) {
    const timelines: Timeline[] = [];
    let duration = 0;
    const seen = (times: number[]) => { if (times.length) duration = Math.max(duration, times[times.length - 1]); };
    const seenKeys = (k: Keys) => { if (k.frames.length) duration = Math.max(duration, k.frames[k.frames.length - k.stride]); };

    for (const [boneName, tls] of Object.entries<Json>(an.bones ?? {})) {
      const bone = byBone.get(boneName);
      if (!bone) continue;
      for (const [kind, list] of Object.entries<Json[]>(tls)) {
        let k: Keys | null = null;
        if (kind === "rotate") k = keys(list, [["value", 0]]);
        else if (kind === "translate") k = keys(list, [["x", 0], ["y", 0]]);
        else if (kind === "translatex" || kind === "translatey") k = keys(list, [["value", 0]]);
        else if (kind === "scale") k = keys(list, [["x", 1], ["y", 1]]);
        else if (kind === "scalex" || kind === "scaley") k = keys(list, [["value", 1]]);
        else if (kind === "shear") k = keys(list, [["x", 0], ["y", 0]]);
        else if (kind === "shearx" || kind === "sheary") k = keys(list, [["value", 0]]);
        else if (kind === "inherit") {
          const times = list.map((f) => num(f.time, 0));
          timelines.push({ kind: "inherit", bone: bone.index, times, values: list.map((f) => f.inherit ?? "normal") });
          seen(times);
          continue;
        }
        if (k) {
          timelines.push({ kind: kind as "rotate", bone: bone.index, keys: k });
          seenKeys(k);
        }
      }
    }
    for (const [slotName, tls] of Object.entries<Json>(an.slots ?? {})) {
      const slot = bySlot.get(slotName);
      if (!slot) continue;
      for (const [kind, list] of Object.entries<Json[]>(tls)) {
        if (kind === "attachment") {
          const times = list.map((f) => num(f.time, 0));
          timelines.push({ kind: "attachment", slot: slot.index, times, names: list.map((f) => f.name ?? null) });
          seen(times);
        } else if (kind === "rgba") {
          const k = keys(list, [], "color");
          timelines.push({ kind: "rgba", slot: slot.index, keys: k });
          seenKeys(k);
        } else if (kind === "alpha") {
          const k = keys(list, [["value", 1]]);
          timelines.push({ kind: "alpha", slot: slot.index, keys: k });
          seenKeys(k);
        } else if (kind === "rgba2") {
          const frames: number[] = [], curves: Keys["curves"] = [];
          for (const f of list) {
            frames.push(num(f.time, 0), ...color(f.light), ...color((f.dark ?? "000000") + "ff").slice(0, 3));
            curves.push(f.curve === "stepped" ? "stepped" : Array.isArray(f.curve) ? f.curve : "linear");
          }
          const k = { stride: 8, frames, curves };
          timelines.push({ kind: "rgba2", slot: slot.index, keys: k });
          seenKeys(k);
        }
      }
    }
    for (const [cname, list] of Object.entries<Json[]>(an.ik ?? {})) {
      const ci = constraintIndex("ik", cname);
      if (ci < 0) continue;
      const k = keys(list, [["mix", 1], ["softness", 0]]);
      timelines.push({
        kind: "ik", constraint: ci, keys: k, bend: list.map((f) => (f.bendPositive === false ? -1 : 1)),
        compress: list.map((f) => !!f.compress), stretch: list.map((f) => !!f.stretch),
      });
      seenKeys(k);
    }
    for (const [cname, list] of Object.entries<Json[]>(an.transform ?? {})) {
      const ci = constraintIndex("transform", cname);
      if (ci < 0) continue;
      const k = keys(list.map((f) => ({ ...f, mixY: f.mixY ?? f.mixX, mixScaleY: f.mixScaleY ?? f.mixScaleX })),
        [["mixRotate", 1], ["mixX", 1], ["mixY", 1], ["mixScaleX", 1], ["mixScaleY", 1], ["mixShearY", 1]]);
      timelines.push({ kind: "transform", constraint: ci, keys: k });
      seenKeys(k);
    }
    for (const [cname, tls] of Object.entries<Json>(an.path ?? {})) {
      const ci = constraintIndex("path", cname);
      if (ci < 0) continue;
      for (const [kind, list] of Object.entries<Json[]>(tls)) {
        let tl: Timeline | null = null;
        if (kind === "position") tl = { kind: "pathPosition", constraint: ci, keys: keys(list, [["value", 0]]) };
        else if (kind === "spacing") tl = { kind: "pathSpacing", constraint: ci, keys: keys(list, [["value", 0]]) };
        else if (kind === "mix") {
          tl = { kind: "pathMix", constraint: ci,
                 keys: keys(list.map((f) => ({ ...f, mixY: f.mixY ?? f.mixX })), [["mixRotate", 1], ["mixX", 1], ["mixY", 1]]) };
        }
        if (tl) {
          timelines.push(tl);
          seenKeys(tl.keys);
        }
      }
    }
    for (const [cname, tls] of Object.entries<Json>(an.physics ?? {})) {
      const ci = constraintIndex("physics", cname);
      if (ci < 0) continue;
      for (const [kind, list] of Object.entries<Json[]>(tls)) {
        if (kind !== "wind" && kind !== "gravity") continue;
        const k = keys(list, [["value", 0]]);
        timelines.push({ kind: kind === "wind" ? "physicsWind" : "physicsGravity", constraint: ci, keys: k });
        seenKeys(k);
      }
    }
    for (const skinTls of Object.values<Json>(an.attachments ?? {})) {
      for (const [slotName, atts] of Object.entries<Json>(skinTls)) {
        const slot = bySlot.get(slotName);
        if (!slot) continue;
        for (const [attName, tls] of Object.entries<Json>(atts)) {
          const att = skin[slot.index].get(attName);
          const list: Json[] | undefined = tls.deform;
          if (!att || att.kind === "region" || !list) continue;
          const v = att.vertices;
          const setup = v.bones ? null : v.values;
          const length = v.bones ? (v.values.length / 3) * 2 : v.values.length;
          const times: number[] = [], curves: Keys["curves"] = [], deforms: number[][] = [];
          for (const f of list) {
            times.push(num(f.time, 0));
            curves.push(f.curve === "stepped" ? "stepped" : Array.isArray(f.curve) ? f.curve : "linear");
            const d = setup ? setup.slice() : new Array<number>(length).fill(0);
            const vs: number[] | undefined = f.vertices;
            if (vs) {
              const off = num(f.offset, 0);
              for (let i = 0; i < vs.length; i++) d[off + i] += vs[i];
            }
            deforms.push(d);
          }
          timelines.push({ kind: "deform", slot: slot.index, attachment: att, times, curves, deforms });
          seen(times);
        }
      }
    }
    if (an.drawOrder) {
      const times: number[] = [], orders: (number[] | null)[] = [];
      for (const f of an.drawOrder as Json[]) {
        times.push(num(f.time, 0));
        orders.push(f.offsets ? drawOrder(slots.length, f.offsets.map((o: Json) => [bySlot.get(o.slot)!.index, o.offset])) : null);
      }
      timelines.push({ kind: "drawOrder", times, orders });
      seen(times);
    }
    animations.set(name, { name, duration, timelines });
  }
  return { bones, slots, skin, constraints, animations, referenceScale: num(json.skeleton?.referenceScale, 100) };
}

/** The draw order a key's offsets give: each named slot moves by its offset, the rest keep their order around them. */
function drawOrder(count: number, offsets: [number, number][]): number[] {
  const order = new Array<number>(count).fill(-1);
  const unchanged: number[] = [];
  let original = 0, u = 0;
  for (const [slot, offset] of offsets) {
    while (original !== slot) unchanged[u++] = original++;
    order[original + offset] = original++;
  }
  while (original < count) unchanged[u++] = original++;
  for (let i = count - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged[--u];
  return order;
}
