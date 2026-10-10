import struct
from datetime import date
from pathlib import Path

from django.db import transaction

from .md import (
    card_ids, decrypt, frame_of, is_alt_art, is_card, parse_collectible, parse_prop, parse_rarity, parse_ruby, parse_same,
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
    alt = {}
    for a, b, flag in parse_same(decrypt((md_dir / "md_card_same.bytes").read_bytes())):
        token_variant = flag == 0 and a in props and b in props and "token" in parse_prop(*props[a]).get("types", []) and ja.get(a) == ja.get(b)
        if is_alt_art(flag) or token_variant:
            alt[a] = b
    collectible = parse_collectible((md_dir / "md_cards_all.bytes").read_bytes())
    collectible_names = {ja[c][0] for c in collectible if c in ja}
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
        copy = cid not in collectible and name_ja in collectible_names and "token" not in p.get("types", [])
        if cid not in alt and (copy or not is_card(cid, p, name_ja, text_ja)):
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


REGION = {"ja": "ocg", "ko": "kr", "en": "tcg"}
DATE_FIELD = {"ja": "ocg_date", "ko": "kr_date", "en": "tcg_date"}


def read_products(offdb_dir, lang):
    import gzip
    import json

    from .official import parse_product

    root = Path(offdb_dir)
    out = []
    for p in json.loads((root / f"products_{lang}.json").read_text()):
        page = root / "raw" / lang / f"{p['pid']}.html.gz"
        if page.exists():
            out.append((p, parse_product(gzip.open(page, "rt", encoding="utf-8").read(), lang)))
    return out


def _official_card(cid, row, lang):
    from .md import frame_of

    fields = {k: row.get(k) for k in ("attribute", "race", "level", "rank", "link_rating", "atk", "def_value", "pendulum_scale")}
    fields = {k: (v if v is not None else (None if k not in ("attribute", "race") else "")) for k, v in fields.items()}
    return Card(
        id=cid, category=row["category"], types=row["types"], frame=frame_of(row["category"], row["types"]),
        link_markers=row.get("link_markers", []), spell_trap_subtype=row.get("spell_trap_subtype", ""), **fields,
    )


def _official_text(row, lang):
    t = split_text(row["text"], row["types"], lang)
    t["pendulum_effect"] = row.get("pendulum_effect", "")
    return t


@transaction.atomic
def import_official(offdb_dir, lang):
    from .models import Product, ProductCard, SrcOfficial

    products = read_products(offdb_dir, lang)
    products.sort(key=lambda x: x[1]["release_date"] or date.max)
    latest, first_date, links = {}, {}, set()
    for meta, page in products:
        pid, day = int(meta["pid"]), page["release_date"]
        Product.objects.update_or_create(id=pid, defaults={"region": REGION[lang], "name": meta["name"], "category": meta.get("category", ""), "release_date": day})
        for row in page["rows"]:
            latest[row["cid"]] = row
            links.add((pid, row["cid"], row["rarity"]))
            if day and (row["cid"] not in first_date or day < first_date[row["cid"]]):
                first_date[row["cid"]] = day
    ProductCard.objects.bulk_create([ProductCard(product_id=p, cid=c, rarity=r) for p, c, r in links], ignore_conflicts=True)
    SrcOfficial.objects.bulk_create(
        [SrcOfficial(cid=c, lang=lang, name=r["name"], data=r) for c, r in latest.items()],
        update_conflicts=True, unique_fields=["cid", "lang"], update_fields=["name", "data", "fetched_at"],
    )

    existing = set(Card.objects.values_list("id", flat=True))
    in_md = set(SrcMd.objects.values_list("md_id", flat=True))
    md_tokens = dict(Card.objects.filter(frame="token").values_list("name_ja", "id"))
    date_field = DATE_FIELD[lang]
    name_fields = {"ja": ["name_ja", "name_ja_ruby"], "ko": ["name_ko"], "en": ["name_en"]}[lang]
    new_cards, dated, named, refreshed, zeroed, texts, merged_tokens = [], [], [], [], [], [], 0
    for cid, row in latest.items():
        if cid not in existing and row["category"] == "monster" and "token" in row["types"] and lang == "ja" and row["name"] in md_tokens:
            merged_tokens += 1
            continue
        from_md = cid in in_md
        official = lang == "en" or not from_md
        card = _official_card(cid, row, lang) if (cid not in existing or (official and lang == "ja")) else Card(id=cid)
        setattr(card, date_field, first_date.get(cid))
        if official:
            if lang == "ja":
                card.name_ja, card.name_ja_ruby = row["name"], row["ruby"] or row["name"]
            elif lang == "ko":
                card.name_ko = row["name"]
            else:
                card.name_en = row["name"]
            texts.append(CardText(card_id=cid, lang=lang, **_official_text(row, lang)))
        if cid not in existing:
            new_cards.append(card)
            continue
        dated.append(card)
        if official:
            named.append(card)
            if lang == "ja":
                refreshed.append(card)
        elif lang == "ja" and (row.get("level") == 0 or row.get("rank") == 0):
            card.level, card.rank = row.get("level"), row.get("rank")
            zeroed.append(card)
    Card.objects.bulk_create(new_cards, batch_size=500)
    Card.objects.bulk_update(dated, [date_field], batch_size=500)
    Card.objects.bulk_update(named, name_fields, batch_size=500)
    Card.objects.bulk_update(refreshed, [f for f in CARD_FIELDS if f not in ("name_ko",)], batch_size=500)
    Card.objects.bulk_update(zeroed, ["level", "rank"], batch_size=500)
    CardText.objects.bulk_create(texts, update_conflicts=True, unique_fields=["card", "lang"], update_fields=TEXT_FIELDS, batch_size=500)
    apply_overrides([t.card_id for t in texts])
    return {"products": len(products), "cards_seen": len(latest), "new_cards": len(new_cards), "updated": len(dated), "level_rank_zero": len(zeroed), "merged_tokens": merged_tokens}


def import_art(manifest_path, prefix="cards/art"):
    import json

    from .models import MdArt

    manifest = json.loads(Path(manifest_path).read_text())
    prints = set(MdPrint.objects.values_list("md_id", flat=True))
    rows = []
    for key in manifest:
        version, md_id = key.split("/")
        if int(md_id) in prints:
            rows.append(MdArt(md_print_id=int(md_id), version=version, image=f"{prefix}/{key}.webp"))
    MdArt.objects.bulk_create(rows, update_conflicts=True, unique_fields=["md_print", "version"], update_fields=["image"], batch_size=500)
    return {"arts": len(rows), "without_print": len(manifest) - len(rows), "pendulum_restored": restore_pendulum_art()}


STRETCHED = (512, 1024)
PENDULUM_ART = (512, 653)


def restore_pendulum_art():
    """Master Duel stretches a pendulum card's full art (712:908) to 512×1024; put it back."""
    import os

    from PIL import Image

    from .models import MdArt

    restored = 0
    for art in MdArt.objects.filter(md_print__card__frame__endswith="_pendulum"):
        path = art.image.path
        if not os.path.exists(path):
            continue
        with Image.open(path) as img:
            if img.size != STRETCHED:
                continue
            fixed = img.convert("RGB").resize(PENDULUM_ART, Image.LANCZOS)
        tmp = f"{path}.{os.getpid()}.tmp"
        fixed.save(tmp, "WEBP", quality=90, method=6)
        os.replace(tmp, path)
        restored += 1
    return restored


def map_legacy_cards():
    from django.apps import apps

    from .models import LegacyCard

    Old = apps.get_model("card", "Card")
    ids = set(Card.objects.values_list("id", flat=True))
    manual = dict(LegacyCard.objects.filter(how=LegacyCard.How.MANUAL).values_list("old_id", "card_id"))

    def unique(field):
        seen = {}
        for cid, name in Card.objects.exclude(**{field: ""}).values_list("id", field):
            seen[name] = None if name in seen else cid
        return seen

    by_ko, by_en = unique("name_ko"), unique("name_en")
    rows, counts = [], {}
    for o in Old.objects.values("id", "card_id", "konami_id", "korean_name", "name"):
        how, target = LegacyCard.How.NONE, None
        konami = int(o["konami_id"]) if str(o["konami_id"] or "").isdigit() else 0
        if o["id"] in manual:
            how, target = LegacyCard.How.MANUAL, manual[o["id"]]
        elif konami in ids:
            how, target = LegacyCard.How.KONAMI, konami
        elif by_ko.get(o["korean_name"] or ""):
            how, target = LegacyCard.How.NAME_KO, by_ko[o["korean_name"]]
        elif by_en.get(o["name"] or ""):
            how, target = LegacyCard.How.NAME_EN, by_en[o["name"]]
        rows.append(LegacyCard(old_id=o["id"], old_card_id=o["card_id"] or "", card_id=target, how=how))
        counts[how] = counts.get(how, 0) + 1
    LegacyCard.objects.bulk_create(rows, update_conflicts=True, unique_fields=["old_id"], update_fields=["old_card_id", "card", "how"], batch_size=1000)
    return counts


NEW_CARD_LINKS = [
    ("avatar", "CardIcon"), ("multiplayer", "DuchMindWord"), ("tournament", "DeckSubmissionCard"),
    ("solo", "SoloDrawing"), ("solo", "SoloTwentyGame"), ("card", "CardDetection"),
]


def fill_new_card_links(only_missing=True):
    from django.apps import apps
    from django.db.models import OuterRef, Subquery

    from .models import LegacyCard

    target = Subquery(LegacyCard.objects.filter(old_id=OuterRef("card_id")).values("card_id")[:1])
    out = {}
    for app, model in NEW_CARD_LINKS:
        qs = apps.get_model(app, model).objects.exclude(card=None)
        if only_missing:
            qs = qs.filter(new_card=None)
        out[f"{app}.{model}"] = qs.update(new_card=target)
    return out
