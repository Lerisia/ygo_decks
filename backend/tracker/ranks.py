"""The ranked ladder's win gauge, per rank (mirrors the tracker's RankRules and the frontend's rankUtils)."""
import re


def valid_wins(rank):
    """Gauge values a record at this rank can hold; empty when the rank has no gauge or is not a rank."""
    m = re.match(r"^([a-z]+)([1-5])$", rank or "")
    if not m:
        return []
    tier, bottom = m.group(1), m.group(2) == "5"
    if tier in ("rookie", "bronze"):
        return [0]
    if tier == "silver":
        return [0, 1]
    if tier == "gold":
        return [0, 1, 2, 3]
    if tier == "platinum":
        return [0, 1, 2, 3] if bottom else [-3, -2, -1, 0, 1, 2, 3]
    if tier == "diamond":
        return [0, 1, 2, 3] if bottom else [-2, -1, 0, 1, 2, 3]
    if tier == "master":
        return [] if rank == "master1" else [0, 1, 2, 3, 4] if bottom else [-2, -1, 0, 1, 2, 3, 4]
    return []


def clamp_wins(rank, wins):
    """What a tracker client reported, pulled into the rank's gauge (0.6.7 sent the win streak, 0.6.8-0.6.9 sent 1
    at rookie). Without a rank there is nothing to check against."""
    try:
        wins = None if wins is None else int(wins)
    except (TypeError, ValueError):
        return None
    if not rank:
        return wins
    valid = valid_wins(rank)
    if not valid or wins is None:
        return None
    return min(max(wins, valid[0]), valid[-1])
