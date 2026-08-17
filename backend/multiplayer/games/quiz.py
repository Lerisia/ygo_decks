"""Low-quality image quiz game.

Round flow:
- Stage 0 (8x8): seconds 0-3
- Stage 1 (10x10): seconds 3-6
- Stage 2 (12x12): seconds 6-9
- Stage 3 (16x16): seconds 9-12
- Grace period at 16x16: seconds 12-16
- Round ends when deadline reached OR every active player has answered.

Per player: one shot per round (locked after first selection, correct or
wrong). Correct = +SCORE_MAP[stage], wrong = -WRONG_PENALTY (fixed).
All correct players earn their per-stage score; reveal shows everyone's
result so spectators see the breakdown.
"""

import os
import random
import time
from PIL import Image
from django.conf import settings


SIZES = [8, 10, 12, 16]
UPSCALE_MAP = {8: 160, 10: 160, 12: 168, 16: 160}
SCORE_MAP = {"0": 4, "1": 3, "2": 2, "3": 1}  # stage_index -> score (string keys for msgpack)
WRONG_PENALTY = 2  # fixed deduction on wrong answer (regardless of stage)
SECONDS_PER_STAGE = 3
GRACE_SECONDS = 4
ROUND_DURATION = SECONDS_PER_STAGE * len(SIZES) + GRACE_SECONDS  # 16s
TOTAL_ROUNDS = 5
INTER_ROUND_PAUSE = 10  # seconds between rounds — answer reveal + chat break


def _build_image_urls(card):
    original_path = card.card_illust.path
    urls = {}
    for size in SIZES:
        output_dir = os.path.join(settings.MEDIA_ROOT, f"quiz_thumbnails/{size}x{size}_shown")
        os.makedirs(output_dir, exist_ok=True)
        output_filename = f"{card.card_id}_{size}x{size}.jpg"
        output_path = os.path.join(output_dir, output_filename)
        if not os.path.exists(output_path):
            img = Image.open(original_path).convert("RGB")
            img = img.resize((size, size), Image.NEAREST)
            img = img.resize((UPSCALE_MAP[size], UPSCALE_MAP[size]), Image.NEAREST)
            img.save(output_path)
        urls[f"{size}x{size}"] = f"{settings.MEDIA_URL}quiz_thumbnails/{size}x{size}_shown/{output_filename}"
    return urls


def make_question(pack_id=None):
    """Pick a random card and return question data.
    Returns (public_data, correct_answer) — public_data does NOT include the answer.
    When `pack_id` is set, the question + decoys are restricted to cards in
    that DuchMindWordPack (must be yugioh series; pokemon packs are ignored
    by quiz). When None, the entire card library is used.
    """
    from card.models import Card

    valid_cards = Card.objects.filter(
        korean_name__isnull=False,
        card_illust__isnull=False,
    ).exclude(card_illust="")
    if pack_id is not None:
        from ..models import DuchMindWord
        card_ids = list(
            DuchMindWord.objects
            .filter(pack_id=pack_id, enabled=True, card__isnull=False)
            .values_list("card_id", flat=True)
        )
        if not card_ids:
            return None, None, None
        valid_cards = valid_cards.filter(id__in=card_ids)
    unique_names = list(valid_cards.values_list("korean_name", flat=True).distinct())
    if not unique_names:
        return None, None, None
    chosen_name = random.choice(unique_names)
    card = valid_cards.filter(korean_name=chosen_name).first()
    if not card:
        return None, None, None

    wrong = list(
        valid_cards.exclude(korean_name=card.korean_name)
        .order_by("?")
        .values_list("korean_name", flat=True)
        .distinct()[:3]
    )
    choices = [card.korean_name] + wrong
    random.shuffle(choices)

    try:
        original_url = card.card_illust.url
    except Exception:
        original_url = None
    public_data = {
        "card_id": card.card_id,
        "images": _build_image_urls(card),
        "choices": choices,
    }
    return public_data, card.korean_name, original_url


def init_game_state(player_ids, total_rounds=TOTAL_ROUNDS):
    return {
        "round": 0,
        "total_rounds": total_rounds,
        "scores": {str(pid): 0 for pid in player_ids},
        "phase": "idle",  # idle | round | reveal | finished
        "round_data": None,
        "started_at": time.time(),
    }


def start_round(state, pack_id=None):
    """Generate next question. Returns broadcast payload (public).
    `pack_id` restricts the card pool to a specific DuchMindWordPack (see
    make_question)."""
    public, correct, original_url = make_question(pack_id=pack_id)
    if public is None:
        return None
    now = time.time()
    state["round"] += 1
    state["phase"] = "round"
    state["round_data"] = {
        "started_at": now,
        "deadline": now + ROUND_DURATION,
        "question": public,
        "correct_answer": correct,
        "original_url": original_url,
        "player_round": {
            pid: {"locked": False, "answered_correctly": False, "round_score": 0}
            for pid in state["scores"].keys()
        },
    }
    return {
        "round": state["round"],
        "total_rounds": state["total_rounds"],
        "question": public,
        "duration": ROUND_DURATION,
        "stage_seconds": SECONDS_PER_STAGE,
        "score_map": SCORE_MAP,
        "elapsed_seconds": 0.0,
    }


