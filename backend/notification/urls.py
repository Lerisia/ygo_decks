from django.urls import path

from . import views

urlpatterns = [
    path("", views.list_notifications),
    path("unread-count/", views.unread_count),
    path("<int:notification_id>/dismiss/", views.dismiss),
]
