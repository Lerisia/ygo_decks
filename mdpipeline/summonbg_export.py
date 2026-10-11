"""Master Duel's attribute background behind a summon (SummonMonster_Bg<attr>_S2), made ready for a web player
(엘리스 2026-10-11): from summonbg_dump.py's JSON, every particle system the timeline plays — when it starts, for how
long, with which seed, where it sits in the world, its modules as the game serialized them, its renderer and its
material — and the textures (PNG) and meshes (JSON) they draw with. Konami's assets: storage and media only.

Each material's shader goes along as shader/<name>.json (shader_web.py: its colour pass in GLSL, what it binds, how
it blends), so the page draws the particles with the game's own programs.

usage: summonbg_export.py <data.unity3d> <dump.json> <out dir> [vkd3d-compiler]
"""
import json
import math
import os
import struct
import sys
import zlib

import UnityPy

from shader_web import export as export_shader

VKD3D = "/home/elyss/storage/vkd3d/vkd3d-compiler"

MODULES = ("InitialModule", "ShapeModule", "EmissionModule", "SizeModule", "RotationModule", "ColorModule", "UVModule",
           "VelocityModule", "ClampVelocityModule", "CustomDataModule", "TrailModule", "NoiseModule", "ForceModule")
RENDERER = ("m_RenderMode", "m_RenderAlignment", "m_SortingFudge", "m_VelocityScale", "m_LengthScale",
            "m_CameraVelocityScale", "m_MinParticleSize", "m_MaxParticleSize", "m_Pivot", "m_Flip", "m_VertexStreams",
            "m_UseCustomVertexStreams", "m_SortingOrder", "m_SortMode")


def quat_matrix(q):
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def local_matrix(t):
    r, p, s = quat_matrix(t["m_LocalRotation"]), t["m_LocalPosition"], t["m_LocalScale"]
    sc = (s["x"], s["y"], s["z"])
    m = [[r[i][j] * sc[j] for j in range(3)] + [(p["x"], p["y"], p["z"])[i]] for i in range(3)]
    return m + [[0, 0, 0, 1]]


# the sprite properties the timeline's recorded clips animate, by the CRC32 the clips bind them with
SPRITE_CURVES = {zlib.crc32(n.encode()): n for n in ("m_Color.r", "m_Color.g", "m_Color.b", "m_Color.a")}
RATE = 60


def clip_curves(clip):
    """An AnimationClip's curves as functions of time, by binding index: streamed (cubic segments), dense (samples)
    and constant, in that order, as Unity stores them."""
    data = clip["m_MuscleClip"]["m_Clip"]["data"]
    streamed = data["m_StreamedClip"]
    words = streamed["data"]
    raw = struct.pack(f"<{len(words)}I", *words)
    segments = [[] for _ in range(streamed["curveCount"])]   # (start, a, b, c, d)
    p = 0
    while p < len(raw):
        t, n = struct.unpack_from("<fI", raw, p)
        p += 8
        for _ in range(n):
            idx = struct.unpack_from("<I", raw, p)[0]
            a, b, c, d = struct.unpack_from("<4f", raw, p + 4)
            p += 20
            segments[idx].append((t, a, b, c, d))

    def streamed_at(segs, t):
        cur = None
        for seg in segs:
            if seg[0] <= t:
                cur = seg
        if cur is None:
            return 0.0
        x = t - cur[0] if math.isfinite(cur[0]) else 0.0
        return ((cur[1] * x + cur[2]) * x + cur[3]) * x + cur[4]

    curves = [lambda t, s=s: streamed_at(s, t) for s in segments]
    dense = data["m_DenseClip"]
    n, frames = dense["m_CurveCount"], dense["m_FrameCount"]
    samples = dense["m_SampleArray"] if isinstance(dense["m_SampleArray"], list) else []
    for k in range(n):
        def dense_at(t, k=k):
            f = min(frames - 1, max(0.0, (t - dense["m_BeginTime"]) * dense["m_SampleRate"]))
            i = int(f)
            j = min(frames - 1, i + 1)
            return samples[i * n + k] + (samples[j * n + k] - samples[i * n + k]) * (f - i)
        curves.append(dense_at)
    for v in data["m_ConstantClip"]["data"]:
        curves.append(lambda t, v=v: v)
    return curves