def current_question_payload(state):
    """Reconstruct the quiz_question payload using the live round_data,
    so reconnecting clients can resume the in-flight round in sync.
    Returns None if no round is in progress.
    """
    rd = state.get("round_data")
    if not rd or state.get("phase") != "round":
        return None
    elapsed = max(0.0, time.time() - rd["started_at"])
    answered, total = answered_progress(state)
    return {
        "round": state["round"],
        "total_rounds": state["total_rounds"],
        "question": rd["question"],
        "duration": ROUND_DURATION,
        "stage_seconds": SECONDS_PER_STAGE,
        "score_map": SCORE_MAP,
        "elapsed_seconds": elapsed,
        "progress": {"answered": answered, "total": total},
    }


def current_reveal_payload(state):
    """Reconstruct the most recent reveal payload if we're between rounds."""
    rd = state.get("round_data")
    if not rd or state.get("phase") != "reveal":
        return None
    return {
        "correct_answer": rd["correct_answer"],
        "image_url": rd.get("original_url"),
        "scores": dict(state["scores"]),
        "round": state["round"],
        "results": _build_results_list(rd),
    }


def current_stage(state):
    rd = state.get("round_data")
    if not rd:
        return 0
    elapsed = time.time() - rd["started_at"]
    stage = int(elapsed // SECONDS_PER_STAGE)
    return min(stage, len(SIZES) - 1)


def submit_answer(state, player_id, choice):
    """Player submits an answer. Returns dict with personal result.
    Side-effect: mutates state.

    Both correct and wrong answers lock the player out of further attempts
    this round — the round waits for everyone to lock in (or for the
    deadline) before revealing.
    """
    pid = str(player_id)
    rd = state.get("round_data")
    if not rd or state.get("phase") != "round":
        return {"error": "round_not_active"}
    pr = rd["player_round"].get(pid)
    if pr is None:
        return {"error": "not_a_player"}
    if pr.get("locked"):
        return {"error": "already_answered"}

    now = time.time()
    if now > rd["deadline"]:
        return {"error": "round_over"}

    stage = current_stage(state)
    correct = (choice == rd["correct_answer"])
    pr["locked"] = True
    pr["answered_correctly"] = correct
    pr["stage_at_answer"] = stage
    pr["choice"] = choice
    if correct:
        delta = SCORE_MAP[str(stage)]
    else:
        delta = -WRONG_PENALTY
    pr["round_score"] = delta
    state["scores"][pid] = state["scores"].get(pid, 0) + delta
    # NOTE: caller (consumer) strips outcome fields before sending to the
    # client — correctness stays hidden until the round-end reveal.
    return {
        "correct": correct,
        "delta": delta,
        "stage": stage,
        "choice": choice,
        "total_score": state["scores"][pid],
    }


def _build_results_list(rd):
    """Per-player breakdown for the reveal payload — only players who locked
    in an answer this round. Sorted: correct first, by stage ascending (so
    fastest correct shows on top)."""
    out = []
    for pid, pr in rd.get("player_round", {}).items():
        if not pr.get("locked"):
            continue
        out.append({
            "player_id": pid,
            "correct": bool(pr.get("answered_correctly")),
            "delta": pr.get("round_score", 0),
            "stage": pr.get("stage_at_answer", 0),
            "choice": pr.get("choice"),
        })
    out.sort(key=lambda r: (0 if r["correct"] else 1, r["stage"], r["player_id"]))
    return out


def add_player(state, player_id):
    """Inject a freshly promoted player into the score map at 0. Idempotent.
    Called when a reserved spectator is promoted between rounds — start_round
    rebuilds player_round from state['scores'].keys(), so this needs to run
    before start_round."""
    pid = str(player_id)
    if pid not in state.get("scores", {}):
        state.setdefault("scores", {})[pid] = 0


def answered_progress(state):
    """(answered_count, total_count) for the active round — used by the
    progress broadcast so everyone sees "X/N답함" without spoilers."""
    rd = state.get("round_data")
    if not rd:
        return 0, 0
    pr = rd.get("player_round", {})
    total = len(pr)
    answered = sum(1 for p in pr.values() if p.get("locked"))
    return answered, total


def end_round(state):
    """End current round. Returns reveal payload with per-player results."""
    rd = state.get("round_data")
    state["phase"] = "reveal"
    if not rd:
        return None
    return {
        "correct_answer": rd["correct_answer"],
        "image_url": rd.get("original_url"),
        "scores": dict(state["scores"]),
        "round": state["round"],
        "results": _build_results_list(rd),
    }


def all_answered(state):
    rd = state.get("round_data")
    if not rd:
        return False
    pr = rd.get("player_round", {})
    if not pr:
        return False
    return all(p.get("locked") for p in pr.values())


def is_finished(state):
    return state.get("round", 0) >= state.get("total_rounds", TOTAL_ROUNDS)
