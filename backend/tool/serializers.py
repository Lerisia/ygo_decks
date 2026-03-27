from rest_framework import serializers
from deck.models import Deck

class DeckShortSerializer(serializers.ModelSerializer):
    cover_image_small = serializers.SerializerMethodField()

    class Meta:
        model = Deck
        fields = (
            'id', 
            'name', 
            'cover_image_small',
        )

    def get_cover_image_small(self, obj):
        return obj.cover_image_small.url if obj.cover_image_small else None

