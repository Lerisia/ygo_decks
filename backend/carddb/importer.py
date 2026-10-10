import struct
from datetime import date
from pathlib import Path

from django.db import transaction

from .md import (
    NAME_TREATED, card_ids, decrypt, frame_of, is_card, parse_prop, parse_rarity, parse_ruby, parse_same,
    parse_texts, ruby_reading, split_text,
)
from .models import Card, CardText, MdPrint, Override, SrcMd

CARD_FIELDS = [
    "category", "name_ja", "name_ja_ruby", "name_ko", "frame", "types", "attribute", "race", "level", "rank",
    "link_rating", "atk", "def_value", "link_markers", "pendulum_scale", "spell_trap_subtype",
]
TEXT_FIELDS = ["materials", "effect", "pendulum_effect", "flavor"]


def _read(folder, locale, part):
    return decrypt((Path(folder) / f"{locale}_card_{part}.bytes").read_bytes())


def _locale(folder, locale, ruby=False):
    prop = _read(folder, locale, "prop")
    texts = parse_texts(_read(folder, locale, "name"), _read(folder, locale, "desc"), _read(folder, locale, "indx"), prop)
    rubies = parse_ruby(_read(folder, locale, "rubyname"), _read(folder, locale, "rubyindx"), prop) if ruby else {}
    props = dict(zip(card_ids(prop), struct.iter_unpack("<II", prop)))
    return texts, rubies, props


def apply_overrides(card_ids_=None):
    qs = Override.objects.all()
    if card_ids_ is not None:
        qs = qs.filter(card_id__in=card_ids_)
    for o in qs:
        if o.field.startswith("text."):
            _, lang, name = o.field.split(".")
            CardText.objects.filter(card_id=o.card_id, lang=lang).update(**{name: o.value})
        else:
            Card.objects.filter(id=o.card_id).update(**{o.field: o.value})


@transaction.atomic
def import_md(ja_dir, ko_dir, md_dir=None, today=None):
    md_dir = Path(md_dir or ja_dir)
    today = today or date.today()
    ja, ruby, props = _locale(ja_dir, "ja-jp", ruby=True)
    ko, _, _ = _locale(ko_dir, "ko-kr")
    alt = {a: b for a, b, flag in parse_same(decrypt((md_dir / "md_card_same.bytes").read_bytes())) if flag != NAME_TREATED}
    rarity = parse_rarity((md_dir / "md_card_rarity_asset.bytes").read_bytes())
    first_import = not MdPrint.objects.exists()
    seen = None if first_import else today

    cards, texts, prints, srcs = {}, [], [], []
    skipped = 0
    for cid, (a, b) in props.items():
        if cid == 0:
            continue
        p = parse_prop(a, b)
        name_ja, text_ja = ja.get(cid, ("", ""))
        if cid not in alt and not is_card(cid, p, name_ja, text_ja):
            skipped += 1
            continue
        for lang, source in (("ja", ja), ("ko", ko)):
            if cid in source:
                name, text = source[cid]
                srcs.append(SrcMd(md_id=cid, lang=lang, name=name, ruby=ruby.get(cid, "") if lang == "ja" else "", text=text, prop_a=a, prop_b=b))
        if cid in alt:
            continue
        name_ko, text_ko = ko.get(cid, ("", ""))
        types = p["types"]
        fields = {k: v for k, v in p.items() if k in CARD_FIELDS}
        cards[cid] = Card(
            id=cid, name_ja=name_ja, name_ja_ruby=ruby_reading(ruby.get(cid, name_ja)), name_ko=name_ko,
            frame=frame_of(p["category"], types), **fields,
        )
        texts.append(CardText(card_id=cid, lang="ja", **split_text(text_ja, types, "ja")))
        if text_ko:
            texts.append(CardText(card_id=cid, lang="ko", **split_text(text_ko, types, "ko")))
        prints.append(MdPrint(md_id=cid, card_id=cid, is_alt_art=False, rarity=rarity.get(cid, ""), first_seen=seen))
    for a_id, base in alt.items():
        if a_id in props and base in cards:
            prints.append(MdPrint(md_id=a_id, card_id=base, is_alt_art=True, rarity=rarity.get(a_id, ""), first_seen=seen))

    Card.objects.bulk_create(cards.values(), update_conflicts=True, unique_fields=["id"], update_fields=CARD_FIELDS + ["updated_at"])
    CardText.objects.bulk_create(texts, update_conflicts=True, unique_fields=["card", "lang"], update_fields=TEXT_FIELDS)
    MdPrint.objects.bulk_create(prints, update_conflicts=True, unique_fields=["md_id"], update_fields=["card", "is_alt_art", "rarity"])
    SrcMd.objects.bulk_create(srcs, update_conflicts=True, unique_fields=["md_id", "lang"], update_fields=["name", "ruby", "text", "prop_a", "prop_b", "fetched_at"])
    apply_overrides(list(cards))
    return {"cards": len(cards), "prints": len(prints), "alt_arts": sum(p.is_alt_art for p in prints), "texts": len(texts), "skipped": skipped}
