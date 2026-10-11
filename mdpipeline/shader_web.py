"""A Unity shader's drawing pass made ready for WebGL2 (엘리스 2026-10-11): the pass's vertex and pixel programs
translated (dxbc2glsl.py), wired to each other by the semantics in their DXBC signatures, with what the page has to
fill in — which attribute each vertex input is (POSITION, COLOR, TEXCOORD0 …), what each constant buffer holds
(names at their vec4 slots), which texture each t<N> is — and how the pass blends.

export(tree, vkd3d, keywords) -> dict, for a Shader's typetree: the colour pass's vertex and pixel programs, the
variants for the material's keywords.
"""
import os
import re
import struct
import subprocess
import tempfile

import lz4.block

from dxbc2glsl import translate

BLEND = {0: "ZERO", 1: "ONE", 2: "DST_COLOR", 3: "SRC_COLOR", 4: "ONE_MINUS_DST_COLOR", 5: "SRC_ALPHA",
         6: "ONE_MINUS_SRC_COLOR", 7: "DST_ALPHA", 8: "ONE_MINUS_DST_ALPHA", 9: "SRC_ALPHA_SATURATE", 10: "ONE_MINUS_SRC_ALPHA"}


def blob_entries(tree):
    """The shader's blob (the first platform's) cut into its entries: programs and parameter blocks by index."""
    first = lambda x: x[0][0] if isinstance(x[0], list) else x[0]
    blob = bytes(tree["compressedBlob"])
    o, c, d = first(tree["offsets"]), first(tree["compressedLengths"]), first(tree["decompressedLengths"])
    raw = lz4.block.decompress(blob[o:o + c], uncompressed_size=d)
    n = struct.unpack_from("<I", raw, 0)[0]
    return [raw[off:off + ln] for off, ln, _seg in (struct.unpack_from("<III", raw, 4 + 12 * i) for i in range(n))]


def dxbc_of(entry):
    j = entry.find(b"DXBC")
    return entry[j:j + int.from_bytes(entry[j + 24:j + 28], "little")]


class _Reader:
    def __init__(self, b):
        self.b, self.p = b, 0

    def u32(self):
        v = struct.unpack_from("<I", self.b, self.p)[0]
        self.p += 4
        return v

    def string(self):
        n = self.u32()
        s = self.b[self.p:self.p + n].decode()
        self.p += (n + 3) & ~3
        return s


def program_params(entry):
    """A program's own parameter block: its constant buffers (name, size, the values in them at byte offsets) and
    what it binds where — constant buffers to cb<N>, textures to t<N>."""
    r = _Reader(entry)
    assert r.u32() == 0x0C0A75BA, "parameter block"
    cbs = {}
    for _ in range(r.u32()):
        name, size = r.string(), r.u32()
        params = []
        for _ in range(r.u32()):
            pname = r.string()
            _type, rows, cols, matrix, _array, offset = (r.u32() for _ in range(6))
            params.append({"name": pname, "offset": offset, "dim": rows * cols if matrix else cols, "matrix": bool(matrix)})
        assert r.u32() == 0, "struct parameters"
        cbs[name] = {"size": size, "params": params}
    bindings, textures = {}, {}
    for _ in range(r.u32()):
        name, kind = r.string(), r.u32()
        if kind == 1:
            index, _array = r.u32(), r.u32()
            bindings[name] = index
        elif kind == 0:
            index, _sampler, _dim = r.u32(), r.u32(), r.u32()
            textures[name] = index
        else:
            raise ValueError(f"resource kind {kind} ({name})")
    return cbs, bindings, textures


def common_params(prog, names):
    cp = prog["m_CommonParameters"]
    cbs = {}
    for cb in cp["m_ConstantBuffers"]:
        params = [{"name": names[v["m_NameIndex"]], "offset": v["m_Index"], "dim": v["m_Dim"], "matrix": False}
                  for v in cb["m_VectorParams"]]
        params += [{"name": names[m["m_NameIndex"]], "offset": m["m_Index"], "dim": 4 * m.get("m_RowCount", 4), "matrix": True}
                   for m in cb["m_MatrixParams"]]
        cbs[names[cb["m_NameIndex"]]] = {"size": cb["m_Size"], "params": params}
    bindings = {names[b["m_NameIndex"]]: b["m_Index"] for b in cp["m_ConstantBufferBindings"]}
    textures = {names[t["m_NameIndex"]]: t["m_Index"] for t in cp["m_TextureParams"]}
    return cbs, bindings, textures


SKIP_PASSES = {"MOTIONVECTORS", "DEPTHNORMALSONLY", "DEPTHNORMALS", "DEPTHONLY", "SHADOWCASTER", "META"}


def main_pass(tree):
    """The pass that draws the colour: the first of the first subshader that is not a depth, motion or shadow pass."""
    for p in tree["m_ParsedForm"]["m_SubShaders"][0]["m_Passes"]:
        mode = dict(p["m_State"]["m_Tags"]["tags"]).get("LIGHTMODE", "")
        if mode.upper() not in SKIP_PASSES:
            return p
    raise ValueError("no colour pass")


