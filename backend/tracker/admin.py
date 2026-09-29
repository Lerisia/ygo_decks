from django.contrib import admin

from .models import TrackerClient, TrackerDeckMap, TrackerGame, TrackerPendingMatch


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


class CorrectedFilter(admin.SimpleListFilter):
    title = "상대 덱 교정"
    parameter_name = "corrected"

    def lookups(self, request, model_admin):
        return (("yes", "유저가 고친 판"),)

    def queryset(self, request, queryset):
        return queryset.corrected() if self.value() == "yes" else queryset


@admin.register(TrackerGame)
class TrackerGameAdmin(admin.ModelAdmin):
    list_display = ("user", "did", "game_mode", "result", "opp_name", "suggested_opp_deck", "saved_opp_deck", "rank_code", "ended_at")
    list_filter = (CorrectedFilter, "game_mode", "result")
    list_select_related = ("suggested_opp_deck", "match__opponent_deck")

    @admin.display(description="기록한 상대 덱")
    def saved_opp_deck(self, obj):
        return obj.match.opponent_deck if obj.match_id else None
    search_fields = ("user__username", "did", "opp_name")
    readonly_fields = ("my_cards", "opp_cards")


@admin.register(TrackerClient)
class TrackerClientAdmin(admin.ModelAdmin):
    list_display = ("user", "version", "last_seen")
    search_fields = ("user__username", "version")
