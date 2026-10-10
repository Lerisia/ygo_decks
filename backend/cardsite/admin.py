from django.contrib import admin

from .models import EffectTag, LegacyTheme, Yugipedia


@admin.register(LegacyTheme)
class LegacyThemeAdmin(admin.ModelAdmin):
    list_display = ("card", "archetype", "archetype_ko")
    search_fields = ("card__name_ko", "archetype", "archetype_ko")


admin.site.register(Yugipedia)
admin.site.register(EffectTag)
