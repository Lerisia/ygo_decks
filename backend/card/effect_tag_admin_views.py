"""Admin-only REST endpoints for reviewing LLM-classified card effect tags.

Powers `/manage/effect-tags` — list cards with their 13 tag flags, filter
by tag and review status, search by name, toggle individual flags. Edits
mark `manually_reviewed=True` so the bulk re-classifier won't clobber human
corrections.
"""
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import Card, CardEffectTag


TAG_FIELDS = [
    # YGOPro/EDOPro-sourced (authoritative for game)
    "cat_destroy_monster", "cat_destroy_st", "cat_destroy_deck", "cat_destroy_hand",
    "cat_send_to_gy", "cat_send_to_hand", "cat_send_to_deck", "cat_banish",
    "cat_draw", "cat_search", "cat_change_atk_def", "cat_change_level_rank",
    "cat_position", "cat_piercing", "cat_direct_attack", "cat_multi_attack",
    "cat_negate_activation", "cat_negate_effect", "cat_damage_lp", "cat_recover_lp",
    "cat_special_summon", "cat_non_effect", "cat_token_related", "cat_fusion_related",
    "cat_ritual_related", "cat_synchro_related", "cat_xyz_related", "cat_link_related",
    "cat_counter_related", "cat_gamble", "cat_control", "cat_move_zones",
    # LLM-derived refinements (kept in the game)
    "special_summons",
    "locks",
    # namuwiki-sourced
    "hand_trap",
]
TAG_LABELS = {
    "cat_destroy_monster":   "몬스터 파괴",
    "cat_destroy_st":        "마/함 파괴",
    "cat_destroy_deck":      "덱→묘지",
    "cat_destroy_hand":      "패에서 버리기",
    "cat_send_to_gy":        "묘지로 보냄",
    "cat_send_to_hand":      "패로 보냄",
    "cat_send_to_deck":      "덱으로 보냄",
    "cat_banish":            "제외",
    "cat_draw":              "드로우",
    "cat_search":            "서치",
    "cat_change_atk_def":    "공/수 변동",
    "cat_change_level_rank": "레벨/랭크 변경",
    "cat_position":          "표시 형식 변경",
    "cat_piercing":          "수비 표시 관통",
    "cat_direct_attack":     "직접 공격",
    "cat_multi_attack":      "여러 번 공격",
    "cat_negate_activation": "발동 무효",
    "cat_negate_effect":     "효과 무효",
    "cat_damage_lp":         "효과 대미지",
    "cat_recover_lp":        "LP 회복",
    "cat_special_summon":    "특수 소환",
    "cat_non_effect":        "효과 없음",
    "cat_token_related":     "토큰 생성",
    "cat_fusion_related":    "융합",
    "cat_ritual_related":    "의식",
    "cat_synchro_related":   "싱크로",
    "cat_xyz_related":       "엑시즈",
    "cat_link_related":      "링크",
    "cat_counter_related":   "카운터",
    "cat_gamble":            "도박",
    "cat_control":           "컨트롤 탈취",
    "cat_move_zones":        "존 이동",
    "special_summons":       "특수 소환 (다른 카드 — LLM)",
    "locks":                 "락 (LLM)",
    "hand_trap":             "패 트랩 (namu)",
}

PAGE_SIZE = 30


def _serialize_row(card: Card, tag: CardEffectTag | None) -> dict:
    """A compact list row — full description is fetched on detail expand to
    keep the list payload small."""
    return {
        "card_pk": card.id,
        "card_id": card.card_id,
        "korean_name": card.korean_name or card.name or "",
        "frame_type": card.frame_type or "",
        "card_type": card.card_type or "",
        "image_url": (card.card_illust.url if card.card_illust else card.image_url) or "",
        "description": card.korean_description or "",
        "tags": {f: bool(getattr(tag, f)) if tag else False for f in TAG_FIELDS},
        "manually_reviewed": bool(tag.manually_reviewed) if tag else False,
        "classifier_version": tag.classifier_version if tag else "",
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def effect_tags_list(request):
    """List cards with their tags. Filters:
      ?tag=destroys           — only cards with this tag = True
      ?missing_tag=destroys   — only cards with this tag = False (audit pass)
      ?q=name                 — substring match on korean_name
      ?reviewed=yes|no|any    — manually_reviewed filter (default any)
      ?has_tags=yes|no|any    — whether a CardEffectTag row exists (default any)
      ?page=1                 — pagination
    """
    tag = request.query_params.get("tag", "")
    missing_tag = request.query_params.get("missing_tag", "")
    q = (request.query_params.get("q") or "").strip()
    reviewed = request.query_params.get("reviewed", "any")
    has_tags = request.query_params.get("has_tags", "any")
    page = max(1, int(request.query_params.get("page") or "1"))

    qs = Card.objects.exclude(korean_description__isnull=True).exclude(korean_description="")
    qs = qs.select_related("effect_tag")

    if q:
        qs = qs.filter(Q(korean_name__icontains=q) | Q(card_id__icontains=q))

    if tag and tag in TAG_FIELDS:
        qs = qs.filter(**{f"effect_tag__{tag}": True})
    if missing_tag and missing_tag in TAG_FIELDS:
        qs = qs.filter(**{f"effect_tag__{missing_tag}": False})

    if reviewed == "yes":
        qs = qs.filter(effect_tag__manually_reviewed=True)
    elif reviewed == "no":
        qs = qs.filter(Q(effect_tag__isnull=True) | Q(effect_tag__manually_reviewed=False))

    if has_tags == "yes":
        qs = qs.exclude(effect_tag__isnull=True)
    elif has_tags == "no":
        qs = qs.filter(effect_tag__isnull=True)

    qs = qs.order_by("id")
    total = qs.count()

    offset = (page - 1) * PAGE_SIZE
    items = qs[offset:offset + PAGE_SIZE]
    rows = []
    for c in items:
        tag_row = getattr(c, "effect_tag", None)
        rows.append(_serialize_row(c, tag_row))

    # Aggregate stats — counts per tag, plus total tagged & reviewed.
    total_with_tags = CardEffectTag.objects.count()
    total_reviewed = CardEffectTag.objects.filter(manually_reviewed=True).count()
    per_tag = {f: CardEffectTag.objects.filter(**{f: True}).count() for f in TAG_FIELDS}

    return Response({
        "results": rows,
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "total_with_tags": total_with_tags,
        "total_reviewed": total_reviewed,
        "tag_fields": TAG_FIELDS,
        "tag_labels": TAG_LABELS,
        "per_tag_count": per_tag,
    })


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def effect_tag_update(request, card_pk: int):
    """Update one or more tag flags on a card. Body: {"destroys": true, ...}.
    Always sets manually_reviewed=True so subsequent bulk re-classification
    won't overwrite the human decision.
    """
    try:
        card = Card.objects.get(pk=card_pk)
    except Card.DoesNotExist:
        return Response({"error": "카드를 찾을 수 없습니다."}, status=404)

    tag, _ = CardEffectTag.objects.get_or_create(card=card, defaults={"classifier_version": "v1"})

    updates = {}
    for field in TAG_FIELDS:
        if field in request.data:
            updates[field] = bool(request.data[field])
    # Allow explicit manually_reviewed override (e.g. "mark unreviewed").
    if "manually_reviewed" in request.data:
        updates["manually_reviewed"] = bool(request.data["manually_reviewed"])
    else:
        updates["manually_reviewed"] = True

    for k, v in updates.items():
        setattr(tag, k, v)
    tag.save()

    return Response(_serialize_row(card, tag))
