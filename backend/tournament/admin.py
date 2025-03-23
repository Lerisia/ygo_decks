from django.contrib import admin
from .models import Tournament, Participant, DeckPhoto, GroupStage, Bracket

@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "edition", "event_date", "status", "host")
    list_filter = ("status", "event_date")
    search_fields = ("name", "host__username")
    ordering = ("-event_date",)

@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("user", "tournament", "status")
    list_filter = ("status", "tournament")
    search_fields = ("user__username", "tournament__name")

@admin.register(DeckPhoto)
class DeckPhotoAdmin(admin.ModelAdmin):
    list_display = ("uploaded_by", "image")
    search_fields = ("uploaded_by__username",)

@admin.register(GroupStage)
class GroupStageAdmin(admin.ModelAdmin):
    list_display = ("tournament", "name")
    search_fields = ("tournament__name", "name")

@admin.register(Bracket)
class BracketAdmin(admin.ModelAdmin):
    list_display = ("tournament", "round", "type")
    list_filter = ("type", "tournament")
    search_fields = ("tournament__name",)