from django.urls import path

from . import banlist_api

urlpatterns = [
    path("", banlist_api.banlists),
    path("custom/<str:code>/", banlist_api.custom_table),
    path("<str:fmt>/<str:which>/", banlist_api.banlist_table),
]
