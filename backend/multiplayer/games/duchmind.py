"""듀치마인드 — skribbl-style draw & guess game using YGO card names.

Game flow per turn:
  1. Pick a drawer (rotating through players each round)
  2. Drawer chooses 1 of 3 random words within `WORD_CHOICE_SECONDS`
  3. Drawing time `DRAW_SECONDS`. Other players guess in chat.
  4. Hint reveals letters at intervals.
  5. Round ends when time runs out OR all non-drawer players guessed.
  6. Reveal phase shows answer + scoring.
  7. Next drawer.
"""
import random
import re
import time


def _strip_specials(s: str) -> str:
    """Drop punctuation/symbols a player can't realistically type — keep
    Korean Hangul, Latin letters, digits and spaces only."""
    if not s:
        return ""
    return re.sub(r"[^가-힣a-zA-Z0-9 ]+", "", s).strip()


def _normalize_for_match(s: str) -> str:
    """Aggressive normalize for guess matching: strip ALL non-alphanumeric
    (including spaces) and lowercase."""
    return re.sub(r"[^가-힣a-zA-Z0-9]+", "", (s or "")).lower()

DRAW_SECONDS = 80
WORD_CHOICE_SECONDS = 15
INTER_TURN_PAUSE = 10  # reveal display + chat break before next turn
WORD_OPTIONS = 3
DEFAULT_TOTAL_ROUNDS = 5

# Scoring
GUESSER_BASE = 50
GUESSER_TIME_BONUS = 150  # max bonus when guessed at t=0
DRAWER_PER_GUESSER_RATIO = 0.5  # base: drawer gets half of each guesser's points
DRAWER_REFERENCE_GUESSERS = 3   # design baseline (= 4-player room: 1 drawer + 3 guessers)
                                # Per-correct bonus is scaled by REFERENCE/total_guessers
                                # so the drawer's MAX-possible bonus (= all guessers correct)
                                # stays the same regardless of room size, while still
                                # rewarding the actual correct-ratio of the turn.

# Hint reveal: how many letters max to reveal. Capped at 2 — even very long
# words shouldn't give away more than two letters.
# `count` here is the *maskable* character count (spaces and special chars
# excluded), so the threshold matches what guessers actually see as
# underscores.
def _hint_reveal_count(count: int) -> int:
    if count <= 3:
        return 0
    if count <= 9:
        return 1
    return 2


# Reveal times as fractions of DRAW_SECONDS.
HINT_REVEAL_TIMES = [0.5, 0.75]


def init_game_state(player_ids, total_rounds=DEFAULT_TOTAL_ROUNDS,
                    draw_seconds=DRAW_SECONDS, word_options=WORD_OPTIONS,
                    show_word_length=True, show_hints=True):
    pids = [str(pid) for pid in player_ids]
    random.shuffle(pids)
    return {
        "phase": "idle",
        "round": 0,
        "total_rounds": total_rounds,
        "draw_seconds": draw_seconds,
        "word_options": word_options,
        "show_word_length": show_word_length,
        "show_hints": show_hints,
        "turn_index": -1,  # will become 0 on first start_turn
        "drawer_order": pids,
        "scores": {pid: 0 for pid in pids},
        "round_data": None,
        "started_at": time.time(),
    }


def _draw_seconds(state):
    return int(state.get("draw_seconds") or DRAW_SECONDS)


def is_finished(state):
    return state.get("round", 0) > state.get("total_rounds", DEFAULT_TOTAL_ROUNDS)


def _next_drawer(state):
    """Advance to next turn. Returns (drawer_id, round_no) or None when game done.

    Rotation: keep the same shuffled order from init_game_state across all
    rounds — guarantees no player draws twice in a row at round boundaries.
    """
    order = state.get("drawer_order") or []
    if not order:
        return None
    idx = state.get("turn_index", -1) + 1
    if idx >= len(order):
        idx = 0
        state["round"] = state.get("round", 0) + 1
    elif state.get("round", 0) == 0:
        state["round"] = 1
    state["turn_index"] = idx
    return order[idx], state["round"]


