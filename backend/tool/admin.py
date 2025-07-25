from django.contrib import admin
from .models import RecordGroup, MatchRecord

@admin.register(RecordGroup)
class RecordGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "name", "created_at", "is_deleted")
    search_fields = ("user__username", "name")
    list_filter = ("created_at",)
    ordering = ("-created_at",)

@admin.register(MatchRecord)
class MatchRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id", "record_group", "deck", "opponent_deck",
        "result", "first_or_second", "coin_toss_result",
        "rank", "wins", "score",
        "created_at", "is_deleted"
    )
    search_fields = (
        "record_group__name", "deck__name", "opponent_deck__name",
    )
    list_filter = (
        "result", "first_or_second", "coin_toss_result", "rank", "created_at"
    )
    ordering = ("-created_at",)