"""Master Duel's sound effects (엘리스 2026-10-18: the deck editor's sounds for the site's deck builder): the AudioClips
in masterduel_Data/data.unity3d, whose data sits in masterduel_Data/resources.resource as one FSB5 (Vorbis) per clip —
the clip's resource offset is the FSB5 header itself, so the file is sliced from header to header and handed to FMOD
(UnityPy's own reader hands FMOD the wrong bytes). The server has no sound device: FMOD runs with no output
(NOSOUND_NRT), as the cut-in sounds were decoded (10/11).

    storage/md/venv/bin/python mdpipeline/sfx_extract.py --game storage/md/ja/game --out <dir> [--match 'SE_MENU_|SE_CARD_MOVE'] [--list]
"""
import argparse
import bisect
import os
import re
from threading import Lock

import fmod_toolkit
import fmod_toolkit.fmod as fm
import pyfmodex
import UnityPy
from pyfmodex.enums import OUTPUTTYPE


def quiet_fmod():
    """fmod_toolkit's system, made with no output: the server has no sound card."""
    def make(channels, flags):
        with fm.SYSTEM_GLOBAL_LOCK:
            key = (channels, flags)
            if key not in fm.SYSTEM_INSTANCES:
                system = pyfmodex.System()
                system.output = OUTPUTTYPE.NOSOUND_NRT
                system.init(channels, flags, None)
                fm.SYSTEM_INSTANCES[key] = (system, Lock())
            return fm.SYSTEM_INSTANCES[key]
    fm.get_pyfmodex_system_instance = make


def clips(game):
    """Every AudioClip: (name, seconds, channels, frequency, resource offset)."""
    env = UnityPy.load(os.path.join(game, "masterduel_Data", "data.unity3d"))
    out = []
    for obj in env.objects:
        if obj.type.name != "AudioClip":
            continue
        d = obj.read()
        if d.m_Resource and d.m_Resource.m_Source.endswith("resources.resource"):
            out.append((d.m_Name, d.m_Length, d.m_Channels, d.m_Frequency, d.m_Resource.m_Offset))
    return sorted(out)


def extract(game, out, match=None):
    quiet_fmod()
    raw = open(os.path.join(game, "masterduel_Data", "resources.resource"), "rb").read()
    heads = [m.start() for m in re.finditer(b"FSB5", raw)]
    want = re.compile(match) if match else None
    os.makedirs(out, exist_ok=True)
    done = []
    for name, secs, channels, freq, offset in clips(game):
        if want and not want.search(name):
            continue
        i = bisect.bisect_right(heads, offset) - 1
        chunk = raw[heads[i]:heads[i + 1] if i + 1 < len(heads) else len(raw)]
        for fname, data in fmod_toolkit.raw_to_wav(chunk, name, channels or 2, freq or 44100).items():
            with open(os.path.join(out, fname), "wb") as f:
                f.write(data)
            done.append((fname, secs))
    return done


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default=os.path.expanduser("~/storage/md/ja/game"))
    ap.add_argument("--out", default=os.path.expanduser("~/storage/md/sfx"))
    ap.add_argument("--match", help="a regex on the clip's name; every clip when none")
    ap.add_argument("--list", action="store_true", help="only name the clips")
    a = ap.parse_args()
    if a.list:
        for name, secs, ch, freq, _ in clips(a.game):
            print(f"{name:36s} {secs:7.2f}s {ch}ch {freq}Hz")
    else:
        for fname, secs in extract(a.game, a.out, a.match):
            print(f"{fname:40s} {secs:6.2f}s")
