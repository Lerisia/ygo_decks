from rest_framework import serializers
from .models import Tournament

class TournamentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tournament
        fields = ['id', 'name', 'edition', 'cover_image', 'description', 'event_date', 'host', 'status']
        read_only_fields = ['id', 'host']
