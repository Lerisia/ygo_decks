"""Match statistics computed in a single pass over raw rows.

Replaces the per-deck/per-pair COUNT loops (1,000+ queries per sheet) with
two queries — one for match rows, one for the decks involved — and a Python
accumulation. Output shape and edge-case semantics (0 vs None) are identical
to the previous view implementation; see tests.FullStatisticsGoldenTest.
"""
from deck.models import Deck
from .serializers import DeckShortSerializer

ROW_FIELDS = ("deck_id", "opponent_deck_id", "opponent_deck_name",
              "result", "first_or_second", "coin_toss_result")


def _acc():
    return {
        "games": 0, "wins": 0,
        "first": 0, "first_wins": 0,
        "second": 0, "second_wins": 0,
        "coin_win": 0, "coin_win_wins": 0,
        "coin_lose": 0, "coin_lose_wins": 0,
    }


def _add(acc, row):
    win = 1 if row["result"] == "win" else 0
    acc["games"] += 1
    acc["wins"] += win
    if row["first_or_second"] == "first":
        acc["first"] += 1
        acc["first_wins"] += win
    elif row["first_or_second"] == "second":
        acc["second"] += 1
        acc["second_wins"] += win
    if row["coin_toss_result"] == "win":
        acc["coin_win"] += 1
        acc["coin_win_wins"] += win
    elif row["coin_toss_result"] == "lose":
        acc["coin_lose"] += 1
        acc["coin_lose_wins"] += win


def _rate(n, d):
    return n / d * 100 if d > 0 else 0


def _rate_or_none(n, d):
    return n / d * 100 if d > 0 else None


def _is_custom(row):
    return row["opponent_deck_id"] is None and bool(row["opponent_deck_name"])


def _is_unknown(row):
    # Bare 모름/기타: no FK and name never set. (Empty-string names fall in no
    # opponent bucket — preserved from the original implementation.)
    return row["opponent_deck_id"] is None and row["opponent_deck_name"] is None


def compute_full_statistics(matches):
    """`matches` is a MatchRecord queryset (already filtered for is_deleted / deck_id)."""
    rows = list(matches.order_by("id").values(*ROW_FIELDS))

    total = _acc()
    by_deck = {}          # deck_id -> acc (insertion order = first appearance)
    by_opp = {}           # opponent_deck_id (None = unknown) -> acc
    by_custom = {}        # custom opponent name -> acc
    by_pair = {}          # (deck_id, opponent_deck_id) -> acc

    for row in rows:
        _add(total, row)
        _add(by_deck.setdefault(row["deck_id"], _acc()), row)
        if _is_custom(row):
            _add(by_custom.setdefault(row["opponent_deck_name"], _acc()), row)
        elif row["opponent_deck_id"] is not None or _is_unknown(row):
            _add(by_opp.setdefault(row["opponent_deck_id"], _acc()), row)
        _add(by_pair.setdefault((row["deck_id"], row["opponent_deck_id"]), _acc()), row)

    deck_ids = set(by_deck) | {d for d in by_opp if d is not None}
    decks = Deck.objects.in_bulk(deck_ids) if deck_ids else {}
    serialized = {d.id: DeckShortSerializer(d).data for d in decks.values()}

    total_games = total["games"]

    basic = {
        "total_games": total_games,
        "overall_win_rate": _rate(total["wins"], total_games),
        "first_win_rate": _rate(total["first_wins"], total["first"]),
        "second_win_rate": _rate(total["second_wins"], total["second"]),
        "first_ratio": _rate(total["first"], total_games),
        "coin_toss_win_rate": _rate(total["coin_win"], total_games),
        "coin_toss_win_win_rate": _rate(total["coin_win_wins"], total["coin_win"]),
        "coin_toss_lose_win_rate": _rate(total["coin_lose_wins"], total["coin_lose"]),
    }

    my_deck_stats = [
        {
            "deck": serialized.get(deck_id),
            "count": a["games"],
            "ratio": _rate(a["games"], total_games),
            "total_games": a["games"],
            "win_rate": _rate(a["wins"], a["games"]),
            "first_win_rate": _rate(a["first_wins"], a["first"]),
            "second_win_rate": _rate(a["second_wins"], a["second"]),
            "coin_toss_win_win_rate": _rate(a["coin_win_wins"], a["coin_win"]),
            "coin_toss_lose_win_rate": _rate(a["coin_lose_wins"], a["coin_lose"]),
        }
        for deck_id, a in by_deck.items()
    ]

    opponent_deck_stats = [
        {
            "deck": serialized.get(opp_id) if opp_id is not None else None,
            "custom_name": None,
            "count": a["games"],
            "ratio": _rate(a["games"], total_games),
            "total_games": a["games"],
            "win_rate": _rate(a["wins"], a["games"]),
            "first_ratio": _rate(a["first"], a["games"]),
            "first_win_rate": _rate_or_none(a["first_wins"], a["first"]),
            "second_win_rate": _rate_or_none(a["second_wins"], a["second"]),
            "coin_toss_win_win_rate": _rate(a["coin_win_wins"], a["coin_win"]),
            "coin_toss_lose_win_rate": _rate(a["coin_lose_wins"], a["coin_lose"]),
        }
        for opp_id, a in by_opp.items()
    ] + [
        {
            "deck": None,
            "custom_name": name,
            "count": a["games"],
            "ratio": _rate(a["games"], total_games),
            "total_games": a["games"],
            "win_rate": _rate(a["wins"], a["games"]),
            "first_ratio": _rate(a["first"], a["games"]),
            "first_win_rate": _rate_or_none(a["first_wins"], a["first"]),
            "second_win_rate": _rate_or_none(a["second_wins"], a["second"]),
            "coin_toss_win_win_rate": 0,
            "coin_toss_lose_win_rate": 0,
        }
        for name, a in by_custom.items()
    ]

    deck_vs_deck_stats = [
        {
            "deck_id": d_id,
            "opponent_deck_id": o_id,
            "total_games": a["games"],
            "win_rate": _rate(a["wins"], a["games"]),
            "first_win_rate": _rate(a["first_wins"], a["first"]),
            "second_win_rate": _rate(a["second_wins"], a["second"]),
            "coin_toss_win_win_rate": _rate(a["coin_win_wins"], a["coin_win"]),
            "coin_toss_lose_win_rate": _rate(a["coin_lose_wins"], a["coin_lose"]),
        }
        for (d_id, o_id), a in by_pair.items()
    ]

    return {
        "basic": basic,
        "my_deck_stats": my_deck_stats,
        "opponent_deck_stats": opponent_deck_stats,
        "deck_vs_deck_stats": deck_vs_deck_stats,
    }