def make_word_choices(used_card_ids: set, candidate_card_ids: list, count=WORD_OPTIONS):
    """Pick `count` random cards from candidates, avoiding ones already used this game.
    Returns list of card ids (length might be less if pool exhausted).
    """
    pool = [c for c in candidate_card_ids if c not in used_card_ids]
    if len(pool) < count:
        # fallback: allow repeats from full candidate list
        pool = candidate_card_ids
    if not pool:
        return []
    return random.sample(pool, min(count, len(pool)))


def start_choosing(state, drawer_id, word_options):
    """Enter the 'choosing' phase. word_options = list of {card_id, name}."""
    now = time.time()
    state["phase"] = "choosing"
    state["round_data"] = {
        "drawer_id": str(drawer_id),
        "started_at": now,
        "deadline": now + WORD_CHOICE_SECONDS,
        "word_choices": word_options,
        "word": None,
        "word_card_id": None,
        "hint_mask": None,
        "revealed_indices": [],
        "correct_guessers": {},
    }
    return {
        "drawer_id": str(drawer_id),
        "deadline": state["round_data"]["deadline"],
        "round": state.get("round", 1),
        "total_rounds": state.get("total_rounds"),
        "turn_index": state.get("turn_index", 0),
        # word_choices is sent ONLY to the drawer privately, not via this payload
    }


def _build_hint_mask(word: str) -> str:
    """Replace each visible character with '_', keep spaces and special chars."""
    out = []
    for ch in word:
        if ch.isspace():
            out.append(" ")
        elif ch in ("-", "·", "·", "/"):
            out.append(ch)
        else:
            out.append("_")
    return "".join(out)


def maskable_char_count(word: str) -> int:
    """Number of positions that will appear as `_` in the hint mask (i.e.,
    excludes whitespace and the kept-as-is special chars). Used for the
    "(N)" length hint shown to guessers — must match the visible underscore
    count, not the raw string length."""
    return sum(
        1 for ch in word
        if not ch.isspace() and ch not in ("-", "·", "·", "/")
    )


def _reveal_letter(hint: str, word: str, revealed: list[int]) -> tuple[str, int]:
    """Reveal one random un-revealed letter position. Returns (new_hint, idx).

    Prefers positions that are NOT adjacent to any already-revealed letter
    so two unmasked characters never sit next to each other (e.g. "마_사"
    is fine, but "마법_" gives away too much). Falls back to any candidate
    if every remaining slot is adjacent to a revealed letter.

    The very first maskable character is never revealed — giving away the
    front of the word makes too many cards trivially identifiable."""
    maskable = [i for i, ch in enumerate(word) if not ch.isspace() and ch not in ("-", "·", "/", "·")]
    first_maskable = maskable[0] if maskable else -1
    candidates = [i for i in maskable if i not in revealed and i != first_maskable]
    if not candidates:
        return hint, -1
    revealed_set = set(revealed)
    non_adjacent = [i for i in candidates if (i - 1) not in revealed_set and (i + 1) not in revealed_set]
    pool = non_adjacent or candidates
    idx = random.choice(pool)
    new_hint = hint[:idx] + word[idx] + hint[idx + 1:]
    return new_hint, idx


def confirm_word(state, drawer_id, word: str, card_id):
    """Drawer locks in their chosen word. Transitions to 'drawing' phase.
    The displayed word strips special chars (player can't realistically type them).
    """
    rd = state.get("round_data") or {}
    if rd.get("drawer_id") != str(drawer_id):
        return None
    now = time.time()
    state["phase"] = "drawing"
    clean = _strip_specials(word) or word  # fallback if everything got stripped
    rd["word"] = clean
    rd["display_word"] = word  # original card name for the reveal
    rd["word_card_id"] = str(card_id)
    rd["hint_mask"] = _build_hint_mask(clean)
    rd["started_at"] = now
    draw_secs = _draw_seconds(state)
    rd["deadline"] = now + draw_secs
    rd["correct_guessers"] = {}
    rd["revealed_indices"] = []
    rd["word_choices"] = None  # clear so it's not exposed
    state["round_data"] = rd
    show_len = state.get("show_word_length", True)
    return {
        "drawer_id": str(drawer_id),
        "deadline": rd["deadline"],
        "duration": draw_secs,
        # When show_word_length is OFF, guessers get no underscore mask and
        # no count — pure "draw it from scratch" hardcore mode.
        "hint": rd["hint_mask"] if show_len else "",
        "word_length": maskable_char_count(clean) if show_len else 0,
        "round": state.get("round", 1),
        "total_rounds": state.get("total_rounds"),
        "turn_index": state.get("turn_index", 0),
    }


