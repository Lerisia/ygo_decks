from django.urls import path
from .views import get_questions

urlpatterns = [
    path('get_questions/', get_questions, name='get_questions'),
]