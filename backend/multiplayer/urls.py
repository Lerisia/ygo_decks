from django.urls import path
from . import views

urlpatterns = [
    path("rooms/", views.list_rooms, name="multiplayer-list-rooms"),
    path("rooms/my/", views.my_room, name="multiplayer-my-room"),
    path("rooms/create/", views.create_room, name="multiplayer-create-room"),
    path("rooms/<int:room_id>/", views.get_room, name="multiplayer-get-room"),
    path("rooms/<int:room_id>/update/", views.update_room, name="multiplayer-update-room"),
    path("rooms/<int:room_id>/join/", views.join_room, name="multiplayer-join-room"),
    path("rooms/<int:room_id>/leave/", views.leave_room, name="multiplayer-leave-room"),
    path("rooms/<int:room_id>/kick/<int:player_id>/", views.kick_player, name="multiplayer-kick-player"),
]
