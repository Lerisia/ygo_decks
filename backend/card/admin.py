from django.contrib import admin
from django.utils.html import format_html
from django.db.models import Case, When, IntegerField
from .models import Card, LimitRegulation, LimitRegulationEntry

@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("card_id", "konami_id", "korean_name", "name")
    list_display_links = ("korean_name",)
    search_fields = ("card_id", "konami_id", "korean_name", "name")
    
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

    def get_search_results(self, request, queryset, search_term):
        """
        Apply sorting priority to search results.
        1. Exact match with 'korean_name' or 'name' (highest priority)
        2. 'korean_name' or 'name' starts with the search term
        3. 'korean_name' or 'name' contains the search term (lowest priority)
        """
        if search_term:
            # Annotate search priority based on match type
            filtered_queryset = queryset.annotate(
                search_priority=Case(
                    When(card_id=search_term, then=0),
                    When(korean_name=search_term, then=0),  # Exact match (highest priority)
                    When(name=search_term, then=0),  # Exact match
                    When(korean_name__istartswith=search_term, then=1),  # Starts with search term
                    When(name__istartswith=search_term, then=1),  # Starts with search term
                    When(korean_name__icontains=search_term, then=2),  # Contains search term
                    When(name__icontains=search_term, then=2),  # Contains search term
                    output_field=IntegerField(),
                )
            ).filter(search_priority__isnull=False)  # Exclude unmatched results
            
            return filtered_queryset.order_by("search_priority", "korean_name", "name"), False

        return queryset, False

class LimitRegulationEntryInline(admin.TabularInline):  
    model = LimitRegulationEntry
    extra = 1
    fields = ("card", "regulation_status")
    can_delete = True
    show_change_link = True
    autocomplete_fields = ("card",)

@admin.register(LimitRegulation)
class LimitRegulationAdmin(admin.ModelAdmin):
    list_display = ("name", )
    search_fields = ("name",)
    ordering = ("name",)
    inlines = [LimitRegulationEntryInline]

    def get_total_cards(self, obj):
        return obj.entries.count()

    get_total_cards.short_description = "num_cards"
    
