"""카드군 (card groups) by the rule, checked against Master Duel.

A group is a 「text」 the Japanese effect texts use as a group (「X」モンスター, 「X」カード …). A card is a member when
its written Japanese name holds the text and reads it the group's way there (EM read エンタメイト, not EMPRESS),
when the text sits in the reading of a ruby part of its name (銀河眼 read ギャラクシーアイズ), or when its own text
treats it as one. "このカード名はルール上「X」として扱う" replaces the name the rule looks at.
"""
import re
import unicodedata
from collections import Counter, defaultdict

from django.db import transaction

N = lambda s: unicodedata.normalize("NFKC", s or "")  # noqa: E731
RUBY = re.compile(r"\$R(.+?)\((.+?)\)")
KIND = r"(?:カード|モンスター|魔法|罠|通常|速攻|永続|装備|フィールド|カウンター|儀式|融合|シンクロ|エクシーズ|X|リンク|L|P|S|ペンデュラム|チューナー|トークン|効果|と名のついた)"
CHAIN = re.compile(r"((?:「[^」]{1,30}」(?:又は|及び|、|・|と|や|か|もしくは))*「[^」]{1,30}」)(?=" + KIND + ")")
TREATED = re.compile(r"ルール上([^。]*?)扱う")
QUOTE_JA = re.compile(r"「([^」]{1,40})」")
QUOTE_KO = re.compile(r"[\"“]([^\"”]{1,60})[\"”]")
LATIN = re.compile(r"[A-Za-z]")


def segments(name, ruby=""):
    """[(written, reading)] of a name; plain characters read as themselves."""
    src = N(ruby) if ruby and "$R" in ruby else N(name)
    out, pos = [], 0
    for m in RUBY.finditer(src):
        out += [(ch, ch) for ch in src[pos:m.start()]]
        out.append((m.group(1), m.group(2)))
        pos = m.end()
    return out + [(ch, ch) for ch in src[pos:]]


def written(seg):
    return "".join(w for w, _ in seg)


def holds(name, x):
    """Does name hold x, not counting a Latin x glued to other Latin letters (C in R－ACE, N in No.)?"""
    i = name.find(x)
    while i >= 0:
        j = i + len(x)
        if not ((LATIN.match(x[0]) and i > 0 and LATIN.match(name[i - 1])) or
                (LATIN.match(x[-1]) and j < len(name) and LATIN.match(name[j]))):
            return True
        i = name.find(x, i + 1)
    return False


def readings_at(seg, x):
    """Reading of every place the written name holds x, and whether x lines up with whole ruby parts there."""
    starts, p = [], 0
    for w, _ in seg:
        starts.append(p)
        p += len(w)
    name, out = written(seg), []
    i = name.find(x)
    while i >= 0:
        j = i + len(x)
        latin_glued = (LATIN.match(x[0]) and i > 0 and LATIN.match(name[i - 1])) or \
                      (LATIN.match(x[-1]) and j < len(name) and LATIN.match(name[j]))
        if not latin_glued:
            span = [k for k, s in enumerate(starts) if s < j and s + len(seg[k][0]) > i]
            clean = starts[span[0]] == i and starts[span[-1]] + len(seg[span[-1]][0]) == j
            out.append(("".join(seg[k][1] for k in span), clean))
        i = name.find(x, i + 1)
    return out


def treated(text):
    """(groups the card also counts as, names it also bears, the name that replaces its own or None)."""
    also_groups, also_names, renamed = set(), set(), None
    for m in TREATED.finditer(N(text)):
        body = m.group(1)
        xs = re.findall(r"「([^」]*)」", body)
        tail = body.split("」")[-1]
        if not xs:
            continue
        if "カード" in tail:
            also_groups.update(xs)
        elif "も" in tail:
            also_names.update(xs)
        else:
            renamed = xs[0]
    return also_groups, also_names, renamed


def group_texts(texts):
    """How often each 「X」 is used as a group across the given Japanese texts."""
    used = Counter()
    for t in texts:
        t = N(t)
        for m in CHAIN.finditer(t):
            used.update(re.findall(r"「([^」]+)」", m.group(1)))
        used.update(treated(t)[0])
    return used


