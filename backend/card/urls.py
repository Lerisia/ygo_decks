from django.urls import path
from .views import export_cards_csv, get_quiz_card, predict_card_api, classify_deck_image

urlpatterns = [
    path("get_csv/", export_cards_csv, name="export_cards_csv"),
    path("mosaic-quiz/", get_quiz_card, name="get_mosaic-quiz"),
    path("predict-card/", predict_card_api, name="predict_card_api"),
    path("classify-deck/", classify_deck_image, name="classify_deck_image"),
]
