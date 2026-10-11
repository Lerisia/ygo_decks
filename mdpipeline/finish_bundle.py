"""Master Duel's UI card finishes (NormalStyleUI / ShineStyleUI / RoyalStyleUI) for the card book (엘리스 2026-10-11):
pulls each shader's pixel program out of data.unity3d, disassembles it with vkd3d-compiler, translates it to GLSL
(dxbc2glsl.py) and writes, next to the textures it samples, a finish.json the page's renderer reads:

  per style: material — the UnityPerMaterial values, from the style's material (RoyalStyle / ShineStyle: it also
             carries the UI shader's own properties — _ClipRect, _Stencil … — so the game draws the deck screen's
             cards with it), else the shader's defaults, which leave the rainbow off,
             bindings — which cbN each constant buffer is, inputs — which varying carries uv / colour / normal …,
             textures — what each t<N> samples (@card = the card face), params — where the per-card values go
             (the attribute icon's tile).

Everything written is Konami's (textures, translated shaders): it goes to media, never to the public repository.

usage: finish_bundle.py <masterduel_Data/data.unity3d> <out dir> [--vkd3d path/to/vkd3d-compiler]
"""
import argparse
import json
import os
import subprocess
import tempfile

import lz4.block
import UnityPy

from dxbc2glsl import translate

STYLES = {"normal": "NormalStyleUI", "shine": "ShineStyleUI", "royal": "RoyalStyleUI"}
MATERIAL_3D = {"normal": "RoyalStyle", "shine": "ShineStyle", "royal": "RoyalStyle"}
INPUTS = {   # read off each vertex program: which output varying carries what
    "normal": {"uv": 1, "color": 3, "pos": 4, "normal": 5},
    "shine": {"tangent": 1, "uv": 2, "color": 4, "pos": 5, "normal": 6},
    "royal": {"tangent": 1, "uv": 2, "color": 4, "pos": 5, "normal": 6},
}
# The shader embosses the attribute glyph from its atlas over the icon the face already shows: the tile goes where
# carddb/face.py draws the icon (the atlas glyphs match ours as a 64 px tile at 597, 48 on the 704×1024 face).
ICON_X, ICON_Y, ICON_SIZE = 597, 48, 64
SX, SY = 704 / ICON_SIZE, 1024 / ICON_SIZE
OVERRIDES = {"_AttributeSize_Pos": [SX, SY, SX / 2 - 0.5 - ICON_X / ICON_SIZE, (ICON_Y + ICON_SIZE) / ICON_SIZE - SY / 2 - 0.5]}
# _LevelRankValue stays 0, leaving the stars alone: the shader embosses them on Master Duel's spacing (48.7 px, ending
# at 644 px) and ours step 52 px, so its stars would smudge ours
PARAMS = {"attribute": "_AttributeTile"}
DEFAULT_TEX = {0: "@white", 1: "@black", 2: "@gray", 3: "@bump"}


