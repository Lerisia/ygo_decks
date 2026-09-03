from django.urls import path

from .views import pageview_beacon, summary

urlpatterns = [
    path("pageview/", pageview_beacon),
    path("summary/", summary),
]
