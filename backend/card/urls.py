from django.urls import path
from .views import export_cards_csv, get_quiz_card, predict_card_api, classify_deck_image
from .quiz_views import quiz_next_card, quiz_check_answer, quiz_submit_score, quiz_leaderboard

urlpatterns = [
    path("get_csv/", export_cards_csv, name="export_cards_csv"),
    path("mosaic-quiz/", get_quiz_card, name="get_mosaic-quiz"),
    path("predict-card/", predict_card_api, name="predict_card_api"),
    path("classify-deck/", classify_deck_image, name="classify_deck_image"),
    path("quiz/next/", quiz_next_card, name="quiz_next_card"),
    path("quiz/check/", quiz_check_answer, name="quiz_check_answer"),
    path("quiz/submit-score/", quiz_submit_score, name="quiz_submit_score"),
    path("quiz/leaderboard/", quiz_leaderboard, name="quiz_leaderboard"),
]
