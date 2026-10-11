"""Every DXBC program of a Unity shader in data.unity3d, disassembled (vkd3d-compiler) into <out dir>/<shader>.<n>.asm,
with its kind and declarations listed — for working out a shader before translating it (dxbc2glsl.py).

usage: shader_programs.py <data.unity3d> <out dir> <shader name> [...]
"""
import os
import subprocess
import sys
import tempfile

import lz4.block
import UnityPy

VKD3D = "/home/elyss/storage/vkd3d/vkd3d-compiler"


def programs(tree):
    out = []
    blob = bytes(tree["compressedBlob"])
    offs, clens, dlens = tree["offsets"], tree["compressedLengths"], tree["decompressedLengths"]
    first = lambda x: x[0][0] if isinstance(x[0], list) else x[0]
    raw = lz4.block.decompress(blob[first(offs):first(offs) + first(clens)], uncompressed_size=first(dlens))
    i = 0
    while (j := raw.find(b"DXBC", i)) >= 0:
        out.append(raw[j:j + int.from_bytes(raw[j + 24:j + 28], "little")])
        i = j + 4
    return out


def main():
    data, out, names = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    env = UnityPy.load(data)
    for obj in env.objects:
        if obj.type.name != "Shader":
            continue
        tree = obj.read_typetree()
        name = tree["m_ParsedForm"]["m_Name"]
        if name.split("/")[-1] not in names:
            continue
        short = name.split("/")[-1]
        with tempfile.TemporaryDirectory() as tmp:
            for k, prog in enumerate(programs(tree)):
                src = os.path.join(tmp, f"{k}.dxbc")
                open(src, "wb").write(prog)
                asm = os.path.join(out, f"{short}.{k}.asm")
                subprocess.run([VKD3D, "-x", "dxbc-tpf", "-b", "d3d-asm", src, "-o", asm], check=True, capture_output=True)
                text = open(asm).read()
                decls = [l.strip() for l in text.splitlines() if l.strip().startswith(("dcl_input", "dcl_output"))]
                print(short, k, text.split()[0], len(text.splitlines()), "lines |", "; ".join(decls))


if __name__ == "__main__":
    main()
