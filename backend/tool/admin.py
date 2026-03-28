from django.contrib import admin, messages
from django.urls import path
from django.shortcuts import redirect
from django.utils import timezone
from .models import RecordGroup, MatchRecord, SiteConfig

@admin.register(RecordGroup)
class RecordGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "name", "is_public", "created_at", "is_deleted")
    list_editable = ("is_public",)
    search_fields = ("user__username", "name")
    list_filter = ("created_at", "is_public")
    ordering = ("-created_at",)

@admin.register(MatchRecord)
class MatchRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id", "record_group", "deck", "opponent_deck",
        "result", "first_or_second", "coin_toss_result",
        "rank", "wins", "score", "score_type",
        "created_at", "is_deleted"
    )
    search_fields = (
        "record_group__name", "deck__name", "opponent_deck__name",
    )
    list_filter = (
        "result", "first_or_second", "coin_toss_result", "rank", "score_type", "created_at"
    )
    ordering = ("-created_at",)


@admin.register(SiteConfig)
class SiteConfigAdmin(admin.ModelAdmin):
    list_display = ("key", "value")
    search_fields = ("key",)
    change_list_template = "admin/siteconfig_changelist.html"

    def get_urls(self):
        custom_urls = [
            path("reset-meta-stats/", self.admin_site.admin_view(self.reset_meta_stats_view), name="reset_meta_stats"),
        ]
        return custom_urls + super().get_urls()

    def reset_meta_stats_view(self, request):
        now = timezone.now().strftime("%Y-%m-%dT%H:%M:%S")
        obj, created = SiteConfig.objects.update_or_create(
            key="meta_stats_reset_time",
            defaults={"value": now},
        )
        messages.success(request, f"메타 통계가 초기화되었습니다. ({now})")
        return redirect("admin:tool_siteconfig_changelist")
