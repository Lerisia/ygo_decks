from django.contrib import admin
from django.utils.html import format_html
from .models import CardIcon, Border, UserIconUnlock, UserBorderUnlock, CustomIllust


@admin.register(CustomIllust)
class CustomIllustAdmin(admin.ModelAdmin):
    list_display = ("id", "preview", "name", "created_at")
    search_fields = ("name",)
    ordering = ("-created_at",)

    def preview(self, obj):
        if obj.image:
            return format_html(
                '<img src="{}" style="width:48px;height:48px;object-fit:cover" />',
                obj.image.url,
            )
        return "—"


@admin.register(CardIcon)
class CardIconAdmin(admin.ModelAdmin):
    list_display = ("id", "preview", "title", "card", "category", "rarity", "price", "theme", "created_at")
    list_filter = ("category", "rarity", "theme")
    search_fields = ("title", "card__korean_name", "card__name", "theme")
    autocomplete_fields = ("card",)
    ordering = ("-created_at",)

    def preview(self, obj):
        if obj.cropped_image:
            return format_html(
                '<img src="{}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />',
                obj.cropped_image.url,
            )
        if obj.card and obj.card.card_illust:
            return format_html(
                '<img src="{}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" title="(crop pending)" />',
                obj.card.card_illust.url,
            )
        return "—"


@admin.register(Border)
class BorderAdmin(admin.ModelAdmin):
    list_display = ("id", "key", "name", "is_default", "sort_order")
    list_filter = ("is_default",)
    search_fields = ("key", "name")
    ordering = ("sort_order", "id")


@admin.register(UserIconUnlock)
class UserIconUnlockAdmin(admin.ModelAdmin):
    list_display = ("user", "icon", "granted_at", "note")
    search_fields = ("user__username", "icon__title", "icon__card__korean_name")
    autocomplete_fields = ("user", "icon")
    ordering = ("-granted_at",)


@admin.register(UserBorderUnlock)
class UserBorderUnlockAdmin(admin.ModelAdmin):
    list_display = ("user", "border", "granted_at", "note")
    search_fields = ("user__username", "border__key", "border__name")
    autocomplete_fields = ("user", "border")
    ordering = ("-granted_at",)
