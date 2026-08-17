from django.contrib import admin

from .models import (
    SoloDailyPoints, SoloDrawing, SoloDrawingGuess, SoloDrawingRecommend,
    SoloTwentyGame,
)


@admin.register(SoloDrawing)
class SoloDrawingAdmin(admin.ModelAdmin):
    list_display = ("id", "drawer", "word", "solver_count", "recommend_count",
                    "is_hidden", "created_at", "expires_at")
    list_filter = ("is_hidden",)
    search_fields = ("word", "drawer__username")
    readonly_fields = ("created_at", "first_solved_at")


@admin.register(SoloDrawingGuess)
class SoloDrawingGuessAdmin(admin.ModelAdmin):
    list_display = ("id", "drawing", "guesser", "attempts_used", "solved", "points_earned", "created_at")
    list_filter = ("solved",)
    search_fields = ("guesser__username",)


@admin.register(SoloDrawingRecommend)
class SoloDrawingRecommendAdmin(admin.ModelAdmin):
    list_display = ("id", "drawing", "user", "created_at")


@admin.register(SoloDailyPoints)
class SoloDailyPointsAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "date", "drawings_created", "points_earned")
    list_filter = ("date",)
    search_fields = ("user__username",)


@admin.register(SoloTwentyGame)
class SoloTwentyGameAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "card_name_snapshot", "difficulty", "status",
                    "questions_used", "hints_used", "points_awarded",
                    "started_at", "ended_at")
    list_filter = ("difficulty", "status", "started_at")
    search_fields = ("user__username", "card_name_snapshot")
    readonly_fields = ("started_at", "ended_at", "history")
    date_hierarchy = "started_at"
