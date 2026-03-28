from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from django.http import HttpResponse


def health_check(request):
    return HttpResponse("Django is running.", content_type="text/plain")


from card.quiz_views import quiz_next_card, quiz_check_answer, quiz_submit_score, quiz_leaderboard

urlpatterns = [
    path('', health_check),
    path('admin/', admin.site.urls),
    path('api/', include('question.urls')),
    path('api/', include('deck.urls')),
    path('api/', include('userstatistics.urls')),
    path('api/', include('tool.urls')),
    path('api/quiz/next/', quiz_next_card),
    path('api/quiz/check/', quiz_check_answer),
    path('api/quiz/submit-score/', quiz_submit_score),
    path('api/quiz/leaderboard/', quiz_leaderboard),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
