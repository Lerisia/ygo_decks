from django.contrib import admin

from .models import PageView


@admin.register(PageView)
class PageViewAdmin(admin.ModelAdmin):
    list_display = ("created_at", "path", "visitor_id", "user", "duration_sec")
    list_filter = ("path",)
    date_hierarchy = "created_at"
