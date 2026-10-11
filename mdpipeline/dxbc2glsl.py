"""Translate a Shader Model 4 pixel program, as vkd3d-compiler prints it (-b d3d-asm), into a GLSL ES 3.00 fragment
shader, instruction by instruction — so the card page can run Master Duel's own Royal / Shine finish (엘리스
2026-10-11: "마듀의 로얄 코드를 한 번 확인해보시죠").

The registers stay as they are: vec4 r0..rN, the constant buffers as uniform vec4 arrays cb0[], cb1[], cb2[], the
textures t0..tN as sampler2D uniforms and the inputs v1..vN as vec4 varyings. Comparisons give 1.0 / 0.0 instead of
all-ones bit masks; the "and" that turns such a mask into a float (and r, mask, l(bits)) is handled as a select.

usage: python dxbc2glsl.py program.asm > program.frag
"""
import re
import struct
import sys

COMPS = "xyzw"


def float_of(token):
    """A literal as GLSL float text: decimal floats as they are, integers as the float with those bits."""
    token = token.strip()
    if re.fullmatch(r"-?\d+", token) and abs(int(token)) > 1 << 16:
        return repr(struct.unpack("<f", struct.pack("<I", int(token) & 0xFFFFFFFF))[0])
    v = float(token)
    if v != v or v in (float("inf"), float("-inf")):
        return "0.0"
    return repr(v)


def split_operands(text):
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


class Operand:
    def __init__(self, text):
        t = text.strip()
        self.neg = t.startswith("-")
        if self.neg:
            t = t[1:]
        self.abs = t.startswith("|") and t.endswith("|")
        if self.abs:
            t = t[1:-1]
        self.literal = None
        if t.startswith("l("):
            self.literal = [float_of(x) for x in t[2:-1].split(",")]
            self.base, self.swz = None, None
        else:
            m = re.fullmatch(r"([a-z]+\d*(?:\[\d+\])?)(?:\.([xyzw]+))?", t)
            if not m:
                raise ValueError(f"operand {text!r}")
            self.base, self.swz = m.group(1), m.group(2) or "xyzw"

    def pick(self, positions):
        """GLSL expression for the components at the given positions (destination mask positions)."""
        if self.literal is not None:
            vals = [self.literal[p] if len(self.literal) > 1 else self.literal[0] for p in positions]
            expr = vals[0] if len(vals) == 1 else f"vec{len(vals)}({', '.join(vals)})"
        else:
            swz = self.swz if len(self.swz) == 4 else (self.swz * 4)[:4]
            if len(self.swz) == 1:
                swz = self.swz * 4
            comps = "".join(swz[p] for p in positions)
            expr = f"{self.base}.{comps}"
        if self.abs:
            expr = f"abs({expr})"
        if self.neg:
            expr = f"(-{expr})"
        return expr


def dest(text):
    m = re.fullmatch(r"([a-z]+\d*)(?:\.([xyzw]+))?", text.strip())
    name, mask = m.group(1), m.group(2) or "xyzw"
    return name, mask, [COMPS.index(c) for c in mask]


def vec(n):
    return "float" if n == 1 else f"vec{n}"


