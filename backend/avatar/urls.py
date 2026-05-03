from django.urls import path
from . import views

urlpatterns = [
    path("card-icons/", views.list_icons, name="avatar-list-icons"),
    path("card-icons/my/", views.my_icons, name="avatar-my-icons"),
    path("card-icons/shop/", views.shop_list_icons, name="avatar-shop-list"),
    path("card-icons/grant/", views.grant_icon, name="avatar-grant-icon"),
    path("card-icons/create/", views.create_icon, name="avatar-create-icon"),
    path("card-icons/<int:icon_id>/", views.update_icon, name="avatar-update-icon"),
    path("card-icons/<int:icon_id>/delete/", views.delete_icon, name="avatar-delete-icon"),
    path("card-icons/search-cards/", views.search_cards, name="avatar-search-cards"),
    path("me/", views.my_avatar, name="avatar-me"),
    path("me/set/", views.set_my_avatar, name="avatar-set-me"),
    path("borders/me/", views.my_borders, name="avatar-my-borders"),
    path("borders/me/set/", views.set_my_border, name="avatar-set-my-border"),
    path("borders/grant/", views.grant_border, name="avatar-grant-border"),
]
