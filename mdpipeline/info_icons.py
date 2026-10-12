"""Master Duel's card-info icons (엘리스 2026-10-12): the attribute, race, spell / trap kind, level / rank / link /
pendulum scale and ATK / DEF icons of the game's card detail, for the card document's info box. Saved under the names
the site asks for (carddb's attribute, race and spell / trap keys), as lossless WebP. Konami's assets: they go to media
(md_ui/info/), never to the public repository.

usage: info_icons.py <masterduel_Data/data.unity3d> <out dir>
"""
import os
import sys

import UnityPy

ATTRIBUTES = ["light", "dark", "water", "fire", "earth", "wind", "divine", "spell", "trap"]          # Attr01..09
RACES = ["dragon", "zombie", "fiend", "pyro", "sea_serpent", "rock", "machine", "fish", "dinosaur", "insect", "beast",
         "beast_warrior", "plant", "aqua", "warrior", "winged_beast", "fairy", "spellcaster", "thunder", "reptile",
         "psychic", "wyrm", "cyberse", "divine_beast", "creator_god", "illusion"]                       # Type01..26
KINDS = {1: "counter", 2: "field", 3: "equip", 4: "continuous", 5: "quick_play", 6: "ritual"}         # Icon01..06

NAMES = {f"GUI_T_Icon1_Attr{i + 1:02d}": f"attr/{a}" for i, a in enumerate(ATTRIBUTES)}
NAMES |= {f"GUI_T_Icon1_Type{i + 1:02d}": f"race/{r}" for i, r in enumerate(RACES)}
NAMES |= {f"GUI_T_Icon1_Icon{i:02d}": f"kind/{k}" for i, k in KINDS.items()}
NAMES |= {"GUI_T_Icon1_Other_Level": "level", "GUI_T_Icon1_Other_Rank": "rank", "GUI_T_Icon1_Other_link": "link",
          "GUI_T_Icon1_Other_Pendulum": "scale", "GUI_Icon_Atk": "atk", "GUI_Icon_Def": "def"}


def main():
    data, out = sys.argv[1:3]
    for sub in ("attr", "race", "kind"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    done = set()
    for obj in UnityPy.load(data).objects:
        if obj.type.name != "Sprite":
            continue
        sprite = obj.read()
        name = NAMES.get(sprite.m_Name)
        if name and name not in done:
            sprite.image.save(os.path.join(out, f"{name}.webp"), lossless=True, method=6)
            done.add(name)
    missing = sorted(set(NAMES.values()) - done)
    print(f"{len(done)} icons", f"missing: {missing}" if missing else "")


if __name__ == "__main__":
    main()
