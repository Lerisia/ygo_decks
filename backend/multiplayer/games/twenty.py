"""딱무고개 (Twenty Questions) — card edition.

Round flow per drawer:
  1. Drawer picks a card via search (`choosing` phase, no time pressure here —
     keep it short with WORD_CHOICE_SECONDS so they don't stall).
  2. Q&A loop: guessers take turns asking; drawer answers via three buttons
     (예/아니오/모르겠거나애매함). Each question uses 1 of TOTAL_QUESTIONS.
  3. Anyone can spend a question to attempt a card guess (not just turn
     holder). Correct guess ends the round in guessers' favor.
  4. Round ends when correct guess OR question budget exhausted.

Scoring per round:
  guesser pool = (TOTAL_QUESTIONS - used) * GUESSER_RATE, split equally
  drawer       = used * DRAWER_RATE
  on miss      = drawer gets TOTAL_QUESTIONS * DRAWER_RATE, guessers 0
"""
import random
import time


TOTAL_QUESTIONS = 20  # legacy fallback only — actual round budget comes
                       # from `_total_questions_for(guesser_count)` so each
                       # player gets a fair share regardless of room size.


def _total_questions_for(guesser_count: int) -> int:
    """Per-guesser ask budget × guesser count. Tuned so total ≈ 20 and each
    player gets enough turns:
      2→10 each, 3→7 each, 4→5 each, 5→4 each. >5 falls back to 4 each."""
    per = {2: 10, 3: 7, 4: 5, 5: 4}.get(guesser_count, 4)
    return per * max(1, guesser_count)
# Tuned to the "thoughtful guessing" board-game baseline (Codenames /
# Just One / Wits & Wagers — 30–120s for thinking, 30s+ for click actions).
# Yu-Gi-Oh cards have lots of distinguishing features so each question can
# require real thought, hence the longer windows than DuchMind/Quiz.
ASK_SECONDS = 60           # asker drafts a question or skips to guess
ANSWER_SECONDS = 30        # drawer picks 예/아니오/모르겠음 (sometimes tricky)
GUESS_WINDOW_SECONDS = 30  # competitive: post-answer guess window — long
                            # enough to search and click a card
HAND_RAISE_SECONDS = 10    # competitive: time for guessers to claim the next
                            # post-answer guess slot. Looped: after each
                            # raiser's attempt, opens again until someone
                            # wins / nobody raises / nobody eligible.
WORD_CHOICE_SECONDS = 60   # drawer searches the whole DB (just picking, not drawing)
INTER_TURN_PAUSE = 10
DEFAULT_TOTAL_ROUNDS = 4   # one round per player
DEFAULT_GUESS_ATTEMPTS = 3 # per-player per-round; 0 = unlimited

# Scoring — competitive mode (default)
COMP_WINNER_BONUS = 200    # only the correct guesser gets this
COMP_DRAWER_RATE = 15      # drawer score = used * COMP_DRAWER_RATE if guessed,
                            # else 0 — incentivizes "challenging but eventually
                            # solvable" cards (no obscurity griefing).
# Scoring — cooperative mode (legacy / future)
COOP_GUESSER_FLAT = 100    # every guesser gets this when anyone wins
COOP_DRAWER_RATE = 15

# Answer enum (string for msgpack/json safety)
ANSWER_YES = "yes"
ANSWER_NO = "no"
ANSWER_UNSURE = "unsure"
VALID_ANSWERS = {ANSWER_YES, ANSWER_NO, ANSWER_UNSURE}


def init_game_state(player_ids, total_rounds=DEFAULT_TOTAL_ROUNDS, mode="competitive",
                    guess_attempts_max=DEFAULT_GUESS_ATTEMPTS):
    pids = [str(pid) for pid in player_ids]
    random.shuffle(pids)
    return {
        # idle | choosing | asking | answering | guess_window |
        # hand_raise | hand_guess | reveal | finished
        "phase": "idle",
        "mode": mode,            # competitive | cooperative
        # 0 = unlimited; otherwise per-player per-round attempt cap
        "guess_attempts_max": int(guess_attempts_max or 0),
        "round": 0,
        "total_rounds": total_rounds,
        "turn_index": -1,        # rotates drawer
        "drawer_order": pids,
        "scores": {pid: 0 for pid in pids},
        "round_data": None,
        "started_at": time.time(),
    }


