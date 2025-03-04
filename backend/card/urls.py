from django.urls import path
from .views import export_cards_csv

urlpatterns = [
    path("get_csv/", export_cards_csv, name="export_cards_csv"),
]