class Index:
    def __init__(self, names, rubies, ja_texts):
        """names {id: Japanese name}, rubies {id: $R ruby}, ja_texts {id: text}."""
        self.seg = {cid: segments(name, rubies.get(cid, "")) for cid, name in names.items()}
        self.also_groups, self.also_names = {}, {}
        by_name = {}
        for cid, seg in self.seg.items():
            by_name.setdefault(written(seg), cid)
        for cid, text in ja_texts.items():
            groups, also, renamed = treated(text)
            if groups:
                self.also_groups[cid] = groups
            if also:
                self.also_names[cid] = also
            if renamed and cid in self.seg:
                src = by_name.get(N(renamed))
                self.seg[cid] = self.seg[src] if src is not None else [(ch, ch) for ch in N(renamed)]
        self.written = {cid: written(seg) for cid, seg in self.seg.items()}

    def members(self, x):
        """(reading, {card id: how}) of group x."""
        hits = {}
        for cid, name in self.written.items():
            if x in name:
                r = readings_at(self.seg[cid], x)
                if r:
                    hits[cid] = r
        votes = Counter(rd for r in hits.values() for rd, clean in r if clean)
        reading = votes.most_common(1)[0][0] if votes else x
        out = {cid: "name" for cid, r in hits.items() if any(rd == reading or (not clean and reading in rd) for rd, clean in r)}
        for cid, seg in self.seg.items():
            if cid not in hits and any(x in rd for w, rd in seg if w != rd):
                out[cid] = "reading"
        for src in (self.also_groups, self.also_names):
            for cid, ys in src.items():
                if any(holds(N(y), x) for y in ys):
                    out.setdefault(cid, "treated")
        return reading, out


def _clean_ko(k):
    """Korean texts mark readings like PSY(싸이)프레임 — card names don't."""
    return re.sub(r"(?<=[A-Za-z0-9.])\(([가-힣 ]+)\)", "", k).strip()


def _coverage(ko, names):
    k = N(ko).replace(" ", "")
    return sum(1 for n in names if k in N(n).replace(" ", "")) / len(names) if names else 0.0


def _common_part(names):
    names = sorted({n.replace(" ", "") for n in names}, key=len)
    best = ""
    for i in range(len(names[0])):
        for j in range(len(names[0]), i + len(best), -1):
            if all(names[0][i:j] in n for n in names[1:]):
                best = names[0][i:j]
                break
    return best


def korean_names(groups, ja_texts, ko_texts, ko_names):
    """{x: (name, source, agreement, coverage)} from the cards' paired Japanese/Korean quotes."""
    pairs, loose = defaultdict(Counter), Counter()
    for cid, ja in ja_texts.items():
        ko = ko_texts.get(cid)
        if not ko:
            continue
        kq = [_clean_ko(k) for k in QUOTE_KO.findall(ko)]
        loose.update(kq)
        jq = QUOTE_JA.findall(N(ja))
        if jq and len(jq) == len(kq):
            for a, b in zip(jq, kq):
                pairs[a][b] += 1
    out = {}
    for x, mem in groups.items():
        names = [ko_names[c] for c in mem if ko_names.get(c)]
        if pairs.get(x):
            c = pairs[x]
            name, n = max(c.items(), key=lambda kv: kv[1] * (0.2 + _coverage(kv[0], names)))
            out[x] = (name, "pair", n / sum(c.values()), _coverage(name, names))
            continue
        cands = [k for k in loose if len(k) >= 2 and _coverage(k, names) >= 0.5]
        if cands:
            name = max(cands, key=lambda k: (_coverage(k, names), loose[k], len(k)))
            out[x] = (name, "quote", 0.0, _coverage(name, names))
        elif len(names) >= 2 and len(_common_part(names)) >= 2:
            name = _common_part(names)
            out[x] = (name, "common", 0.0, _coverage(name, names))
        else:
            out[x] = ("", "none", 0.0, 0.0)
    return out


def parents(groups):
    """{child: parent}: the nearest group whose text sits in the child's and whose members include all of it."""
    out = {}
    for y, ym in groups.items():
        ups = [x for x, xm in groups.items() if x != y and x in y and ym <= xm and len(xm) > len(ym)]
        if ups:
            out[y] = max(ups, key=len)
    return out


