from django.contrib import admin

from .models import TrackerDeckMap, TrackerGame, TrackerPendingMatch


@admin.register(TrackerPendingMatch)
class TrackerPendingMatchAdmin(admin.ModelAdmin):
    list_display = ("user", "did", "status", "created_at", "match")
    list_filter = ("status",)
    search_fields = ("user__username", "did")
    readonly_fields = ("payload",)


@admin.register(TrackerDeckMap)
class TrackerDeckMapAdmin(admin.ModelAdmin):
    list_display = ("user", "md_deck_id", "deck", "updated_at")
    search_fields = ("user__username", "md_deck_id", "deck__name")
    autocomplete_fields = ("deck",)


@admin.register(TrackerGame)
class TrackerGameAdmin(admin.ModelAdmin):
    list_display = ("user", "did", "game_mode", "result", "opp_name", "rank_code", "rating_after", "ended_at", "match")
    list_filter = ("game_mode", "result")
    search_fields = ("user__username", "did", "opp_name")
    readonly_fields = ("my_cards", "opp_cards")
