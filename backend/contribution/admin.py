from django.contrib import admin
from .models import Contribution

@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    list_display = ('user', 'contribution_type', 'deck', 'submitted_at', 'approved')
    list_filter = ('contribution_type', 'approved', 'submitted_at')
    search_fields = ('user__username', 'deck__name', 'content')
    actions = ["approve_contributions"]

    def approve_contributions(self, request, queryset):
        queryset.update(approved=True)
    approve_contributions.short_description = "선택한 제보 승인하기"