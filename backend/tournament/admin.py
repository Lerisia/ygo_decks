from django.contrib import admin

from .models import Board, Entrant, Match, Round, TeamMember, Tournament


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "format", "status", "host", "capacity", "team_size", "current_round", "event_date")
    list_filter = ("format", "status")
    search_fields = ("name", "host__username")


@admin.register(Entrant)
class EntrantAdmin(admin.ModelAdmin):
    list_display = ("name", "tournament", "status", "user")
    list_filter = ("status",)
    search_fields = ("name", "tournament__name")


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = ("tournament", "number", "status", "random_seed")


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ("round", "entrant1", "entrant2", "result", "report_status")
    list_filter = ("report_status", "result")


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ("user", "entrant", "is_captain", "order")
    search_fields = ("user__username", "entrant__name")


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("match", "order", "member1", "member2", "result", "report_status")
    list_filter = ("report_status",)
