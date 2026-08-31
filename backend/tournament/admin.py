from django.contrib import admin

from .models import Entrant, Match, Round, Tournament


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "host", "format", "status", "capacity", "current_round", "event_date")
    list_filter = ("format", "status")
    search_fields = ("name", "host__username")


@admin.register(Entrant)
class EntrantAdmin(admin.ModelAdmin):
    list_display = ("name", "tournament", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "tournament__name")


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = ("tournament", "number", "status", "created_at")


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ("round", "entrant1", "entrant2", "score1", "score2", "result", "report_status")
    list_filter = ("report_status", "result")