def is_round_complete(state):
    order = state.get("drawer_order") or []
    if not order:
        return True
    return state.get("turn_index", -1) >= len(order) - 1


def is_game_over(state):
    return state.get("round", 0) >= state.get("total_rounds", DEFAULT_TOTAL_ROUNDS) and is_round_complete(state)


def _next_drawer(state):
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


def start_choosing(state, drawer_id):
    """Drawer picks a card. Build the guesser rotation so questioning starts
    from the player AFTER the drawer (then wraps around). Otherwise the
    first slot in the global shuffled order would always ask first, putting
    them at a perpetual info-disadvantage in competitive mode."""
    now = time.time()
    drawer_str = str(drawer_id)
    order = state.get("drawer_order") or []
    try:
        di = order.index(drawer_str)
    except ValueError:
        di = -1
    if di >= 0:
        # `order[di+1:] + order[:di]` excludes the drawer slot and rotates so
        # the player just after the drawer asks first.
        guesser_order = order[di + 1:] + order[:di]
    else:
        guesser_order = [pid for pid in order if pid != drawer_str]
    state["phase"] = "choosing"
    total_questions = _total_questions_for(len(guesser_order))
    state["round_data"] = {
        "drawer_id": drawer_str,
        "started_at": now,
        "deadline": now + WORD_CHOICE_SECONDS,
        "card_id": None,
        "card_name": None,
        "qa_log": [],            # list of {asker_id, asker_name, text, answer}
        "questions_used": 0,
        "total_questions": total_questions,
        "guesser_order": guesser_order,
        "asker_index": 0,         # rotates among guessers
        "current_question": None, # {asker_id, asker_name, text, deadline} while drawer answers
        "winner_id": None,
        # Per-player guess-attempt counter for THIS round (resets each round
        # via this re-init). Compared against state["guess_attempts_max"];
        # 0 max = unlimited.
        "attempts_used": {pid: 0 for pid in guesser_order},
        # Per-question lockout: who already had a guess opportunity in the
        # current question (asker after their guess_window, or hand-raisers).
        # They cannot raise hand again until the next question.
        "excluded_this_question": [],
        # Hand-raise loop bookkeeping
        "hand_raised_by": None,
        "hand_raise_deadline": None,
        "hand_guess_deadline": None,
    }
    return {
        "drawer_id": str(drawer_id),
        "deadline": state["round_data"]["deadline"],
        "round": state.get("round", 1),
        "total_rounds": state.get("total_rounds"),
        "turn_index": state.get("turn_index", 0),
        "total_questions": total_questions,
    }


def confirm_card(state, drawer_id, card_id, card_name):
    """Drawer picks a card. Move to asking phase, set first asker."""
    rd = state.get("round_data") or {}
    if rd.get("drawer_id") != str(drawer_id):
        return None
    now = time.time()
    state["phase"] = "asking"
    rd["card_id"] = int(card_id)
    rd["card_name"] = card_name
    rd["ask_deadline"] = now + ASK_SECONDS
    rd["started_at"] = now
    return _current_asker_payload(state)


def _current_asker_payload(state):
    rd = state.get("round_data") or {}
    order = rd.get("guesser_order") or []
    if not order:
        return None
    asker_id = order[rd.get("asker_index", 0) % len(order)]
    total = rd.get("total_questions", TOTAL_QUESTIONS)
    return {
        "asker_id": asker_id,
        "questions_remaining": total - rd.get("questions_used", 0),
        "total_questions": total,
        "ask_deadline": rd.get("ask_deadline"),
    }