def pixel_program(tree, vkd3d):
    """GLSL of the shader's first pixel program variant."""
    blob = bytes(tree["compressedBlob"])
    o, c, d = (x[0][0] if isinstance(x[0], list) else x[0] for x in (tree["offsets"], tree["compressedLengths"], tree["decompressedLengths"]))
    raw = lz4.block.decompress(blob[o:o + c], uncompressed_size=d)
    programs, i = [], 0
    while (j := raw.find(b"DXBC", i)) >= 0:
        programs.append(raw[j:j + int.from_bytes(raw[j + 24:j + 28], "little")])
        i = j + 4
    with tempfile.TemporaryDirectory() as tmp:
        for k, prog in enumerate(programs):
            src, asm = os.path.join(tmp, f"{k}.dxbc"), os.path.join(tmp, f"{k}.asm")
            open(src, "wb").write(prog)
            subprocess.run([vkd3d, "-x", "dxbc-tpf", "-b", "d3d-asm", src, "-o", asm], check=True, capture_output=True)
            text = open(asm).read()
            if text.startswith("ps_"):
                return translate(text)
    raise ValueError("no pixel program")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("out")
    ap.add_argument("--vkd3d", default="/home/elyss/storage/vkd3d/vkd3d-compiler")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    env = UnityPy.load(args.data)
    textures, materials, shaders = {}, {}, {}
    for obj in env.objects:
        kind = obj.type.name
        if kind not in ("Texture2D", "Material", "Shader"):
            continue
        if kind == "Shader":
            tree = obj.read_typetree()
            name = tree["m_ParsedForm"]["m_Name"].split("/")[-1]
            if name in STYLES.values():
                shaders[name] = tree
            continue
        try:
            name = obj.peek_name()
        except Exception:
            continue
        if kind == "Texture2D":
            textures[obj.path_id] = (name, obj)
        elif name in set(MATERIAL_3D.values()):
            materials[name] = obj.read_typetree()
    config, wanted = {}, {}
    for style, shader_name in STYLES.items():
        tree = shaders[shader_name]
        open(os.path.join(args.out, f"{style}.frag"), "w").write(pixel_program(tree, args.vkd3d))
        pf = tree["m_ParsedForm"]
        props = {p["m_Name"]: p for p in pf["m_PropInfo"]["m_Props"]}
        mat3d = materials[MATERIAL_3D[style]]["m_SavedProperties"]
        values3d = {k: [v[c] for c in "rgba"] for k, v in mat3d["m_Colors"]} | {k: [v] * 4 for k, v in mat3d["m_Floats"]}
        textures3d = {k: textures.get(v["m_Texture"]["m_PathID"], (None, None))[0] for k, v in mat3d["m_TexEnvs"]}
        p = pf["m_SubShaders"][0]["m_Passes"][0]
        names = {idx: n for n, idx in p["m_NameIndices"]}
        cp = p["progFragment"]["m_CommonParameters"]
        material, params = None, {}
        for cb in cp["m_ConstantBuffers"]:
            if names[cb["m_NameIndex"]] != "UnityPerMaterial":
                continue
            material = [0.0] * (cb["m_Size"] // 4)
            for v in cb["m_VectorParams"]:
                nm, base = names[v["m_NameIndex"]], v["m_Index"] // 4
                if nm.endswith("_TexelSize"):
                    vals = [1 / 16, 1 / 16, 16, 16]
                elif nm in OVERRIDES:
                    vals = OVERRIDES[nm]
                elif nm in values3d:
                    vals = values3d[nm]
                else:
                    pr = props[nm]
                    vals = [pr[f"m_DefValue[{i}]"] for i in range(4)]
                for i in range(v["m_Dim"]):
                    material[base + i] = float(vals[i])
                for key, prop in PARAMS.items():
                    if nm == prop:
                        params[key] = base
        slots = {}
        for tp in cp["m_TextureParams"]:
            nm = names[tp["m_NameIndex"]]
            if nm == "_MainTex":
                file = "@card"
            elif textures3d.get(nm):
                file = textures3d[nm]
                wanted[file] = next(o for n, o in textures.values() if n == file)
            else:
                default = props.get(nm, {}).get("m_DefTexture", {}).get("m_DefaultName", 0)
                file = DEFAULT_TEX.get(default, f"@{default}" if isinstance(default, str) and default else "@white")
            slots[tp["m_Index"]] = {"name": nm, "file": file}
        config[style] = {
            "material": material,
            "bindings": {names[b["m_NameIndex"]]: b["m_Index"] for b in cp["m_ConstantBufferBindings"]},
            "inputs": INPUTS[style], "textures": slots, "params": params,
        }
    for name, obj in wanted.items():
        obj.read().image.save(os.path.join(args.out, f"{name}.png"))
    json.dump(config, open(os.path.join(args.out, "finish.json"), "w"), indent=1)
    print({s: (len(c["material"]), c["params"], sorted({t["file"] for t in c["textures"].values()})) for s, c in config.items()})


if __name__ == "__main__":
    main()
