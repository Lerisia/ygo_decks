from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from django.http import HttpResponse


def health_check(request):
    return HttpResponse("Django is running.", content_type="text/plain")


urlpatterns = [
    path('', health_check),
    path('admin/', admin.site.urls),
    path('api/', include('question.urls')),
    path('api/', include('deck.urls')),
    path('api/', include('userstatistics.urls')),
    path('api/', include('tournament.urls')),
    path('api/', include('tool.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
