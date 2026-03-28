from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, BannedWord
from deck.models import Deck

class CustomUserAdmin(UserAdmin):
    model = User

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('사용자 설정', {'fields': ('use_custom_lookup', 'owned_decks')}),
        ('계정 삭제', {'fields': ('pending_deletion', 'deletion_requested_at')}),
        ('권한', {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('중요한 날짜', {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'password1', 'password2'),
        }),
    )

    list_display = ('username', 'is_active', 'is_staff', 'pending_deletion', 'deletion_requested_at', 'date_joined')
    list_filter = ('is_staff', 'is_active', 'pending_deletion', 'use_custom_lookup', 'date_joined')
    search_fields = ('username',)

    filter_horizontal = ('groups', 'user_permissions', 'owned_decks')

admin.site.register(User, CustomUserAdmin)

@admin.register(BannedWord)
class BannedWordAdmin(admin.ModelAdmin):
    list_display = ('word',)
    search_fields = ('word',)
