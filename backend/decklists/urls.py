from django.urls import path

from . import views

urlpatterns = [
    path("", views.deck_lists),
    path("comments/<int:pk>/", views.delete_comment),
    path("<str:code>/", views.deck_list),
    path("<str:code>/like/", views.like),
    path("<str:code>/comments/", views.add_comment),
]
