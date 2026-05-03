from django.urls import path
from . import views

urlpatterns = [
    path("card-icons/", views.list_icons, name="avatar-list-icons"),
    path("card-icons/create/", views.create_icon, name="avatar-create-icon"),
    path("card-icons/<int:icon_id>/", views.update_icon, name="avatar-update-icon"),
    path("card-icons/<int:icon_id>/delete/", views.delete_icon, name="avatar-delete-icon"),
    path("card-icons/search-cards/", views.search_cards, name="avatar-search-cards"),
]
