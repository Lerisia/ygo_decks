"""Master Duel's pack odds as a draw, on the server (엘리스 2026-10-13: packs cost gems and the cards go to the account,
so the server draws them). The rules are the game's own 제공 확률 text: eight cards a pack, the eighth R or higher; in
ten bought at once the tenth pack's eighth card is SR or higher, and ten without a UR make the next ten of that pack
give one there. A secret pack's first four come from the master pack, the rest from its pickup cards. The rates are
the ones the game shows (엘리스 confirmed them). Each card's finish is drawn apart; royal comes to SR and UR only."""

ORDER = ("UR", "SR", "R", "N")
SLOT = {"UR": 0.025, "SR": 0.075, "R": 0.35, "N": 0.55}     # cards 1–7
EIGHTH = {"UR": 0.025, "SR": 0.075, "R": 0.9}                 # card 8: R or higher
TENTH = {"UR": 0.2, "SR": 0.8}                                # card 8 of the tenth of ten: SR or higher
OWED = {"UR": 1.0}                                            # after ten without a UR
FINISH = {"high": {"royal": 0.01, "shine": 0.09}, "low": {"royal": 0.0, "shine": 0.1}}
PACK_SIZE = 8
GEMS_PER_PACK = 100


def rarity_of(odds, pool, x):
    """A rarity by the slot's odds, over the rarities the pool holds (a pack without N spreads N's share)."""
    have = [r for r in ORDER if odds.get(r) and pool.get(r)]
    shown = have or [r for r in ORDER if pool.get(r)]
    total = sum(odds.get(r, 1) for r in shown)
    at = 0.0
    for r in shown:
        at += odds.get(r, 1) / total
        if x < at:
            return r
    return shown[-1]


def finish_of(rarity, x):
    f = FINISH["high" if rarity in ("SR", "UR") else "low"]
    if x < f["royal"]:
        return "royal"
    return "shine" if x < f["royal"] + f["shine"] else "basic"


def pull(pool, odds, rng):
    rarity = rarity_of(odds, pool, rng())
    finish = finish_of(rarity, rng())
    cards = pool[rarity]
    return {"card": cards[min(len(cards) - 1, int(rng() * len(cards)))], "rarity": rarity, "finish": finish}


def draw_pack(pools, rng, last=EIGHTH):
    """One pack; `last` sets the eighth card's odds (the tenth of ten, or the one owed a UR). pools: {"main": {rarity:
    [card]}, "master": the master pack's, for a secret pack's first four, or None}."""
    out = []
    for i in range(PACK_SIZE):
        pool = pools["master"] if pools.get("master") and i < 4 else pools["main"]
        out.append(pull(pool, last if i == PACK_SIZE - 1 else SLOT, rng))
    return out


def draw_ten(pools, owed, rng):
    """Ten bought at once, and whether the next ten of this pack are owed a UR."""
    packs = [draw_pack(pools, rng, EIGHTH if i < 9 else OWED if owed else TENTH) for i in range(10)]
    return packs, not any(c["rarity"] == "UR" for p in packs for c in p)
