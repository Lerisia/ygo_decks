from django.contrib import admin
from .models import UserResponse

@admin.register(UserResponse)
class UserResponseAdmin(admin.ModelAdmin):
    list_display = ("session_id", "get_deck_name", "date")  # deck 대신 get_deck_name 사용
    list_filter = ("date", "deck")
    search_fields = ("session_id", "deck__name")
    ordering = ("-date",)

    def get_deck_name(self, obj):
        return obj.deck.name  # deck의 name을 가져와 표시
    get_deck_name.short_description = "Deck Name"  # 관리자 페이지에서 보이는 필드명 변경
