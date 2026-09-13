from django.contrib import admin

from .models import TrackerDeckMap, TrackerPendingMatch


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
