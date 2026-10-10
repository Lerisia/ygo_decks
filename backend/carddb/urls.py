from django.urls import path

from . import dex, views

urlpatterns = [
    path("cards/", dex.cards),
    path("cards/options/", dex.card_options),
    path("cards/<int:card_id>/", dex.card),
    path("card-groups/", views.card_groups),
    path("card-groups/<int:group_id>/", views.card_group),
    path("card-groups/<int:group_id>/members/", views.card_group_member),
]
