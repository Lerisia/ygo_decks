from rest_framework import serializers
from .models import CardIcon


class CardIconSerializer(serializers.ModelSerializer):
    card_id = serializers.CharField(source="card.card_id", read_only=True)
    card_name = serializers.CharField(source="card.korean_name", read_only=True)
    card_image_url = serializers.SerializerMethodField()

    class Meta:
        model = CardIcon
        fields = [
            "id", "title",
            "card", "card_id", "card_name", "card_image_url",
            "center_x", "center_y", "radius",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_card_image_url(self, obj):
        try:
            return obj.card.card_illust.url if obj.card.card_illust else None
        except Exception:
            return None
