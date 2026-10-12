"""Fronts for the packs the Master Duel client no longer holds a picture of (the 2022 selection packs, 엘리스 2026-10-13):
the same game texture as kept on Yugipedia ("<name>-Pack-Master Duel.png", 512×1024), cut to the client's width and
put with the others in storage/md/packs/images (sd and hd) as wiki_<pack id>; pack_map.json then names it as the
pack's image. Konami's pictures: they stay in storage and media, never in the public repository.

usage: pack_wiki_covers.py <storage/md/packs>
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image

API = "https://yugipedia.com/api.php"
HEADERS = {"User-Agent": "ygo-decks-packsim/1.0"}
FILE_NAMES = {"Recollection of the Story": "Recollection of Stories"}   # Yugipedia's name, where it differs from MDM's
HD_WIDTH = 498


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as r:
        return r.read()


def image_urls(names):
    titles = {f"File:{FILE_NAMES.get(n, n)}-Pack-Master Duel.png": n for n in names}
    q = urllib.parse.urlencode({"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
                                "iiprop": "url", "format": "json"})
    pages = json.loads(get(f"{API}?{q}"))["query"]["pages"].values()
    norm = {t.replace("_", " "): n for t, n in titles.items()}
    return {norm[p["title"]]: p["imageinfo"][0]["url"] for p in pages if p.get("imageinfo")}


def main():
    src = sys.argv[1]
    path = os.path.join(src, "pack_map.json")
    with open(path) as f:
        pack_map = json.load(f)
    missing = [p for p in pack_map["packs"]
               if not p.get("image") and p.get("mdm_name") and 1001 <= int(p["pack_id"]) <= 1999]
    urls = image_urls([p["mdm_name"] for p in missing])
    for p in missing:
        url = urls.get(p["mdm_name"])
        if not url:
            print("no picture:", p["pack_id"], p["mdm_name"])
            continue
        img = Image.open(io.BytesIO(get(url))).convert("RGBA")
        left = (img.width - HD_WIDTH) // 2
        hd = img.crop((left, 0, left + HD_WIDTH, img.height)).resize((HD_WIDTH, 1024), Image.LANCZOS)
        key = f"wiki_{p['pack_id']}"
        hd.save(os.path.join(src, "images/hd", key + ".png"))
        hd.resize((250, 512), Image.LANCZOS).save(os.path.join(src, "images/sd", key + ".png"))
        p.update(image=key, image_confidence="high",
                 image_method=f"the client no longer holds it; the game texture kept on Yugipedia ({url})")
        print(p["pack_id"], p["mdm_name"], "→", key)
    with open(path, "w") as f:
        json.dump(pack_map, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
