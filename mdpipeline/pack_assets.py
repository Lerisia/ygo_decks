"""The pack simulator's pictures and sounds (엘리스 2026-10-12), from what was taken out of the Master Duel client into
storage/md/packs: every pack front by its file name (MdPack.cover; small, and hd/ for the opening), the opening's
effects, the card back, and the opening sounds as MP3. Konami's assets: they go to media (md_ui/packs, md_ui/packopen), never to the public
repository. Needs Pillow and soundfile (storage/md/packs/venv).

usage: pack_assets.py <storage/md/packs> <media dir> [--effects-only]
"""
import os
import sys

import soundfile
from PIL import Image

EFFECTS = {   # opening textures → the names the page asks for
    "CardPackOpenBG01": "rays", "CardPackOpenBGFrash01": "rays_flash", "card_eff_raritySR": "glow_sr",
    "card_eff_rarityUR": "glow_ur", "CardOverEffectSR": "foil_sr", "CardOverEffectUR": "foil_ur",
    "PackHighlightFlareN": "flare_n", "PackHighlightFlareSR": "flare_sr", "PackHighlightFlareUR": "flare_ur",
    "PackOpenRainbow": "rainbow", "icon_new": "new", "PickUp": "pickup", "openSlash": "slash",
    # particles and light for the reveal, the cut and the background (drawn added, black is nothing)
    "CardEffectPreStar01": "star", "CardEffectPreStar02": "star_big", "Default-Particle": "dot",
    "fxt_par_3x3_002": "shards", "fxt_fre_011": "burst", "fxt_ple_002": "soft", "fxt_ple_006": "cross",
    "fxt_msk_001": "glow_soft", "CardPackOpenParticle01": "bg_particle", "CardOpenScroll01": "streaks",
    "thunderTest02": "thunder", "fxt_tnd_2x2_002": "lightning", "PackOpenMonsFrare01": "mons_flare",
    "EfDuelHighlight00_01_02": "card_light", "EffectLine01": "line", "fxt_msk_006": "fade_mask",
}
SOUNDS = ["se_packopen_01_op", "se_packopen_02_packout", "se_packopen_02_packout_1pack", "se_packopen_03_cut",
          "se_packopen_04_cardin", "se_packopen_05_cardout", "se_packopen_card_sr", "se_packopen_card_ur",
          "se_packopen_hope", "se_pack_card_move_01", "se_pack_card_shake"]


def webp(src, dst, size=None, quality=85):
    img = Image.open(src).convert("RGBA")
    if size and img.width > size[0]:
        img = img.resize((size[0], round(img.height * size[0] / img.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    img.save(dst, "WEBP", quality=quality, method=4)


def main():
    src, media = sys.argv[1:3]
    packs = os.path.join(media, "md_ui/packs")
    done = 0
    for f in sorted(os.listdir(os.path.join(src, "images/sd")) if "--effects-only" not in sys.argv else []):
        key = f[:-4]
        webp(os.path.join(src, "images/sd", f), os.path.join(packs, f"{key}.webp"), quality=82)
        webp(os.path.join(src, "images/hd", f), os.path.join(packs, "hd", f"{key}.webp"))
        done += 1
    opening = os.path.join(media, "md_ui/packopen")
    for name, out in EFFECTS.items():
        webp(os.path.join(src, "open/textures", name + ".png"), os.path.join(opening, out + ".webp"), size=(512, 512), quality=90)
    webp(os.path.join(src, "card_back/ProtectorIcon1070001.png"), os.path.join(opening, "back.webp"), size=(352, 704))
    os.makedirs(os.path.join(opening, "sound"), exist_ok=True)
    for name in SOUNDS:
        data, rate = soundfile.read(os.path.join(src, "sounds", name + ".wav"))
        soundfile.write(os.path.join(opening, "sound", name.replace("se_packopen_", "").replace("se_pack_", "") + ".mp3"),
                        data, rate, format="MP3", subtype="MPEG_LAYER_III")
    print(f"{done} pack fronts, {len(EFFECTS) + 1} effects, {len(SOUNDS)} sounds")


if __name__ == "__main__":
    main()
