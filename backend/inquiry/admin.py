from django.contrib import admin

from .models import InquiryComment, InquiryPost


class InquiryCommentInline(admin.TabularInline):
    model = InquiryComment
    extra = 0
    fields = ("author", "body", "is_deleted", "created_at")
    readonly_fields = ("created_at",)


@admin.register(InquiryPost)
class InquiryPostAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "title", "author", "is_private", "notify_email", "answered_at", "is_deleted", "created_at")
    list_filter = ("board", "is_private", "is_deleted")
    search_fields = ("title", "body", "author__username")
    inlines = [InquiryCommentInline]