def program(tree, entries, prog, names, keywords=()):
    """The variant for the material's keywords (the one with the most of them and none it lacks; without keywords, the
    plain one), its DXBC and everything it binds: {"cb": {N: {name, params}}, "t": {N: name}}."""
    subs = next(sp for sp in prog["m_PlayerSubPrograms"] if sp)
    blobs = next(b for b in prog["m_ParameterBlobIndices"] if b)
    known = tree["m_ParsedForm"].get("m_KeywordNames", [])
    want = set(keywords)

    def kw(e):
        return {known[i] if i < len(known) else i for i in e["m_KeywordIndices"]} | set(e.get("m_LocalKeywordIndices") or [])

    k = max((i for i, e in enumerate(subs) if kw(e) <= want), key=lambda i: len(kw(subs[i])))
    cbs, bindings, textures = common_params(prog, names)
    own_cbs, own_bindings, own_textures = program_params(entries[blobs[k]])
    for name, cb in own_cbs.items():
        have = cbs.setdefault(name, {"size": cb["size"], "params": []})
        known = {q["name"] for q in have["params"]}
        have["params"] += [q for q in cb["params"] if q["name"] not in known]
    bindings |= own_bindings
    textures |= own_textures
    return dxbc_of(entries[subs[k]["m_BlobIndex"]]), {
        "cb": {i: {"name": n, "params": cbs.get(n, {"params": []})["params"]} for n, i in bindings.items()},
        "t": {i: n for n, i in textures.items()},
    }


def signature(dxbc, tag):
    """{register: "SEMANTICindex"} from a DXBC input / output signature chunk (ISGN, OSGN)."""
    count = struct.unpack_from("<I", dxbc, 28)[0]
    for k in range(count):
        off = struct.unpack_from("<I", dxbc, 32 + 4 * k)[0]
        if dxbc[off:off + 4] != tag:
            continue
        data = off + 8
        n = struct.unpack_from("<I", dxbc, data)[0]
        out = {}
        for e in range(n):
            name_off, index, _sv, _ct, reg = struct.unpack_from("<IIIII", dxbc, data + 8 + 24 * e)
            end = dxbc.index(b"\0", data + name_off)
            out[reg] = dxbc[data + name_off:end].decode() + str(index)
        return out
    return {}


def rename(glsl, names):
    """Registers renamed as whole words, outside the comments that quote the original instructions."""
    out = []
    for line in glsl.splitlines():
        if not line.strip().startswith("//"):
            line = re.sub(r"\b(v\d+)\b", lambda m: names.get(m.group(1), m.group(1)), line)
        out.append(line)
    return "\n".join(out) + "\n"


def disassemble(dxbc, vkd3d):
    with tempfile.TemporaryDirectory() as tmp:
        src, asm = os.path.join(tmp, "p.dxbc"), os.path.join(tmp, "p.asm")
        open(src, "wb").write(dxbc)
        subprocess.run([vkd3d, "-x", "dxbc-tpf", "-b", "d3d-asm", src, "-o", asm], check=True, capture_output=True)
        return open(asm).read()


def export(tree, vkd3d, keywords=()):
    entries = blob_entries(tree)
    pass0 = main_pass(tree)
    names = {idx: n for n, idx in pass0["m_NameIndices"]}
    vdx, vbind = program(tree, entries, pass0["progVertex"], names, keywords)
    pdx, pbind = program(tree, entries, pass0["progFragment"], names, keywords)
    vs, ps = translate(disassemble(vdx, vkd3d)), translate(disassemble(pdx, vkd3d))
    # wire the vertex outputs to the pixel inputs by semantic: both name them vary_<SEMANTIC><index>
    vout, pin = signature(vdx, b"OSGN"), signature(pdx, b"ISGN")
    vs = rename(vs, {f"v{r}": f"vary_{s}" for r, s in vout.items() if not s.startswith("SV_")})
    ps = rename(ps, {f"v{r}": f"vary_{s}" for r, s in pin.items() if not s.startswith("SV_")})
    # what the pixel program reads but the vertex program does not write stays zero
    missing = sorted({f"vary_{s}" for s in pin.values() if not s.startswith("SV_")} - {f"vary_{s}" for s in vout.values()})
    if missing:
        vs = vs.replace("void main() {", "\n".join(f"out vec4 {m};" for m in missing) + "\nvoid main() {", 1)
        vs = vs.replace("  vec4 pos = vec4(0.0);", "  vec4 pos = vec4(0.0);\n" + "\n".join(f"  {m} = vec4(0.0);" for m in missing), 1)
    # the pixel program's uniforms renamed so the two programs' cb<N> / t<N> do not collide when linked
    ps = re.sub(r"\b(cb|t)(\d+)\b", lambda m: f"p{m.group(1)}{m.group(2)}", ps)
    rt = pass0["m_State"]["rtBlend0"]

    def factor(f):
        return {"name": f.get("name", ""), "value": f.get("val", 1)}

    return {
        "name": tree["m_ParsedForm"]["m_Name"], "vs": vs, "fs": ps,
        "attributes": {f"a{r}": sem for r, sem in signature(vdx, b"ISGN").items()},
        "vertex": vbind, "pixel": pbind,
        "blend": {"src": factor(rt["srcBlend"]), "dst": factor(rt["destBlend"]),
                  "srcAlpha": factor(rt["srcBlendAlpha"]), "dstAlpha": factor(rt["destBlendAlpha"])},
        "cull": factor(pass0["m_State"]["culling"]),
    }
