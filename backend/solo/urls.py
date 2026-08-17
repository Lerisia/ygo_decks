from django.urls import path

from . import views, twenty_views

urlpatterns = [
    path("start_draw/", views.start_draw, name="solo_start_draw"),
    path("submit_draw/", views.submit_draw, name="solo_submit_draw"),
    path("board/", views.board, name="solo_board"),
    path("my_status/", views.my_status, name="solo_my_status"),
    path("drawings/<int:drawing_id>/", views.drawing_detail, name="solo_drawing_detail"),
    path("drawings/<int:drawing_id>/guess/", views.submit_guess, name="solo_submit_guess"),
    path("drawings/<int:drawing_id>/give_up/", views.give_up, name="solo_give_up"),
    path("drawings/<int:drawing_id>/recommend/", views.toggle_recommend, name="solo_toggle_recommend"),
    path("drawings/<int:drawing_id>/hide/", views.hide_drawing, name="solo_hide_drawing"),
    path("drawings/<int:drawing_id>/report/", views.report_drawing, name="solo_report_drawing"),
    # Solo 딱무고개 (twenty questions)
    path("twenty/menu/", twenty_views.menu, name="solo_tw_menu"),
    path("twenty/current/", twenty_views.current_game, name="solo_tw_current"),
    path("twenty/start/", twenty_views.start_game, name="solo_tw_start"),
    path("twenty/ask/", twenty_views.ask_question, name="solo_tw_ask"),
    path("twenty/guess/", twenty_views.guess_card, name="solo_tw_guess"),
    path("twenty/give_up/", twenty_views.give_up, name="solo_tw_give_up"),
    path("twenty/hint_dims/", twenty_views.hint_dims, name="solo_tw_hint_dims"),
    path("twenty/hint/", twenty_views.use_hint, name="solo_tw_hint"),
]
