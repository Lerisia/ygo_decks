"""Low-quality image quiz game.

Round flow:
- Stage 0 (8x8): seconds 0-3
- Stage 1 (10x10): seconds 3-6
- Stage 2 (12x12): seconds 6-9
- Stage 3 (16x16): seconds 9-12
- Grace period at 16x16: seconds 12-16
- Round ends at second 16

Per stage: correct = +score, wrong = -score, then 3-second cooldown.
"""

import os
import random
import time
from PIL import Image
from django.conf import settings


SIZES = [8, 10, 12, 16]
UPSCALE_MAP = {8: 160, 10: 160, 12: 168, 16: 160}
SCORE_MAP = {"0": 4, "1": 3, "2": 2, "3": 1}  # stage_index -> score (string keys for msgpack)
SECONDS_PER_STAGE = 3
GRACE_SECONDS = 4
COOLDOWN_SECONDS = 3
ROUND_DURATION = SECONDS_PER_STAGE * len(SIZES) + GRACE_SECONDS  # 16s
TOTAL_ROUNDS = 5
INTER_ROUND_PAUSE = 4  # seconds between rounds for showing answer


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


def make_question():
    """Pick a random card and return question data.
    Returns (public_data, correct_answer) — public_data does NOT include the answer.
    """
    from card.models import Card

    valid_cards = Card.objects.filter(
        korean_name__isnull=False,
        card_illust__isnull=False,
    ).exclude(card_illust="")
    unique_names = list(valid_cards.values_list("korean_name", flat=True).distinct())
    if not unique_names:
        return None, None
    chosen_name = random.choice(unique_names)
    card = valid_cards.filter(korean_name=chosen_name).first()
    if not card:
        return None, None

    wrong = list(
        valid_cards.exclude(korean_name=card.korean_name)
        .order_by("?")
        .values_list("korean_name", flat=True)
        .distinct()[:3]
    )
    choices = [card.korean_name] + wrong
    random.shuffle(choices)

    public_data = {
        "card_id": card.card_id,
        "images": _build_image_urls(card),
        "choices": choices,
    }
    return public_data, card.korean_name


def init_game_state(player_ids, total_rounds=TOTAL_ROUNDS):
    return {
        "round": 0,
        "total_rounds": total_rounds,
        "scores": {str(pid): 0 for pid in player_ids},
        "phase": "idle",  # idle | round | reveal | finished
        "round_data": None,
        "started_at": time.time(),
    }


def start_round(state):
    """Generate next question. Returns broadcast payload (public)."""
    public, correct = make_question()
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
        "player_round": {
            pid: {"cooldown_until": 0, "answered_correctly": False, "round_score": 0}
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
    """
    pid = str(player_id)
    rd = state.get("round_data")
    if not rd or state.get("phase") != "round":
        return {"error": "round_not_active"}
    pr = rd["player_round"].get(pid)
    if pr is None:
        return {"error": "not_a_player"}
    if pr["answered_correctly"]:
        return {"error": "already_correct"}

    now = time.time()
    if now < pr["cooldown_until"]:
        return {"error": "cooldown", "cooldown_until": pr["cooldown_until"]}

    if now > rd["deadline"]:
        return {"error": "round_over"}

    stage = current_stage(state)
    score_delta = SCORE_MAP[str(stage)]
    correct = (choice == rd["correct_answer"])
    if correct:
        pr["answered_correctly"] = True
        pr["round_score"] = score_delta
        state["scores"][pid] = state["scores"].get(pid, 0) + score_delta
        return {
            "correct": True,
            "delta": score_delta,
            "stage": stage,
            "total_score": state["scores"][pid],
        }
    else:
        delta = -score_delta
        pr["round_score"] += delta
        state["scores"][pid] = state["scores"].get(pid, 0) + delta
        pr["cooldown_until"] = now + COOLDOWN_SECONDS
        return {
            "correct": False,
            "delta": delta,
            "stage": stage,
            "cooldown_seconds": COOLDOWN_SECONDS,
            "cooldown_until": pr["cooldown_until"],
            "total_score": state["scores"][pid],
        }


def end_round(state):
    """End current round. Returns reveal payload."""
    rd = state.get("round_data")
    state["phase"] = "reveal"
    if not rd:
        return None
    return {
        "correct_answer": rd["correct_answer"],
        "scores": dict(state["scores"]),
        "round": state["round"],
    }


def all_answered(state):
    rd = state.get("round_data")
    if not rd:
        return False
    return all(p["answered_correctly"] for p in rd["player_round"].values())


def is_finished(state):
    return state.get("round", 0) >= state.get("total_rounds", TOTAL_ROUNDS)
