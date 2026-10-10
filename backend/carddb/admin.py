from django.contrib import admin

from .models import Card, CardText, MdArt, MdPrint, Override, Product


class CardTextInline(admin.StackedInline):
    model = CardText
    extra = 0


class MdPrintInline(admin.TabularInline):
    model = MdPrint
    extra = 0


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("id", "name_ko", "name_ja", "frame", "ocg_date", "kr_date", "tcg_date")
    list_filter = ("category", "frame")
    search_fields = ("id", "name_ko", "name_ja", "name_en")
    inlines = [CardTextInline, MdPrintInline]


@admin.register(MdPrint)
class MdPrintAdmin(admin.ModelAdmin):
    list_display = ("md_id", "card", "is_alt_art", "rarity", "first_seen")
    list_filter = ("is_alt_art", "rarity")
    search_fields = ("md_id", "card__name_ko")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "region", "release_date")
    list_filter = ("region",)
    search_fields = ("name",)


admin.site.register(MdArt)
admin.site.register(Override)