def _twin_key(x):
    return re.sub(r"[・\s]", "", x)


def compute(md_named=None):
    """Every group with its members, Korean name and parent, from the card DB."""
    from .models import Card, CardText, MdPrint, SrcMd

    names = dict(Card.objects.values_list("id", "name_ja"))
    ko_names = dict(Card.objects.exclude(name_ko="").values_list("id", "name_ko"))
    rubies = {cid: r for cid, r in SrcMd.objects.filter(lang="ja").values_list("md_id", "ruby") if cid in names and r}
    md = set(MdPrint.objects.values_list("card_id", flat=True))
    texts = defaultdict(dict)
    for cid, lang, m, e, p in CardText.objects.filter(lang__in=["ja", "ko"]).values_list(
            "card_id", "lang", "materials", "effect", "pendulum_effect"):
        texts[lang][cid] = "\n".join(s for s in (m, e, p) if s)
    index = Index(names, rubies, texts["ja"])
    groups = {}
    for x in group_texts(texts["ja"].values()):
        reading, mem = index.members(x)
        if mem:
            groups[x] = (reading, mem)
    sets = {x: set(m) for x, (_, m) in groups.items()}
    md_texts = {cid: t for cid, t in texts["ja"].items() if cid in md}
    ko = korean_names({x: {c for c in m if c in md} for x, m in sets.items()}, md_texts,
                      {cid: t for cid, t in texts["ko"].items() if cid in md}, ko_names)
    md_lists = {frozenset(ids) & frozenset(md) for ids in (md_named or [])}
    twins = Counter(_twin_key(x) for x in groups)
    result = {}
    for x, (reading, mem) in groups.items():
        name, source, agreement, coverage = ko[x]
        result[x] = {
            "reading": reading, "members": mem, "name_ko": name, "name_source": source,
            "name_agreement": round(agreement, 3), "name_coverage": round(coverage, 3),
            "md_list": frozenset(c for c in mem if c in md) in md_lists,
            "needs_review": (not name or source != "pair" or agreement < 0.7 or coverage < 0.5 or twins[_twin_key(x)] > 1),
        }
    for child, parent in parents(sets).items():
        result[child]["parent"] = parent
    return result


@transaction.atomic
def save(result):
    """Write computed groups; staff names and member additions/removals survive."""
    from .models import CardGroup, CardGroupMember

    existing = {g.text: g for g in CardGroup.objects.all()}
    manual_groups = set(CardGroupMember.objects.filter(how__in=CardGroupMember.MANUAL).values_list("group__text", flat=True))
    for x, r in result.items():
        g = existing.get(x) or CardGroup(text=x)
        g.reading = r["reading"]
        g.md_list = r["md_list"]
        if g.name_source != CardGroup.NameSource.MANUAL:
            g.name_ko, g.name_source = r["name_ko"], r["name_source"]
            g.name_agreement, g.name_coverage = r["name_agreement"], r["name_coverage"]
            g.needs_review = r["needs_review"]
        g.save()
        existing[x] = g
    dropped = [g.id for x, g in existing.items()
               if x not in result and g.name_source != CardGroup.NameSource.MANUAL and x not in manual_groups]
    CardGroup.objects.filter(id__in=dropped).delete()
    for x, g in existing.items():
        if g.id in dropped:
            continue
        parent = existing.get(result.get(x, {}).get("parent"))
        if g.parent_id != (parent.id if parent else None) and x in result:
            CardGroup.objects.filter(id=g.id).update(parent=parent)
    CardGroupMember.objects.exclude(how__in=CardGroupMember.MANUAL).delete()
    manual = set(CardGroupMember.objects.values_list("group_id", "card_id"))
    rows = [CardGroupMember(group=existing[x], card_id=cid, how=how)
            for x, r in result.items() for cid, how in r["members"].items() if (existing[x].id, cid) not in manual]
    CardGroupMember.objects.bulk_create(rows, batch_size=2000)
    return {"groups": len(result), "members": len(rows), "dropped": len(dropped),
            "needs_review": CardGroup.objects.filter(needs_review=True).count(),
            "md_lists_reproduced": sum(1 for r in result.values() if r["md_list"])}
