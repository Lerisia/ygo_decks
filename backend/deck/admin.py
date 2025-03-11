from django.contrib import admin
from django.utils.html import format_html
from .models import Deck, SummoningMethod, PerformanceTag, AestheticTag
import os

@admin.register(Deck)
class DeckAdmin(admin.ModelAdmin):
    list_display = (
        'name',
        'strength',
        'difficulty',
        'deck_type',
        'art_style',
        'display_summoning_methods',
        'display_performance_tags',
        'display_aesthetic_tags'
    )
    search_fields = ('name', )
    list_filter = ('strength', 'difficulty', 'deck_type', 'art_style')
    readonly_fields = []

    def display_summoning_methods(self, obj):
        return ", ".join(
            [sm.get_method_display() for sm in obj.summoning_methods.all()]
        )
    display_summoning_methods.short_description = "Summoning Methods"

    def display_performance_tags(self, obj):
        return ", ".join([t.name for t in obj.performance_tags.all()])
    display_performance_tags.short_description = "Performance Tags"

    def display_aesthetic_tags(self, obj):
        return ", ".join([t.name for t in obj.aesthetic_tags.all()])
    display_aesthetic_tags.short_description = "Aesthetic Tags"

    def cover_image_preview(self, obj):
        if obj.cover_image:
            return format_html('<img src="{}" style="max-width:200px; height:auto;" />', obj.cover_image.url)
        return "-"
    cover_image_preview.short_description = "Cover Image Preview"
    
    def small_image_exists(self, obj):
        if obj.cover_image:
            small_img_path = os.path.join(
                obj.cover_image.storage.location,
                "deck_covers/small",
                os.path.basename(obj.cover_image.name)
            )
            if os.path.exists(small_img_path):
                return format_html('<span style="color: green;">✔ 존재함</span>')
        return format_html('<span style="color: red;">✘ 없음</span>')
    small_image_exists.short_description = "Small Image"

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return self.readonly_fields + ['cover_image_preview'] + ['small_image_exists']
        return self.readonly_fields

@admin.register(SummoningMethod)
class SummoningMethodAdmin(admin.ModelAdmin):
    list_display = ('method',)

@admin.register(PerformanceTag)
class PerformanceTagAdmin(admin.ModelAdmin):
    list_display = ('name',)
    
@admin.register(AestheticTag)
class AestheticTagAdmin(admin.ModelAdmin):
    list_display = ('name',)