def submit_question(state, asker_id, text: str):
    """Current asker submits a question. Drawer must answer next."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "asking":
        return {"error": "wrong_phase"}
    order = rd.get("guesser_order") or []
    if not order:
        return {"error": "no_guessers"}
    expected = order[rd.get("asker_index", 0) % len(order)]
    if str(asker_id) != expected:
        return {"error": "not_your_turn"}
    if rd.get("questions_used", 0) >= rd.get("total_questions", TOTAL_QUESTIONS):
        return {"error": "out_of_questions"}
    text = (text or "").strip()
    if not text:
        return {"error": "empty"}
    if len(text) > 200:
        text = text[:200]
    now = time.time()
    state["phase"] = "answering"
    rd["current_question"] = {
        "asker_id": str(asker_id),
        "text": text,
        "answer_deadline": now + ANSWER_SECONDS,
    }
    return {"ok": True, "text": text}


def submit_answer(state, drawer_id, answer):
    """Drawer responds to the current question. Advances to the next asker.

    Hand-raise / asker-priority guess windows were removed in favor of a
    DuchMind-style "anyone can guess at any time" model — see `submit_guess`.
    """
    rd = state.get("round_data") or {}
    if state.get("phase") != "answering":
        return {"error": "wrong_phase"}
    if rd.get("drawer_id") != str(drawer_id):
        return {"error": "not_drawer"}
    cq = rd.get("current_question")
    if not cq:
        return {"error": "no_question"}
    if answer not in VALID_ANSWERS:
        return {"error": "bad_answer"}
    rd.setdefault("qa_log", []).append({
        "asker_id": cq["asker_id"],
        "text": cq["text"],
        "answer": answer,
        "ts": time.time(),
    })
    rd["questions_used"] = rd.get("questions_used", 0) + 1
    rd["current_question"] = None
    if rd["questions_used"] >= rd.get("total_questions", TOTAL_QUESTIONS):
        state["phase"] = "reveal"
        return {"ok": True, "round_over": True, "winner_id": None}
    rd["asker_index"] = rd.get("asker_index", 0) + 1
    state["phase"] = "asking"
    rd["ask_deadline"] = time.time() + ASK_SECONDS
    return {"ok": True, "round_over": False, "next_asker": _current_asker_payload(state)}


def _attempts_remaining(state, rd, pid: str) -> int:
    """Per-player attempt budget remaining this round. 0 max = unlimited."""
    cap = int(state.get("guess_attempts_max") or 0)
    used = (rd.get("attempts_used") or {}).get(str(pid), 0)
    if cap == 0:
        return 999  # effectively unlimited
    return max(0, cap - used)


def _eligible_raisers(state, rd) -> list:
    """Guessers who can still raise hand THIS question: not drawer, not
    already excluded by a prior attempt this question, and not at cap."""
    guessers = rd.get("guesser_order") or []
    excluded = set(str(p) for p in (rd.get("excluded_this_question") or []))
    out = []
    for pid in guessers:
        if pid in excluded:
            continue
        if _attempts_remaining(state, rd, pid) <= 0:
            continue
        out.append(pid)
    return out


def _start_hand_raise(state, rd):
    """Open a 10s hand-raise window. Phase transitions to 'hand_raise'.
    Caller must have already added the prior guesser (asker / raiser) to
    excluded_this_question."""
    state["phase"] = "hand_raise"
    rd["hand_raised_by"] = None
    rd["hand_raise_deadline"] = time.time() + HAND_RAISE_SECONDS
    rd["hand_guess_deadline"] = None


def _advance_to_next_asker(state, rd):
    """Common transition: clear per-question state, bump asker_index, return
    to 'asking' phase with a fresh ask deadline."""
    rd["excluded_this_question"] = []
    rd["hand_raised_by"] = None
    rd["hand_raise_deadline"] = None
    rd["hand_guess_deadline"] = None
    rd["asker_index"] = rd.get("asker_index", 0) + 1
    state["phase"] = "asking"
    rd["ask_deadline"] = time.time() + ASK_SECONDS


def _open_hand_raise_or_advance(state, rd):
    """If anyone is still eligible to raise, open another hand-raise window.
    Otherwise advance to the next asker. Used when an asker passes/wrong-
    guesses, when a hand-raiser passes/wrong-guesses, or when a hand_raise
    window times out (handled separately so the timeout case can broadcast
    differently). Returns dict describing the transition."""
    if _eligible_raisers(state, rd):
        _start_hand_raise(state, rd)
        return {"hand_raise": {
            "deadline": rd["hand_raise_deadline"],
            "seconds_remaining": HAND_RAISE_SECONDS,
        }}
    _advance_to_next_asker(state, rd)
    return {"next_asker": _current_asker_payload(state)}


def pass_guess_window(state, asker_id):
    """Asker chose to skip the post-answer guess window. Advance directly
    to the next asker. (Hand-raise mechanic was removed in favor of free
    DuchMind-style chat-driven guesses; see `submit_guess` for the always-
    available guess path.)"""
    rd = state.get("round_data") or {}
    if state.get("phase") != "guess_window":
        return {"error": "wrong_phase"}
    cq_asker = (rd.get("qa_log") or [])[-1].get("asker_id") if rd.get("qa_log") else None
    if cq_asker is None or str(asker_id) != str(cq_asker):
        return {"error": "not_your_turn"}
    _advance_to_next_asker(state, rd)
    return {"ok": True, "next_asker": _current_asker_payload(state)}


def timeout_guess_window(state):
    """guess_window deadline elapsed without a decision. Advance to next asker."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "guess_window":
        return None
    _advance_to_next_asker(state, rd)
    return {"next_asker": _current_asker_payload(state)}


