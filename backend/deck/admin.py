import os
import threading
from django.contrib import admin, messages
from django.urls import path
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.utils.html import format_html
from .models import Deck, SummoningMethod, PerformanceTag, AestheticTag, DeckAlias
from .management.commands.generate_lookup import generate_lookup_table, save_lookup_table


def _regenerate_all_luts():
    from user.models import User
    save_lookup_table(generate_lookup_table(), "lookup_table.json")
    for user in User.objects.filter(use_custom_lookup=True):
        excluded = list(user.owned_decks.values_list("id", flat=True))
        if not excluded:
            continue
        save_lookup_table(generate_lookup_table(excluded), f"lookup_table_{user.id}.json")


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
    change_list_template = "admin/deck_changelist.html"

    def get_urls(self):
        custom_urls = [
            path("regenerate-lut/", self.admin_site.admin_view(self.regenerate_lut_view), name="deck_regenerate_lut"),
        ]
        return custom_urls + super().get_urls()

    def regenerate_lut_view(self, request):
        threading.Thread(target=_regenerate_all_luts, daemon=True).start()
        messages.success(request, "LUT 재생성이 백그라운드에서 시작되었습니다.")
        return redirect("admin:deck_deck_changelist")

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

@admin.register(DeckAlias)
class DeckAliasAdmin(admin.ModelAdmin):
    list_display = ('name', 'deck')
    search_fields = ('name',)
