"""Pure pairing engine for tournaments.

Every generator takes an explicit `random.Random` (see `make_rng`) so a stored
seed reproduces the exact draw; nothing here touches the database.
Pairs are (entrant_id, entrant_id | None) — None means a bye.
"""
import random

WIN_POINTS = 3
DRAW_POINTS = 1


def make_rng(seed: str) -> random.Random:
    return random.Random(seed)


def pair_adjacent(ordered_ids):
    """[a,b,c,d] -> [(a,b),(c,d)]; odd tail gets a bye."""
    pairs = []
    for i in range(0, len(ordered_ids) - 1, 2):
        pairs.append((ordered_ids[i], ordered_ids[i + 1]))
    if len(ordered_ids) % 2:
        pairs.append((ordered_ids[-1], None))
    return pairs


def round_robin_schedule(ids, rng):
    """Circle-method full schedule. Odd fields get a rotating bye (None)."""
    ids = list(ids)
    rng.shuffle(ids)
    if len(ids) % 2:
        ids.append(None)
    n = len(ids)
    rounds = []
    ring = ids[:]
    for _ in range(n - 1):
        rnd = []
        for i in range(n // 2):
            a, b = ring[i], ring[n - 1 - i]
            if a is None:
                a, b = b, None
            rnd.append((a, b))
        rounds.append(rnd)
        # rotate everyone but the first slot
        ring = [ring[0]] + [ring[-1]] + ring[1:-1]
    return rounds


def single_elim_round1(ids, rng):
    """Random draw into the next power-of-two bracket; byes fill the gap."""
    ids = list(ids)
    rng.shuffle(ids)
    size = 1
    while size < len(ids):
        size *= 2
    byes = size - len(ids)
    pairs = [(ids[i], None) for i in range(byes)]
    rest = ids[byes:]
    pairs.extend(pair_adjacent(rest) if rest else [])
    return pairs


def swiss_pairs(records, history, prior_byes, rng):
    """`records`: (entrant_id, points) for active entrants. Pairs within score
    groups, avoids rematches via backtracking, gives the bye to the
    lowest-scoring entrant who has not had one."""
    records = sorted(records, key=lambda r: -r[1])
    order = []
    i = 0
    while i < len(records):
        j = i
        while j < len(records) and records[j][1] == records[i][1]:
            j += 1
        group = [r[0] for r in records[i:j]]
        rng.shuffle(group)
        order.extend(group)
        i = j

    bye_id = None
    if len(order) % 2:
        # lowest score first; fall back to lowest overall if all had byes
        for cand, _ in sorted(records, key=lambda r: r[1]):
            if cand not in prior_byes:
                bye_id = cand
                break
        if bye_id is None:
            bye_id = min(records, key=lambda r: r[1])[0]
        order = [x for x in order if x != bye_id]

    def backtrack(remaining):
        if not remaining:
            return []
        first, rest = remaining[0], remaining[1:]
        for k, opp in enumerate(rest):
            if frozenset((first, opp)) in history:
                continue
            tail = backtrack(rest[:k] + rest[k + 1:])
            if tail is not None:
                return [(first, opp)] + tail
        return None

    pairs = backtrack(order)
    if pairs is None:  # rematch unavoidable — allow it rather than deadlock
        pairs = pair_adjacent(order)
        pairs = [(a, b) for a, b in pairs if b is not None]
    if bye_id is not None:
        pairs.append((bye_id, None))
    return pairs


def buchholz_scores(points, opponents):
    """Tiebreak: sum of each player's opponents' points."""
    return {pid: sum(points.get(o, 0) for o in opponents.get(pid, [])) for pid in points}
