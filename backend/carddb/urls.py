from django.urls import path

from . import dex, packs, views

urlpatterns = [
    path("dex-counts/", dex.dex_counts),
    path("cards/", dex.cards),
    path("cards/options/", dex.card_options),
    path("cards/<int:card_id>/", dex.card),
    path("packs/", packs.packs),
    path("packs/<int:pack_id>/", packs.pack),
    path("card-groups/", views.card_groups),
    path("card-groups/<int:group_id>/", views.card_group),
    path("card-groups/<int:group_id>/members/", views.card_group_member),
]