def submit_guess(state, player_id, guess_text: str):
    """Returns dict describing what to broadcast.
    {
        "type": "correct" | "close" | "wrong",
        "delta": int,   # if correct
        "total_score": int,
        "total_correct": int,
    }
    """
    rd = state.get("round_data") or {}
    if state.get("phase") != "drawing" or not rd.get("word"):
        return {"type": "wrong"}
    pid = str(player_id)
    if pid == rd.get("drawer_id"):
        return {"type": "wrong", "reason": "drawer"}
    if pid in rd.get("correct_guessers", {}):
        return {"type": "wrong", "reason": "already_correct"}

    word = rd["word"]
    g = (guess_text or "").strip()
    if not g:
        return {"type": "wrong"}

    if _normalize_for_match(g) == _normalize_for_match(word):
        # Score: time-based
        now = time.time()
        deadline = rd["deadline"]
        remaining = max(0.0, deadline - now)
        time_factor = remaining / _draw_seconds(state)  # 0..1
        delta = int(GUESSER_BASE + GUESSER_TIME_BONUS * time_factor)
        rd.setdefault("correct_guessers", {})[pid] = {
            "score": delta,
            "order": len(rd["correct_guessers"]) + 1,
            "time": now,
        }
        state["scores"][pid] = state["scores"].get(pid, 0) + delta
        # Drawer bonus per correct guesser is scaled DOWN in larger rooms so
        # the max-possible bonus (every guesser correct) doesn't balloon past
        # the 4-player baseline. In small rooms (≤4 players) the base ratio
        # applies as-is — no inflation, since few guessers already cap the
        # drawer's possible reward naturally.
        drawer_pid = rd.get("drawer_id")
        if drawer_pid:
            order = state.get("drawer_order") or []
            total_guessers = max(1, len(order) - 1)  # exclude drawer
            scale = min(1.0, DRAWER_REFERENCE_GUESSERS / total_guessers)
            d_bonus = int(delta * DRAWER_PER_GUESSER_RATIO * scale)
            state["scores"][drawer_pid] = state["scores"].get(drawer_pid, 0) + d_bonus
            rd.setdefault("drawer_bonus", 0)
            rd["drawer_bonus"] += d_bonus
        return {
            "type": "correct",
            "delta": delta,
            "total_score": state["scores"][pid],
            "total_correct": len(rd["correct_guessers"]),
        }

    # "Close" detection on normalized strings.
    # Two ways a guess qualifies as "close":
    #   (a) Same length with ≤1 char different — typo case
    #   (b) Longest common *contiguous* substring of ≥ 3 chars — captures
    #       partial guesses (and intentionally aggressive: any 3 consecutive
    #       characters of the answer counts as a "close" hit so guessers
    #       know they're warm).
    g_norm = _normalize_for_match(g)
    w_norm = _normalize_for_match(word)
    if len(g_norm) == len(w_norm) and g_norm and w_norm:
        diffs = sum(1 for a, b in zip(g_norm, w_norm) if a != b)
        if diffs <= 1:
            return {"type": "close"}
    if g_norm and w_norm and _longest_common_substring_len(g_norm, w_norm) >= 3:
        return {"type": "close"}
    return {"type": "wrong"}


