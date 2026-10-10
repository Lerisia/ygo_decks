import json
import os
from concurrent.futures import ProcessPoolExecutor

import UnityPy


def containers(path):
    try:
        return list(UnityPy.load(path).container.keys())
    except Exception:
        return []


def write_json(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def update_index(local_data, index_path, workers=4):
    old = {}
    if os.path.exists(index_path):
        with open(index_path) as f:
            old = json.load(f)
    files = {}
    for d, _, names in os.walk(local_data):
        for n in names:
            p = os.path.join(d, n)
            st = os.stat(p)
            files[os.path.relpath(p, local_data)] = (st.st_size, int(st.st_mtime))
    index = {k: v for k, v in old.items() if k in files and (v["size"], v["mtime"]) == files[k]}
    todo = sorted(k for k in files if k not in index)
    with ProcessPoolExecutor(workers) as ex:
        for k, names in zip(todo, ex.map(containers, [os.path.join(local_data, k) for k in todo], chunksize=32)):
            index[k] = {"size": files[k][0], "mtime": files[k][1], "names": names}
    write_json(index_path, index)
    return index, len(todo)
