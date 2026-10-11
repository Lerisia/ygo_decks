"""Master Duel's Shine / Royal finish drawn off screen (moderngl over EGL, the server's own GPU), as the card book draws
it in the browser (frontend/src/lib/cardFinish.ts): the scanner learns finished cards from these.

usage: finish_render.py <bundle dir> <jobs.jsonl> <out dir> [--size 256x372] [--background 24,24,28]

A job: {"face": path, "out": name, "style": "shine" | "royal", "time": seconds, "light": [x, y, z] (toward the light),
"intensity": k, "attribute": tile, "level": stars, "frame": "normal" | "link" | "pendulum" | "overframe", "name": the
name mask's path (optional: without it no name is painted)}. Jobs of one
face should come together: its texture is loaded once for them. Each picture is saved as <out dir>/<out> (webp), the
finish laid over the background colour.
"""
import argparse
import json
import os
import re
import sys

import moderngl
import numpy as np
from PIL import Image

SOLID = {"@white": (255, 255, 255, 255), "@black": (0, 0, 0, 0), "@gray": (128, 128, 128, 255),
         "@bump": (128, 128, 255, 255), "@overframe": (0, 62, 0, 255)}
NO_NAME = (0, 0, 0, 255)   # the name slot without a mask: no name painted (as the renders before name masks)
STYLES = ("shine", "royal")
VERTEX_VALUES = {
    "tangent": "vec4(1., 0., 0., 1.)",
    "uv": "vec4(uv, 0., 0.)",
    "color": "vec4(1.)",
    "pos": "vec4((uv - .5) * vec2(7.04, 10.24), 0., 1.)",
    "normal": "vec4(0., 0., -1., 0.)",
}


def vertex_source(inputs):
    outs = "\n".join(f"out vec4 v{i};" for i in inputs.values())
    sets = "\n".join(f"  v{i} = {VERTEX_VALUES[k]};" for k, i in inputs.items())
    return f"#version 330 core\nin vec2 p;\n{outs}\nvoid main() {{\n  vec2 uv = p * .5 + .5;\n{sets}\n  gl_Position = vec4(p, 0., 1.);\n}}"


