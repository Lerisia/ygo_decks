from django.contrib import admin
from django.utils.html import format_html

from .models import (
    ChatLog,
    DuchMindWord,
    DuchMindWordPack,
    GameLog,
    PokemonCard,
    Room,
    RoomLog,
    RoomPlayer,
    TurnLog,
)


@admin.register(PokemonCard)
class PokemonCardAdmin(admin.ModelAdmin):
    list_display = ("dex_number", "name_ko", "name_en", "source_file", "image_preview", "id")
    list_display_links = ("dex_number", "name_ko")
    list_filter = ("source_file",)
    search_fields = ("name_ko", "name_en", "name_ja", "dex_number")
    ordering = ("dex_number", "id")
    list_per_page = 50
    readonly_fields = ("created_at", "image_preview_large")
    fields = (
        "dex_number", "name_ko", "name_ko_original", "name_en", "name_ja",
        "type1", "type2", "source_file", "image_url", "image_preview_large",
        "created_at",
    )

    def image_preview(self, obj):
        if obj.image_url:
            return format_html(
                '<img src="{}" style="height:48px;max-width:48px;object-fit:contain"/>',
                obj.image_url,
            )
        return "—"
    image_preview.short_description = "이미지"

    def image_preview_large(self, obj):
        if obj.image_url:
            return format_html(
                '<img src="{}" style="height:200px;max-width:200px;object-fit:contain"/>',
                obj.image_url,
            )
        return "—"
    image_preview_large.short_description = "Preview"


class DuchMindWordInline(admin.TabularInline):
    model = DuchMindWord
    extra = 0
    fields = ("card", "pokemon", "enabled", "note", "created_at")
    readonly_fields = ("created_at",)
    autocomplete_fields = ("card", "pokemon")
    show_change_link = True


@admin.register(DuchMindWordPack)
class DuchMindWordPackAdmin(admin.ModelAdmin):
    list_display = ("name", "series", "owner", "is_default", "is_public", "entry_count", "id")
    list_filter = ("series", "is_default", "is_public")
    search_fields = ("name", "description", "owner__username")
    autocomplete_fields = ("owner",)

    def entry_count(self, obj):
        return obj.entries.count()
    entry_count.short_description = "단어 수"


@admin.register(DuchMindWord)
class DuchMindWordAdmin(admin.ModelAdmin):
    list_display = ("id", "pack", "card", "pokemon", "enabled", "created_at")
    list_filter = ("enabled", "pack")
    search_fields = ("card__korean_name", "pokemon__name_ko", "note")
    autocomplete_fields = ("pack", "card", "pokemon", "created_by")


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "host", "status", "current_game", "is_listed", "created_at")
    list_filter = ("status", "current_game", "is_listed", "is_anonymous")
    search_fields = ("code", "name", "host__username")
    readonly_fields = ("created_at", "last_activity_at")
    autocomplete_fields = ("host", "duchmind_word_pack")


@admin.register(RoomPlayer)
class RoomPlayerAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "user", "guest_nickname", "is_host", "is_spectator", "score", "joined_at")
    list_filter = ("is_host", "is_spectator", "is_hidden")
    search_fields = ("room__code", "user__username", "guest_nickname")
    autocomplete_fields = ("room", "user")


# ============================================================================
# Audit logs (RoomLog / ChatLog / GameLog / TurnLog)
# ============================================================================

class ChatLogInline(admin.TabularInline):
    model = ChatLog
    extra = 0
    fields = ("ts", "channel", "is_system", "kind", "sender_display", "is_spectator", "text")
    readonly_fields = ("ts", "channel", "is_system", "kind", "sender_display", "is_spectator", "text")
    can_delete = False
    show_change_link = False
    ordering = ("ts",)

    def has_add_permission(self, request, obj=None):
        return False