def translate(asm):
    lines = [l.strip() for l in asm.splitlines() if l.strip()]
    body, decl = [], {"cb": {}, "t": set(), "v": set(), "temps": 0}
    for line in lines:
        op, _, rest = line.partition(" ")
        if op.startswith("ps_") or op in ("ret",) or op.startswith("dcl_sampler") or op == "dcl_output":
            continue
        if op == "dcl_constantBuffer":
            m = re.match(r"cb(\d+)\[(\d+)\]", rest)
            decl["cb"][int(m.group(1))] = int(m.group(2))
            continue
        if op == "dcl_resource_texture2d":
            decl["t"].add(int(re.search(r"t(\d+)", rest).group(1)))
            continue
        if op.startswith("dcl_input_ps"):
            decl["v"].add(int(re.search(r"v(\d+)", rest).group(1)))
            continue
        if op == "dcl_temps":
            decl["temps"] = int(rest)
            continue
        if op.startswith("dcl_"):
            raise ValueError(f"unhandled declaration: {line}")
        sat = op.endswith("_sat")
        base = op[:-4] if sat else op
        ops = split_operands(rest)
        body.append(f"  // {line}")
        if base == "sincos":
            src = Operand(ops[2])
            for d, fn in ((ops[0], "sin"), (ops[1], "cos")):
                if d == "null":
                    continue
                name, mask, pos = dest(d)
                e = f"{fn}({src.pick(pos)})"
                body.append(f"  {name}.{mask} = {f'clamp({e}, 0.0, 1.0)' if sat else e};")
            continue
        name, mask, pos = dest(ops[0])
        n = len(pos)
        srcs = [Operand(o) for o in ops[1:]]
        if base in ("sample", "sample_b", "sample_l"):
            uv, res = srcs[0], srcs[1]
            tex_idx = int(res.base[1:])
            call = {"sample": f"texture(t{tex_idx}, {uv.pick([0, 1])})",
                    "sample_b": f"texture(t{tex_idx}, {uv.pick([0, 1])}, {srcs[3].pick([0])})",
                    "sample_l": f"textureLod(t{tex_idx}, {uv.pick([0, 1])}, {srcs[3].pick([0])})"}[base]
            swz = res.swz if len(res.swz) == 4 else (res.swz * 4)[:4]
            e = f"{call}.{''.join(swz[p] for p in pos)}"
        elif base in ("dp2", "dp3", "dp4"):
            k = int(base[2])
            e = f"dot({srcs[0].pick(list(range(k)))}, {srcs[1].pick(list(range(k)))})"
            e = e if n == 1 else f"{vec(n)}({e})"
        else:
            a = [s.pick(pos) for s in srcs]
            V = vec(n)
            one = "1.0" if n == 1 else f"{V}(1.0)"
            zero = "0.0" if n == 1 else f"{V}(0.0)"
            cmp = {"ge": ">=", "lt": "<", "eq": "==", "ne": "!="}
            if base == "mov":
                e = a[0]
            elif base == "add":
                e = f"({a[0]} + {a[1]})"
            elif base == "mul":
                e = f"({a[0]} * {a[1]})"
            elif base == "mad":
                e = f"({a[0]} * {a[1]} + {a[2]})"
            elif base == "div":
                e = f"({a[0]} / {a[1]})"
            elif base in ("min", "max"):
                e = f"{base}({a[0]}, {a[1]})"
            elif base == "frc":
                e = f"fract({a[0]})"
            elif base == "sqrt":
                e = f"sqrt({a[0]})"
            elif base == "rsq":
                e = f"inversesqrt({a[0]})"
            elif base == "exp":
                e = f"exp2({a[0]})"
            elif base == "log":
                e = f"log2({a[0]})"
            elif base == "round_ni":
                e = f"floor({a[0]})"
            elif base == "round_pi":
                e = f"ceil({a[0]})"
            elif base == "round_z":
                e = f"trunc({a[0]})"
            elif base == "round_ne":
                e = f"roundEven({a[0]})"
            elif base in ("dsx", "dsx_coarse", "dsx_fine"):
                e = f"dFdx({a[0]})"
            elif base in ("dsy", "dsy_coarse", "dsy_fine"):
                e = f"dFdy({a[0]})"
            elif base in cmp:
                if n == 1:
                    e = f"(({a[0]}) {cmp[base]} ({a[1]}) ? 1.0 : 0.0)"
                else:
                    fn = {"ge": "greaterThanEqual", "lt": "lessThan", "eq": "equal", "ne": "notEqual"}[base]
                    e = f"{V}({fn}({a[0]}, {a[1]}))"
            elif base == "and":
                # mask & bits: the bits where the mask is set; mask & mask: both set
                lit = 1 if srcs[1].literal is not None else (0 if srcs[0].literal is not None else None)
                if lit is None:
                    m0 = f"({a[0]} != 0.0 ? 1.0 : 0.0)" if n == 1 else f"{V}(notEqual({a[0]}, {zero}))"
                    e = f"({m0} * {a[1]})"
                else:
                    other = a[1 - lit]
                    m0 = f"({other} != 0.0 ? 1.0 : 0.0)" if n == 1 else f"{V}(notEqual({other}, {zero}))"
                    e = f"({m0} * {a[lit]})"
            elif base == "movc":
                c = f"({a[0]} != 0.0)" if n == 1 else f"notEqual({a[0]}, {zero})"
                e = f"({c} ? {a[1]} : {a[2]})" if n == 1 else f"mix({a[2]}, {a[1]}, {V}({c}))"
            else:
                raise ValueError(f"unhandled instruction: {line}")
            del one
        if sat:
            e = f"clamp({e}, 0.0, 1.0)"
        target = "fragColor" if name == "o0" else name
        body.append(f"  {target}.{mask} = {e};")
    head = ["#version 300 es", "precision highp float;", "precision highp int;"]
    head += [f"uniform vec4 cb{i}[{n}];" for i, n in sorted(decl["cb"].items())]
    head += [f"uniform sampler2D t{i};" for i in sorted(decl["t"])]
    head += [f"in vec4 v{i};" for i in sorted(decl["v"])]
    head += ["out vec4 fragColor;", "void main() {"]
    head += [f"  vec4 r{i} = vec4(0.0);" for i in range(decl["temps"])]
    head += ["  fragColor = vec4(0.0);"]
    return "\n".join(head + body + ["}"]) + "\n"


if __name__ == "__main__":
    sys.stdout.write(translate(open(sys.argv[1]).read()))
