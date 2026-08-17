from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.html import format_html
from .models import User, BannedWord
from deck.models import Deck
from avatar.models import UserIconUnlock, UserBorderUnlock


class UserIconUnlockInline(admin.TabularInline):
    model = UserIconUnlock
    extra = 0
    fields = ("icon", "icon_preview", "granted_at", "note")
    readonly_fields = ("granted_at", "icon_preview")
    autocomplete_fields = ("icon",)
    verbose_name = "보유 아이콘"
    verbose_name_plural = "보유 아이콘"

    def icon_preview(self, obj):
        icon = obj.icon if obj else None
        if icon and icon.cropped_image:
            return format_html(
                '<img src="{}" style="width:48px;height:48px;border-radius:50%;object-fit:cover" />',
                icon.cropped_image.url,
            )
        if icon and icon.card and icon.card.card_illust:
            return format_html(
                '<img src="{}" style="width:48px;height:48px;border-radius:50%;object-fit:cover" title="(crop pending)" />',
                icon.card.card_illust.url,
            )
        return "—"
    icon_preview.short_description = "미리보기"


class UserBorderUnlockInline(admin.TabularInline):
    model = UserBorderUnlock
    extra = 0
    fields = ("border", "granted_at", "note")
    readonly_fields = ("granted_at",)
    autocomplete_fields = ("border",)
    verbose_name = "보유 테두리"
    verbose_name_plural = "보유 테두리"


class CustomUserAdmin(UserAdmin):
    model = User

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('포인트', {'fields': ('points', 'lifetime_points_earned', 'last_daily_bonus_at')}),
        ('아바타', {'fields': ('avatar_icon', 'equipped_border', 'avatar_preview')}),
        ('사용자 설정', {'fields': ('use_custom_lookup', 'owned_decks')}),
        ('계정 삭제', {'fields': ('pending_deletion', 'deletion_requested_at')}),
        ('권한', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('중요한 날짜', {'fields': ('last_login', 'date_joined')}),
    )

    readonly_fields = ('avatar_preview',)

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2'),
        }),
    )

    list_display = (
        'username', 'avatar_thumb', 'icons_count',
        'points', 'lifetime_points_earned',
        'is_active', 'is_staff', 'pending_deletion', 'deletion_requested_at', 'date_joined',
    )
    list_filter = ('is_staff', 'is_active', 'pending_deletion', 'use_custom_lookup', 'date_joined')
    search_fields = ('username', 'email')
    ordering = ('-lifetime_points_earned',)
    autocomplete_fields = ('avatar_icon', 'equipped_border')

    filter_horizontal = ('groups', 'user_permissions', 'owned_decks')

    inlines = (UserIconUnlockInline, UserBorderUnlockInline)

    def avatar_thumb(self, obj):
        icon = obj.avatar_icon
        if icon and icon.cropped_image:
            return format_html(
                '<img src="{}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" />',
                icon.cropped_image.url,
            )
        if icon and icon.card and icon.card.card_illust:
            return format_html(
                '<img src="{}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" title="(crop pending)" />',
                icon.card.card_illust.url,
            )
        return "—"
    avatar_thumb.short_description = "장착"

    def icons_count(self, obj):
        return obj.icon_unlocks.count()
    icons_count.short_description = "보유 수"

    def avatar_preview(self, obj):
        if not obj.pk:
            return "(저장 후 표시됩니다)"
        icon = obj.avatar_icon
        if not icon:
            return "(아이콘 없음)"
        if icon.cropped_image:
            url = icon.cropped_image.url
        elif icon.card and icon.card.card_illust:
            url = icon.card.card_illust.url
        else:
            return "(아이콘 없음)"
        return format_html(
            '<img src="{}" style="width:80px;height:80px;border-radius:50%;'
            'object-fit:cover;border:2px solid #999" />'
            '<div style="margin-top:6px;font-size:12px;">{} (id={})</div>',
            url, icon.title or (icon.card.korean_name if icon.card else "") or "", icon.id,
        )
    avatar_preview.short_description = "장착 아이콘 미리보기"


admin.site.register(User, CustomUserAdmin)

@admin.register(BannedWord)
class BannedWordAdmin(admin.ModelAdmin):
    list_display = ('word',)
    search_fields = ('word',)
