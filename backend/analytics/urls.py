from django.urls import path

from .views import pageview_beacon, pageview_leave, summary

urlpatterns = [
    path("pageview/", pageview_beacon),
    path("pageview/<int:pageview_id>/leave/", pageview_leave),
    path("summary/", summary),
]
