from django.urls import path
from .views import get_deck_result

urlpatterns = [
    path("deck/", get_deck_result),
]
