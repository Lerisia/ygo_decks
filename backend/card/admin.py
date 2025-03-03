from django.contrib import admin
from django.utils.html import format_html
from .models import Card

@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("konami_id", "korean_name", "name", "limit_regulation")
    search_fields = ("konami_id", "korean_name", "name")
    list_filter = ("limit_regulation", )
    
    readonly_fields = []
    
    def card_image_preview(self, obj):
        if obj.card_image:
            return format_html('<img src="{}" style="max-width:200px; height:auto;" />', obj.card_image.url)
        return "-"
    
    card_image_preview.short_description = "Card Image Preview"

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return self.readonly_fields + ['card_image_preview']
        return self.readonly_fields
