from django.urls import path

from . import views

urlpatterns = [
    path("", views.deck_lists),
    path("<str:code>/", views.deck_list),
]
