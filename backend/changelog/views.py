from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import ChangelogEntry
from .serializers import ChangelogEntrySerializer


def _visible_entries():
    return ChangelogEntry.objects.filter(published_at__lte=timezone.now())


@api_view(["GET"])
@permission_classes([AllowAny])
def list_entries(request):
    entries = _visible_entries()
    return Response(ChangelogEntrySerializer(entries, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def latest_entry(request):
    entry = _visible_entries().first()
    data = ChangelogEntrySerializer(entry).data if entry else None
    return Response({"entry": data})
