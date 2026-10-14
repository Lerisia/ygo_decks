from django.urls import path

from . import dex, face_layout, packs, views

urlpatterns = [
    path("dex-counts/", dex.dex_counts),
    path("cards/", dex.cards),
    path("cards/options/", dex.card_options),
    path("cards/counts/", dex.filtered_counts),
    path("cards/<int:card_id>/", dex.card),
    path("packs/", packs.packs),
    path("packs/search/", packs.pack_search),
    path("packs/showcase/", packs.pack_showcase),
    path("packs/<int:pack_id>/", packs.pack),
    path("packs/<int:pack_id>/open/", packs.open_pack),
    path("packs/<int:pack_id>/mine/", packs.pack_mine),
    path("face-layout/", face_layout.layout),
    path("face-layout/assets/<str:name>", face_layout.asset),
    path("face-layout/<int:md_id>/", face_layout.letters),
    path("face-layout/<int:md_id>/bare/", face_layout.bare),
    path("card-groups/", views.card_groups),
    path("card-groups/<int:group_id>/", views.card_group),
    path("card-groups/<int:group_id>/members/", views.card_group_member),
]