class FinishRenderer:
    def __init__(self, bundle, size):
        self.ctx = moderngl.create_standalone_context(backend="egl")
        self.size = size
        self.cfg = json.load(open(os.path.join(bundle, "finish.json")))
        self.bundle = bundle
        quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], "f4").tobytes())
        self.programs, self.vaos, self.sizes = {}, {}, {}
        for s in STYLES:
            fs = open(os.path.join(bundle, f"{s}.frag")).read().replace("#version 300 es", "#version 330 core", 1)
            pr = self.ctx.program(vertex_shader=vertex_source(self.cfg[s]["inputs"]), fragment_shader=fs)
            self.programs[s] = pr
            self.vaos[s] = self.ctx.vertex_array(pr, [(quad, "2f", "p")])
            self.sizes[s] = {m[1]: int(m[2]) for m in re.finditer(r"uniform vec4 cb(\d+)\[(\d+)\]", fs)}
        self.textures = {}
        for s in STYLES:
            for i in self.cfg[s]["textures"]:
                for frame in ("normal", "link", "pendulum", "overframe"):
                    file = self.file_at(s, i, frame)
                    if file not in ("@card", "@name") and file not in self.textures:
                        self.textures[file] = self.solid(SOLID[file]) if file in SOLID else \
                            self.image(Image.open(os.path.join(bundle, f"{file}.png")), repeat=True)
        self.fbo = self.ctx.simple_framebuffer(size, components=4)
        self.card = None
        self.no_name = self.name = self.solid(NO_NAME)

    def file_at(self, style, i, frame):
        return self.cfg[style].get("frames", {}).get(frame, {}).get(i) or self.cfg[style]["textures"][i]["file"]

    def image(self, im, repeat):
        im = im.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM)   # Unity's uv starts at the bottom left
        t = self.ctx.texture(im.size, 4, im.tobytes())
        t.build_mipmaps()
        t.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR)
        t.repeat_x = t.repeat_y = repeat
        return t

    def solid(self, rgba):
        t = self.ctx.texture((1, 1), 4, bytes(rgba))
        t.filter = (moderngl.NEAREST, moderngl.NEAREST)
        return t

    def set_face(self, path):
        if self.card:
            self.card.release()
        self.card = self.image(Image.open(path), repeat=False)

    def set_name(self, path):
        """The card's name mask (face.py's draw_name_mask: the shaders paint the name in gold or white), or none."""
        if self.name is not self.no_name:
            self.name.release()
        self.name = self.image(Image.open(path), repeat=False) if path else self.no_name

    def draw(self, style, time, light, intensity, attribute, level, frame):
        cfg, pr = self.cfg[style], self.programs[style]
        for i in cfg["textures"]:
            file = self.file_at(style, i, frame)
            (self.card if file == "@card" else self.name if file == "@name" else self.textures[file]).use(location=int(i))
            if f"t{i}" in pr:
                pr[f"t{i}"].value = int(i)
        glob = np.zeros((134, 4), "f4")
        glob[5, :3] = light
        glob[6] = (intensity, intensity, intensity, 1)
        glob[19] = (time, np.sin(time), np.cos(time), 0)
        glob[21] = (0, 0, -30, 0)
        glob[66:70] = np.eye(4, dtype="f4")
        per_draw = np.zeros((45, 4), "f4")
        per_draw[9] = (0, 0, 0, 1)
        material = np.array(cfg["material"], "f4")
        if "attribute" in cfg["params"]:
            material[cfg["params"]["attribute"]] = attribute
        if "level" in cfg["params"]:
            material[cfg["params"]["level"]] = level
        data = {"$Globals": glob.ravel(), "UnityPerDraw": per_draw.ravel(), "UnityPerMaterial": material}
        for name, idx in cfg["bindings"].items():
            n = self.sizes[style].get(str(idx))
            if n and f"cb{idx}" in pr and name in data:
                buf = np.zeros(n * 4, "f4")
                src = data[name][: n * 4]
                buf[: len(src)] = src
                pr[f"cb{idx}"].write(buf.tobytes())
        self.fbo.use()
        self.fbo.clear(0, 0, 0, 0)
        self.vaos[style].render(moderngl.TRIANGLE_STRIP)
        px = np.frombuffer(self.fbo.read(components=4), np.uint8).reshape(self.size[1], self.size[0], 4)[::-1]
        return px

    @staticmethod
    def over(px, background):
        """The drawn finish (premultiplied, as the page shows it) over a background colour."""
        rgb, a = px[..., :3].astype(np.float32), px[..., 3:].astype(np.float32) / 255
        return Image.fromarray(np.clip(rgb + np.array(background, np.float32) * (1 - a), 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("jobs")
    ap.add_argument("out")
    ap.add_argument("--size", default="256x372")
    ap.add_argument("--background", default="24,24,28")
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()
    size = tuple(int(v) for v in args.size.split("x"))
    background = [int(v) for v in args.background.split(",")]
    r = FinishRenderer(args.bundle, size)
    face, done = None, 0
    for line in open(args.jobs):
        job = json.loads(line)
        out = os.path.join(args.out, job["out"])
        if os.path.exists(out):
            continue
        if job["face"] != face:
            r.set_face(job["face"])
            r.set_name(job.get("name"))
            face = job["face"]
        px = r.draw(job["style"], job["time"], job["light"], job.get("intensity", 1.0), job.get("attribute", 0),
                    job.get("level", 0), job.get("frame", "normal"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        r.over(px, background).save(out, quality=args.quality)
        done += 1
        if done % 2000 == 0:
            print(done, flush=True)
    print(done, "drawn", file=sys.stderr)


if __name__ == "__main__":
    main()