class TurnLogInline(admin.TabularInline):
    model = TurnLog
    extra = 0
    fields = ("round_no", "turn_index", "drawer_display", "word", "correct_count", "given_up_count", "started_at", "ended_at")
    readonly_fields = ("round_no", "turn_index", "drawer_display", "word", "correct_count", "given_up_count", "started_at", "ended_at")
    can_delete = False
    show_change_link = True
    ordering = ("turn_index",)

    def correct_count(self, obj):
        return len(obj.correct_guessers_json or [])
    correct_count.short_description = "정답자"

    def given_up_count(self, obj):
        return len(obj.given_up_json or [])
    given_up_count.short_description = "포기"

    def has_add_permission(self, request, obj=None):
        return False


class GameLogInline(admin.StackedInline):
    model = GameLog
    extra = 0
    fields = ("game_type", "started_at", "ended_at", "turn_count")
    readonly_fields = ("game_type", "started_at", "ended_at", "turn_count")
    can_delete = False
    show_change_link = True
    ordering = ("-started_at",)

    def turn_count(self, obj):
        return obj.turns.count()
    turn_count.short_description = "턴 수"

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(RoomLog)
class RoomLogAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "host_username", "current_game", "max_players", "is_anonymous", "created_at", "closed_at", "chat_count", "game_count")
    list_filter = ("current_game", "is_anonymous", "allow_guests", "spectators_can_chat")
    search_fields = ("code", "name", "host_username")
    readonly_fields = (
        "source_room_id", "code", "name", "host_username", "host_id",
        "max_players", "is_anonymous", "allow_guests", "spectators_can_chat",
        "current_game", "options_json", "created_at", "closed_at",
    )
    ordering = ("-created_at",)
    inlines = [GameLogInline, ChatLogInline]
    list_per_page = 50

    def chat_count(self, obj):
        return obj.chats.count()
    chat_count.short_description = "채팅"

    def game_count(self, obj):
        return obj.games.count()
    game_count.short_description = "게임"

    def has_add_permission(self, request):
        return False


@admin.register(GameLog)
class GameLogAdmin(admin.ModelAdmin):
    list_display = ("id", "room_code", "game_type", "started_at", "ended_at", "turn_count")
    list_filter = ("game_type",)
    search_fields = ("room_log__code", "room_log__name")
    readonly_fields = ("room_log", "game_type", "started_at", "ended_at", "ranked_json")
    ordering = ("-started_at",)
    inlines = [TurnLogInline]
    list_per_page = 50

    def room_code(self, obj):
        return obj.room_log.code
    room_code.short_description = "방 코드"

    def turn_count(self, obj):
        return obj.turns.count()
    turn_count.short_description = "턴 수"

    def has_add_permission(self, request):
        return False


@admin.register(ChatLog)
class ChatLogAdmin(admin.ModelAdmin):
    list_display = ("ts", "room_code", "channel", "is_system", "sender_display", "text_short")
    list_filter = ("channel", "is_system", "is_spectator")
    search_fields = ("room_log__code", "sender_display", "text")
    readonly_fields = ("room_log", "channel", "sender_user_id", "sender_display", "is_spectator", "is_system", "kind", "text", "ts")
    ordering = ("-ts",)
    list_per_page = 100

    def room_code(self, obj):
        return obj.room_log.code
    room_code.short_description = "방 코드"

    def text_short(self, obj):
        return (obj.text or "")[:60]
    text_short.short_description = "내용"

    def has_add_permission(self, request):
        return False


@admin.register(TurnLog)
class TurnLogAdmin(admin.ModelAdmin):
    list_display = ("id", "room_code", "game_type", "round_no", "turn_index", "drawer_display", "word", "started_at")
    list_filter = ("game_log__game_type",)
    search_fields = ("game_log__room_log__code", "drawer_display", "word")
    readonly_fields = (
        "game_log", "turn_index", "round_no", "drawer_user_id", "drawer_display",
        "word", "word_card_id", "correct_guessers_json", "given_up_json",
        "started_at", "ended_at",
    )
    ordering = ("-started_at",)
    list_per_page = 100

    def room_code(self, obj):
        return obj.game_log.room_log.code
    room_code.short_description = "방 코드"

    def game_type(self, obj):
        return obj.game_log.game_type
    game_type.short_description = "게임"

    def has_add_permission(self, request):
        return False
