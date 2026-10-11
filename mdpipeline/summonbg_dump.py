"""Master Duel's attribute backgrounds behind a summon (SummonMonster_Bg<attr>_S2 in data.unity3d): the whole prefab
dumped as JSON — every object with its transform and components' serialized data, with references to other objects
resolved to (file, path id) keys — for working out how to replay it (엘리스 2026-10-11).

usage: summonbg_dump.py <data.unity3d> <prefab name> <out.json>

The game's own scripts (MonoBehaviours: the timeline, its tracks and clips) carry no type tree in the build: they are
read through one made from the game's code (GameAssembly.dll and global-metadata.dat next to it).
"""
import os

import json
import sys

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator


def main():
    data, name, out = sys.argv[1:4]
    env = UnityPy.load(data)
    game = os.path.dirname(os.path.dirname(data))
    gen = TypeTreeGenerator(next(iter(o.assets_file.unity_version for o in env.objects)))
    gen.load_il2cpp(open(os.path.join(game, "GameAssembly.dll"), "rb").read(),
                    open(os.path.join(game, "masterduel_Data/il2cpp_data/Metadata/global-metadata.dat"), "rb").read())
    scripts = {}

    def read(o):
        """An object's serialized data; a MonoBehaviour through the nodes made for its script."""
        if o.type.name != "MonoBehaviour":
            return o.read_typetree()
        head = o.read_typetree(check_read=False)
        ref = head["m_Script"]
        fid = ref["m_FileID"]
        fname = o.assets_file.name if fid == 0 else o.assets_file.externals[fid - 1].path.split("/")[-1]
        key = (fname, ref["m_PathID"])
        if key not in scripts:
            st = objs[key].read_typetree()
            asm = st["m_AssemblyName"][:-4] if st["m_AssemblyName"].endswith(".dll") else st["m_AssemblyName"]
            full = f"{st['m_Namespace']}.{st['m_ClassName']}" if st["m_Namespace"] else st["m_ClassName"]
            try:
                scripts[key] = (full, json.loads(gen.get_nodes_as_json(asm, full)))
            except Exception:
                scripts[key] = (full, None)
        full, nodes = scripts[key]
        tt = o.read_typetree(nodes=nodes, check_read=False) if nodes else head
        tt["_class"] = full
        return tt
    objs = {(o.assets_file.name, o.path_id): o for o in env.objects}
    root = next(k for k, o in objs.items() if o.type.name == "GameObject" and _name(o) == name)
    seen, dump = set(), {}

    def visit(k):
        if k in seen or k not in objs:
            return
        seen.add(k)
        o = objs[k]
        try:
            tt = read(o)
        except Exception as e:
            tt = {"_error": str(e)}
        dump[f"{k[0]}:{k[1]}"] = {"type": o.type.name, "data": tt}
        if o.type.name in ("Texture2D", "Shader", "Mesh", "Font", "Sprite", "AudioClip"):
            return   # leaves: their contents are exported separately
        for ref in _refs(tt):
            fid, pid = ref
            if pid and fid == 0:
                visit((k[0], pid))
            elif pid:
                ext = o.assets_file.externals[fid - 1].name if fid - 1 < len(o.assets_file.externals) else None
                if ext:
                    visit((ext.split("/")[-1], pid))

    visit(root)
    json.dump({"root": f"{root[0]}:{root[1]}", "objects": dump}, open(out, "w"), default=str)
    kinds = {}
    for v in dump.values():
        kinds[v["type"]] = kinds.get(v["type"], 0) + 1
    print(len(dump), "objects", kinds)


def _name(o):
    try:
        return o.peek_name()
    except Exception:
        return None


def _refs(tt):
    if isinstance(tt, dict):
        if set(tt.keys()) >= {"m_FileID", "m_PathID"}:
            yield (tt["m_FileID"], tt["m_PathID"])
        for v in tt.values():
            yield from _refs(v)
    elif isinstance(tt, list):
        for v in tt:
            yield from _refs(v)


if __name__ == "__main__":
    main()