def submit_raise_hand(state, player_id):
    """A guesser claims the next post-answer guess slot. First-come wins.
    Validates eligibility (not drawer, not already excluded this question,
    attempts remaining)."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "hand_raise":
        return {"error": "wrong_phase"}
    if rd.get("hand_raised_by"):
        return {"error": "already_raised"}
    if str(player_id) == str(rd.get("drawer_id")):
        return {"error": "drawer_cant_raise"}
    excluded = set(str(p) for p in (rd.get("excluded_this_question") or []))
    if str(player_id) in excluded:
        return {"error": "already_attempted_this_question"}
    if _attempts_remaining(state, rd, player_id) <= 0:
        return {"error": "no_attempts_left"}
    rd["hand_raised_by"] = str(player_id)
    rd["hand_guess_deadline"] = time.time() + GUESS_WINDOW_SECONDS
    rd["hand_raise_deadline"] = None
    state["phase"] = "hand_guess"
    return {"ok": True, "raiser_id": str(player_id), "guess_window": {
        "asker_id": str(player_id),
        "deadline": rd["hand_guess_deadline"],
        "seconds_remaining": GUESS_WINDOW_SECONDS,
    }}


def timeout_hand_raise(state):
    """No one raised within the 10s window — answer phase ends, advance to
    the next asker."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "hand_raise":
        return None
    _advance_to_next_asker(state, rd)
    return {"next_asker": _current_asker_payload(state)}


def pass_hand_guess(state, player_id):
    """Hand-raiser declined to actually guess. Exclude them, open another
    hand-raise window (or advance if no one eligible)."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "hand_guess":
        return {"error": "wrong_phase"}
    if str(player_id) != str(rd.get("hand_raised_by") or ""):
        return {"error": "not_your_turn"}
    excluded = rd.setdefault("excluded_this_question", [])
    if str(player_id) not in [str(p) for p in excluded]:
        excluded.append(str(player_id))
    return {"ok": True, **_open_hand_raise_or_advance(state, rd)}


def timeout_hand_guess(state):
    """Hand-raiser's window expired — same outcome as voluntary pass."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "hand_guess":
        return None
    pid = rd.get("hand_raised_by")
    if pid is not None:
        excluded = rd.setdefault("excluded_this_question", [])
        if str(pid) not in [str(p) for p in excluded]:
            excluded.append(str(pid))
    return _open_hand_raise_or_advance(state, rd)


def submit_guess(state, guesser_id, card_id):
    """Anyone (non-drawer) attempts to identify the card. DuchMind-style:
    available at any active phase ('asking' / 'answering'), capped per-player
    by `state["guess_attempts_max"]`. Wrong guesses do NOT change the phase
    — the round continues with whoever was supposed to act. Correct guess
    immediately ends the round in the guesser's favor.
    """
    rd = state.get("round_data") or {}
    phase = state.get("phase")
    mode = state.get("mode") or "competitive"
    if phase not in ("asking", "answering"):
        return {"error": "wrong_phase"}
    if str(guesser_id) == rd.get("drawer_id"):
        return {"error": "drawer_cant_guess"}
    if rd.get("card_id") is None:
        return {"error": "no_card_yet"}
    if mode == "competitive" and _attempts_remaining(state, rd, guesser_id) <= 0:
        return {"error": "no_attempts_left"}
    correct = int(card_id) == int(rd.get("card_id") or 0)
    rd.setdefault("qa_log", []).append({
        "asker_id": str(guesser_id),
        "text": f"[정답 시도] card_id={card_id}",
        "answer": "correct" if correct else "wrong",
        "ts": time.time(),
    })
    if mode == "competitive":
        au = rd.setdefault("attempts_used", {})
        au[str(guesser_id)] = au.get(str(guesser_id), 0) + 1
    if correct:
        rd["winner_id"] = str(guesser_id)
        state["phase"] = "reveal"
        return {"ok": True, "correct": True, "round_over": True, "winner_id": str(guesser_id)}
    # Wrong: round continues; no phase change.
    return {"ok": True, "correct": False, "round_over": False}


