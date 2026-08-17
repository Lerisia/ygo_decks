from django.contrib import admin

from .models import ChangelogEntry


@admin.register(ChangelogEntry)
class ChangelogEntryAdmin(admin.ModelAdmin):
    list_display = ("title", "published_at", "updated_at")
    list_filter = ("published_at",)
    search_fields = ("title", "body")
    date_hierarchy = "published_at"
    ordering = ("-published_at",)
