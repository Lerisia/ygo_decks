from django.urls import path

from . import views

urlpatterns = [
    path("inquiry/", views.posts, name="inquiry-posts"),
    path("inquiry/<int:pk>/", views.post_detail, name="inquiry-post"),
    path("inquiry/<int:pk>/comments/", views.add_comment, name="inquiry-comment-add"),
    path("inquiry/comments/<int:pk>/", views.delete_comment, name="inquiry-comment"),
]
