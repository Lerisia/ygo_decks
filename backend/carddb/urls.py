from django.urls import path

from . import views

urlpatterns = [
    path("card-groups/", views.card_groups),
    path("card-groups/<int:group_id>/", views.card_group),
    path("card-groups/<int:group_id>/members/", views.card_group_member),
]
