from django.urls import path

from . import views

urlpatterns = [
    path("changelog/", views.list_entries, name="changelog-list"),
    path("changelog/latest/", views.latest_entry, name="changelog-latest"),
]
