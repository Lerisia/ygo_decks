from django.urls import path
from . import views

urlpatterns = [
    path("rooms/", views.list_rooms, name="multiplayer-list-rooms"),
    path("rooms/my/", views.my_room, name="multiplayer-my-room"),
    path("rooms/create/", views.create_room, name="multiplayer-create-room"),
    path("rooms/<int:room_id>/", views.get_room, name="multiplayer-get-room"),
    path("rooms/by-code/<str:code>/", views.get_room_by_code, name="multiplayer-get-room-by-code"),
    path("rooms/<int:room_id>/update/", views.update_room, name="multiplayer-update-room"),
    path("rooms/<int:room_id>/join/", views.join_room, name="multiplayer-join-room"),
    path("rooms/<int:room_id>/leave/", views.leave_room, name="multiplayer-leave-room"),
    path("rooms/<int:room_id>/toggle-spectator/", views.toggle_spectator, name="multiplayer-toggle-spectator"),
    path("rooms/<int:room_id>/reserve-for-next/", views.reserve_for_next, name="multiplayer-reserve-for-next"),
    path("rooms/<int:room_id>/transfer-host/<int:player_id>/", views.transfer_host, name="multiplayer-transfer-host"),
    path("rooms/<int:room_id>/close/", views.close_room, name="multiplayer-close-room"),
    path("rooms/<int:room_id>/start/", views.start_game, name="multiplayer-start-game"),
    path("rooms/<int:room_id>/end/", views.end_game, name="multiplayer-end-game"),
    path("rooms/<int:room_id>/kick/<int:player_id>/", views.kick_player, name="multiplayer-kick-player"),
    path("notify-update/", views.notify_update, name="multiplayer-notify-update"),
    # DuchMind admin word-maintenance endpoints. All accept ?pack_id= to
    # target a system tier pack (초급/중급/고급); default = the default pack.
    path("duchmind/admin-packs/", views.dm_admin_packs, name="dm-admin-packs"),
    path("duchmind/browse-cards/", views.dm_browse_cards, name="dm-browse-cards"),
    path("duchmind/words/remove-card/", views.dm_remove_word_by_card, name="dm-remove-word-by-card"),
    path("duchmind/words/", views.dm_list_words, name="dm-list-words"),
    path("duchmind/words/search/", views.dm_search_cards, name="dm-search-cards"),
    path("duchmind/words/add/", views.dm_add_word, name="dm-add-word"),
    path("duchmind/words/bulk/", views.dm_bulk_add_words, name="dm-bulk-add-words"),
    path("duchmind/words/<int:word_id>/", views.dm_toggle_word, name="dm-toggle-word"),
    path("duchmind/words/<int:word_id>/delete/", views.dm_delete_word, name="dm-delete-word"),
    # Word pack management (user-facing)
    path("duchmind/packs/", views.dm_pack_list, name="dm-pack-list"),
    path("duchmind/packs/create/", views.dm_pack_create, name="dm-pack-create"),
    path("duchmind/packs/<int:pack_id>/", views.dm_pack_detail, name="dm-pack-detail"),
    path("duchmind/packs/<int:pack_id>/update/", views.dm_pack_update, name="dm-pack-update"),
    path("duchmind/packs/<int:pack_id>/delete/", views.dm_pack_delete, name="dm-pack-delete"),
    path("duchmind/packs/<int:pack_id>/add-card/", views.dm_pack_add_card, name="dm-pack-add-card"),
    path("duchmind/packs/<int:pack_id>/remove-card/", views.dm_pack_remove_card, name="dm-pack-remove-card"),
    path("duchmind/packs/<int:pack_id>/words/<int:word_id>/", views.dm_pack_remove_word, name="dm-pack-remove-word"),
    path("duchmind/packs/<int:pack_id>/import/", views.dm_pack_import, name="dm-pack-import"),
    path("duchmind/packs/<int:pack_id>/export/", views.dm_pack_export, name="dm-pack-export"),
    path("duchmind/packs/<int:pack_id>/search/", views.dm_pack_search_cards, name="dm-pack-search"),
    # In-game pokemon lookup (mirrors /api/search/ for cards).
    path("duchmind/pokemon-search/", views.pokemon_search, name="dm-pokemon-search"),
]