def finite(v):
    """JSON without Infinity / NaN: a stepped key's infinite slope as the string "Infinity" (the page's isFinite reads it
    the same), NaN as 0."""
    if isinstance(v, float):
        if math.isnan(v):
            return 0.0
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        return v
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [finite(x) for x in v]
    return v


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def main():
    data, dump, out = sys.argv[1:4]
    vkd3d = sys.argv[4] if len(sys.argv) > 4 else VKD3D
    for sub in ("tex", "mesh", "shader"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    d = json.load(open(dump))
    O = d["objects"]
    file = d["root"].split(":")[0]

    def obj(pid):
        return O.get(f"{file}:{pid}")

    transforms = {v["data"]["m_GameObject"]["m_PathID"]: v["data"] for v in O.values() if v["type"] == "Transform"}
    by_tr = {int(k.split(":")[1]): v["data"] for k, v in O.items() if v["type"] == "Transform"}

    def world(go):
        t = transforms[go]
        m = local_matrix(t)
        father = t["m_Father"]["m_PathID"]
        while father:
            ft = by_tr[father]
            m = mul(local_matrix(ft), m)
            father = ft["m_Father"]["m_PathID"]
        return m

    def name(go):
        return obj(go)["data"]["m_Name"]

    director = next(v["data"] for v in O.values() if v["type"] == "PlayableDirector")
    exposed = {k: v["m_PathID"] for k, v in director["m_ExposedReferences"]["m_References"]}
    timeline = obj(director["m_PlayableAsset"]["m_PathID"])["data"]

    def tracks(refs):
        """Every track that plays, those inside group tracks too (a muted group mutes what is in it)."""
        for t in refs:
            track = obj(t["m_PathID"])["data"]
            if track.get("m_Muted"):
                continue
            yield t["m_PathID"], track
            yield from tracks(track.get("m_Children", []))

    # which game object each control clip plays, when and with which seed
    plays = []
    for _, track in tracks(timeline["m_Tracks"]):
        if not track["_class"].endswith("ControlTrack"):
            continue
        for c in track["m_Clips"]:
            asset = obj(c["m_Asset"]["m_PathID"])["data"]
            go = exposed.get(asset["sourceGameObject"]["exposedName"]["id"])
            if go:
                plays.append({"go": go, "start": c["m_Start"], "duration": c["m_Duration"],
                              "seed": asset["particleRandomSeed"]})

    textures, wraps, meshes, shaders, systems, sprites = {}, {}, {}, {}, [], []
    env = None

    def unity():
        nonlocal env
        if env is None:
            env = UnityPy.load(data)
            env.objs = {(o.assets_file.name, o.path_id): o for o in env.objects}
        return env

    def texture(pid):
        if pid not in textures:
            o = unity().objs[(file, pid)]
            t = o.read()
            textures[pid] = t.m_Name
            ts = t.m_TextureSettings
            wraps[pid] = [ts.m_WrapU, ts.m_WrapV]
            t.image.save(os.path.join(out, "tex", t.m_Name + ".png"))
        return textures[pid]

    def program(pid):
        if pid not in shaders:
            tree = unity().objs[(file, pid)].read_typetree()
            sh = export_shader(tree, vkd3d)
            shaders[pid] = sh["name"].replace("/", "_")
            json.dump(sh, open(os.path.join(out, "shader", shaders[pid] + ".json"), "w"), separators=(",", ":"))
        return shaders[pid]

    def mesh(pid):
        if pid not in meshes:
            o = unity().objs[(file, pid)]
            m = o.read()
            pos, uv, idx = [], [], []
            for line in m.export().splitlines():
                parts = line.split()
                if not parts:
                    continue
                if parts[0] == "v":
                    pos.append([float(x) for x in parts[1:4]])
                elif parts[0] == "vt":
                    uv.append([float(x) for x in parts[1:3]])
                elif parts[0] == "f":
                    idx.append([int(p.split("/")[0]) - 1 for p in parts[1:4]])
            meshes[pid] = m.m_Name
            # the OBJ export mirrors x (Unity is left-handed): back to Unity's own coordinates
            json.dump({"pos": [[-p[0], p[1], p[2]] for p in pos], "uv": uv, "tri": [[t[0], t[2], t[1]] for t in idx]},
                      open(os.path.join(out, "mesh", m.m_Name + ".json"), "w"))
        return meshes[pid]

    def under(go):
        """The game object (the timeline turns it on) and the active ones below it."""
        yield go
        for ch in transforms[go]["m_Children"]:
            child = by_tr[ch["m_PathID"]]["m_GameObject"]["m_PathID"]
            if obj(child)["data"]["m_IsActive"]:
                yield from under(child)

    def shader_file(mat):
        return program(mat["m_Shader"]["m_PathID"]) if mat else None

    for play in plays:
        for go in under(play["go"]):
            ps = next((v["data"] for v in O.values() if v["type"] == "ParticleSystem"
                       and v["data"]["m_GameObject"]["m_PathID"] == go), None)
            if ps is None:
                continue
            r = next(v["data"] for v in O.values() if v["type"] == "ParticleSystemRenderer"
                     and v["data"]["m_GameObject"]["m_PathID"] == go)
            if r["m_RenderMode"] == 5 or not r.get("m_Enabled", 1):   # nothing drawn
                continue
            mat = obj(r["m_Materials"][0]["m_PathID"])["data"] if r["m_Materials"] else None
            shader = obj(mat["m_Shader"]["m_PathID"]) if mat else None
            props = mat["m_SavedProperties"] if mat else {"m_Floats": [], "m_Colors": [], "m_TexEnvs": []}
            m = world(go)
            systems.append({
                "name": name(go), "start": play["start"], "duration": play["duration"], "seed": play["seed"],
                "world": [m[i][j] for j in range(4) for i in range(4)],   # column-major
                "ps": {k: ps[k] for k in ("lengthInSec", "looping", "startDelay", "simulationSpeed", "moveWithTransform",
                                           "scalingMode", "randomSeed", "autoRandomSeed") if k in ps}
                      | {k: ps[k] for k in MODULES if k in ps and ps[k].get("enabled")},
                "renderer": {k: r[k] for k in RENDERER if k in r}
                            | {"mesh": mesh(r["m_Mesh"]["m_PathID"]) if r["m_RenderMode"] == 4 and r["m_Mesh"]["m_PathID"] else None},
                "material": {
                    "name": mat["m_Name"] if mat else None,
                    "shader": shader["data"]["m_ParsedForm"]["m_Name"] if shader else None,
                    "program": shader_file(mat),
                    "queue": mat["m_CustomRenderQueue"] if mat else -1,
                    "floats": dict(props["m_Floats"]),
                    "colors": {k: [v["r"], v["g"], v["b"], v["a"]] for k, v in props["m_Colors"]},
                    "textures": {k: {"file": texture(v["m_Texture"]["m_PathID"]),
                                     "wrap": wraps[v["m_Texture"]["m_PathID"]],
                                     "scale": [v["m_Scale"]["x"], v["m_Scale"]["y"]],
                                     "offset": [v["m_Offset"]["x"], v["m_Offset"]["y"]]}
                                 for k, v in props["m_TexEnvs"] if v["m_Texture"]["m_PathID"]},
                },
            })
    # the sprites over the whole screen (the dark veil, the glow round the edges), their colour as the timeline's
    # recorded clips animate it, sampled 60 times a second
    length = max(p["start"] + p["duration"] for p in plays)
    animated = {}
    for pid, track in tracks(timeline["m_Tracks"]):
        if track["_class"].endswith("AnimationTrack") and track["m_InfiniteClip"]["m_PathID"]:
            animated[pid] = track["m_InfiniteClip"]["m_PathID"]
    by_animator = {b["value"]["m_PathID"]: animated[b["key"]["m_PathID"]]
                   for b in director["m_SceneBindings"] if b["key"]["m_PathID"] in animated}
    for go in under(int(d["root"].split(":")[1])):
        comps = {c["component"]["m_PathID"]: obj(c["component"]["m_PathID"]) for c in obj(go)["data"]["m_Component"]}
        sr = next((c["data"] for c in comps.values() if c and c["type"] == "SpriteRenderer"), None)
        if sr is None or not sr.get("m_Enabled", 1):
            continue
        animator = next((pid for pid, c in comps.items() if c and c["type"] == "Animator"), None)
        color = sr["m_Color"]
        tracks = {}
        clip_pid = by_animator.get(animator)
        if clip_pid:
            clip = unity().objs[(file, clip_pid)].read_typetree()
            curves = clip_curves(clip)
            for i, b in enumerate(clip["m_ClipBindingConstant"]["genericBindings"]):
                prop = SPRITE_CURVES.get(b["attribute"]) if b["typeID"] == 212 and b["path"] == 0 else None
                stop = max(length, clip["m_MuscleClip"]["m_StopTime"])
                if prop:
                    tracks[prop[-1]] = [round(curves[i](k / RATE), 4) for k in range(int(stop * RATE) + 2)]
        sprite = unity().objs[(file, sr["m_Sprite"]["m_PathID"])].read()
        sprite.image.save(os.path.join(out, "tex", sprite.m_Name + ".png"))
        sprites.append({"name": name(go), "file": sprite.m_Name, "color": [color["r"], color["g"], color["b"], color["a"]],
                        "order": sr["m_SortingOrder"], "z": world(go)[2][3], "curves": tracks, "rate": RATE})
    json.dump(finite({"systems": systems, "sprites": sprites, "length": length}),
              open(os.path.join(out, "fx.json"), "w"), separators=(",", ":"), allow_nan=False)
    print(len(systems), "systems,", len(sprites), "sprites,", len(textures), "textures,", len(meshes), "meshes")


if __name__ == "__main__":
    main()
