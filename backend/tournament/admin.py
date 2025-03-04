from django.contrib import admin
from .models import Tournament, Team, Participant

@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "edition", "host", "tournament_type")

@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "tournament")

@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("user", "tournament", "team")