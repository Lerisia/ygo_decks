from django.utils import timezone
from rest_framework import serializers

from .models import ChangelogEntry


class ChangelogEntrySerializer(serializers.ModelSerializer):
    scheduled = serializers.SerializerMethodField()

    class Meta:
        model = ChangelogEntry
        fields = ("id", "title", "body", "published_at", "scheduled")

    def get_scheduled(self, obj):
        return obj.published_at > timezone.now()


class ChangelogWriteSerializer(serializers.ModelSerializer):
    published_at = serializers.DateTimeField(required=False)

    class Meta:
        model = ChangelogEntry
        fields = ("title", "body", "published_at")

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError("제목을 입력해 주세요.")
        return value.strip()

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("본문을 입력해 주세요.")
        return value.strip()

    def create(self, validated_data):
        validated_data.setdefault("published_at", timezone.now())
        return super().create(validated_data)
