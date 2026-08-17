from rest_framework import serializers

from .models import ChangelogEntry


class ChangelogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = ChangelogEntry
        fields = ("id", "title", "body", "published_at")
