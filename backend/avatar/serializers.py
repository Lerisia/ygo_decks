from rest_framework import serializers
from .models import CardIcon, Border


class BorderSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Border
        fields = ["id", "key", "name", "color", "image_url", "is_default",
                  "category", "rarity", "price"]

    def get_image_url(self, obj):
        try:
            return obj.image.url if obj.image else None
        except Exception:
            return None


class CardIconSerializer(serializers.ModelSerializer):
    card_id = serializers.SerializerMethodField()
    card_name = serializers.SerializerMethodField()
    card_image_url = serializers.SerializerMethodField()
    cropped_image_url = serializers.SerializerMethodField()
    is_custom = serializers.SerializerMethodField()
    is_new = serializers.SerializerMethodField()

    class Meta:
        model = CardIcon
        fields = [
            "id", "title",
            "card", "custom_illust", "is_custom",
            "card_id", "card_name", "card_image_url",
            "cropped_image_url",
            "center_x", "center_y", "radius",
            "category", "price", "rarity", "theme",
            "shop_listed_at", "is_new",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at", "shop_listed_at", "is_new"]

    def get_is_new(self, obj):
        if obj.category != "shop" or obj.shop_listed_at is None:
            return False
        from datetime import timedelta
        from django.utils import timezone
        return (timezone.now() - obj.shop_listed_at) <= timedelta(days=7)

    def get_is_custom(self, obj):
        return bool(obj.custom_illust_id)

    def get_card_id(self, obj):
        return obj.card.card_id if obj.card_id and obj.card else None

    def get_card_name(self, obj):
        if obj.custom_illust_id and obj.custom_illust:
            return obj.custom_illust.name
        return obj.card.korean_name if obj.card_id and obj.card else None

    def get_card_image_url(self, obj):
        try:
            if obj.custom_illust_id and obj.custom_illust and obj.custom_illust.image:
                return obj.custom_illust.image.url
            if obj.card_id and obj.card and obj.card.card_illust:
                return obj.card.card_illust.url
        except Exception:
            return None
        return None

    def get_cropped_image_url(self, obj):
        try:
            return obj.cropped_image.url if obj.cropped_image else None
        except Exception:
            return None
