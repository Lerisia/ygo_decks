from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "sender", "body", "created_at", "read_at")
    search_fields = ("user__username", "user__email", "body", "sender")
    list_filter = ("sender", "kind")