def timeout_ask(state):
    """Asker ran out of time. Burn 1 question slot, advance to next asker."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "asking":
        return None
    rd.setdefault("qa_log", []).append({
        "asker_id": (rd.get("guesser_order") or [None])[rd.get("asker_index", 0) % max(1, len(rd.get("guesser_order") or [None]))],
        "text": "[시간 초과 - 패스]",
        "answer": "skip",
        "ts": time.time(),
    })
    rd["questions_used"] = rd.get("questions_used", 0) + 1
    rd["asker_index"] = rd.get("asker_index", 0) + 1
    if rd["questions_used"] >= rd.get("total_questions", TOTAL_QUESTIONS):
        state["phase"] = "reveal"
        return {"round_over": True}
    rd["ask_deadline"] = time.time() + ASK_SECONDS
    return {"round_over": False, "next_asker": _current_asker_payload(state)}


def timeout_answer(state):
    """Drawer didn't answer in time → record as 모르겠음."""
    rd = state.get("round_data") or {}
    if state.get("phase") != "answering":
        return None
    cq = rd.get("current_question")
    if not cq:
        return None
    rd.setdefault("qa_log", []).append({
        "asker_id": cq["asker_id"],
        "text": cq["text"],
        "answer": ANSWER_UNSURE,
        "ts": time.time(),
        "auto": True,
    })
    rd["questions_used"] = rd.get("questions_used", 0) + 1
    rd["current_question"] = None
    rd["asker_index"] = rd.get("asker_index", 0) + 1
    if rd["questions_used"] >= rd.get("total_questions", TOTAL_QUESTIONS):
        state["phase"] = "reveal"
        return {"round_over": True}
    state["phase"] = "asking"
    rd["ask_deadline"] = time.time() + ASK_SECONDS
    return {"round_over": False, "next_asker": _current_asker_payload(state)}


def end_turn(state):
    """Compute and apply per-round scores. Returns reveal payload.

    Mode-aware:
    - competitive: only the winner gets COMP_WINNER_BONUS (others get 0);
      drawer gets used*COMP_DRAWER_RATE if anyone won, else 0.
    - cooperative: every guesser gets COOP_GUESSER_FLAT when anyone wins;
      drawer gets used*COOP_DRAWER_RATE if anyone won, else 0.
    No-guess in BOTH modes pays the drawer 0 — picking obscure cards yields
    nothing, so the natural strategy is "challenging-but-solvable".
    """
    rd = state.get("round_data") or {}
    state["phase"] = "reveal"
    if not rd:
        return None
    used = rd.get("questions_used", 0)
    drawer_id = rd.get("drawer_id")
    winner_id = rd.get("winner_id")
    guessers = rd.get("guesser_order") or []
    scores = state.setdefault("scores", {})
    mode = state.get("mode") or "competitive"

    per_winner = 0
    per_other = 0
    drawer_pts = 0
    if winner_id and guessers:
        if mode == "competitive":
            per_winner = COMP_WINNER_BONUS
            scores[winner_id] = scores.get(winner_id, 0) + per_winner
            drawer_pts = used * COMP_DRAWER_RATE
        else:  # cooperative
            per_other = COOP_GUESSER_FLAT
            for pid in guessers:
                scores[pid] = scores.get(pid, 0) + per_other
            drawer_pts = used * COOP_DRAWER_RATE
    if drawer_id:
        scores[drawer_id] = scores.get(drawer_id, 0) + drawer_pts

    return {
        "drawer_id": drawer_id,
        "card_id": rd.get("card_id"),
        "card_name": rd.get("card_name"),
        "winner_id": winner_id,
        "questions_used": used,
        "mode": mode,
        "drawer_score": drawer_pts,
        # Legacy field kept for the existing reveal UI — represents the
        # uniform amount each non-winner guesser earned (0 in competitive).
        "guesser_score_each": per_other,
        "winner_score": per_winner,
        "qa_log": rd.get("qa_log") or [],
        "scores": dict(scores),
        "round": state.get("round", 1),
        "total_rounds": state.get("total_rounds"),
    }