def classify_guess(state, guess_text: str) -> str:
    """Pure classification — returns 'correct' | 'close' | 'wrong' without
    mutating state. Used for spectator answer-checking where we don't want
    to award points or affect early-end detection."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "drawing":
        return "wrong"
    word = rd.get("word") or ""
    if not word:
        return "wrong"
    g = (guess_text or "").strip()
    if not g:
        return "wrong"
    if _normalize_for_match(g) == _normalize_for_match(word):
        return "correct"
    g_norm = _normalize_for_match(g)
    w_norm = _normalize_for_match(word)
    if len(g_norm) == len(w_norm) and g_norm and w_norm:
        if sum(1 for a, b in zip(g_norm, w_norm) if a != b) <= 1:
            return "close"
    if g_norm and w_norm and _longest_common_substring_len(g_norm, w_norm) >= 3:
        return "close"
    return "wrong"


def _longest_common_substring_len(a: str, b: str) -> int:
    """Length of the longest common contiguous substring between a and b."""
    if not a or not b:
        return 0
    m, n = len(a), len(b)
    best = 0
    prev = [0] * (n + 1)
    for i in range(1, m + 1):
        cur = [0] * (n + 1)
        ai = a[i - 1]
        for j in range(1, n + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


def all_guessed(state, total_player_count: int) -> bool:
    rd = state.get("round_data") or {}
    if state.get("phase") != "drawing":
        return False
    # All non-drawer players have either guessed correctly or given up.
    resolved = len(rd.get("correct_guessers", {})) + len(rd.get("given_up", []))
    return resolved >= max(0, total_player_count - 1)


def mark_given_up(state, player_id) -> bool:
    """Flag a non-drawer player as having given up this turn. Returns True
    on a state change so the consumer knows whether to broadcast."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "drawing":
        return False
    pid = str(player_id)
    if pid == rd.get("drawer_id"):
        return False
    if pid in rd.get("correct_guessers", {}):
        return False  # already correct, can't give up
    given = rd.setdefault("given_up", [])
    if pid in given:
        return False
    given.append(pid)
    return True


def maybe_reveal_hint(state):
    """Called periodically by runner. If hint should advance, do it.
    Returns the new hint string if revealed, else None.
    """
    # Settings gates: skip entirely when the room has hints/length disabled.
    if not state.get("show_word_length", True) or not state.get("show_hints", True):
        return None
    rd = state.get("round_data") or {}
    if state.get("phase") != "drawing":
        return None
    word = rd.get("word")
    if not word:
        return None
    max_reveals = _hint_reveal_count(maskable_char_count(word))
    if max_reveals <= 0:
        return None
    revealed = rd.get("revealed_indices") or []
    if len(revealed) >= max_reveals:
        return None
    elapsed_frac = (time.time() - rd["started_at"]) / _draw_seconds(state)
    # How many hints should have been revealed by now per the schedule?
    schedule = HINT_REVEAL_TIMES[:max_reveals]
    needed_reveals = sum(1 for t in schedule if elapsed_frac >= t)
    if needed_reveals > len(revealed):
        new_hint, idx = _reveal_letter(rd["hint_mask"], word, revealed)
        if idx >= 0:
            revealed.append(idx)
            rd["hint_mask"] = new_hint
            rd["revealed_indices"] = revealed
            return new_hint
    return None


def end_turn(state):
    """End the current drawing turn. Returns reveal payload."""
    rd = state.get("round_data") or {}
    state["phase"] = "reveal"
    if not rd:
        return None
    return {
        "word": rd.get("display_word") or rd.get("word"),
        "card_id": rd.get("word_card_id"),
        "drawer_id": rd.get("drawer_id"),
        "scores": dict(state["scores"]),
        "round": state.get("round", 1),
        "total_rounds": state.get("total_rounds"),
        "turn_index": state.get("turn_index", 0),
        "correct_guessers": rd.get("correct_guessers", {}),
        "drawer_bonus": rd.get("drawer_bonus", 0),
    }


def is_round_complete(state):
    """Whether the current rotation (round) has just been completed."""
    order = state.get("drawer_order") or []
    return state.get("turn_index", 0) >= len(order) - 1


def is_game_over(state):
    """Whether all rounds are done (called after a turn ends)."""
    return state.get("round", 0) >= state.get("total_rounds", DEFAULT_TOTAL_ROUNDS) and is_round_complete(state)
