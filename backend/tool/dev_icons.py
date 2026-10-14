"""/dev/icons (참혈 2026-10-15): the icon the design team picked for each emoji the site draws, saved for the coding bot
to read (SiteConfig "dev_icon_choices": choices, the Remix names typed by hand, who saved and when)."""
import json
import re

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import SiteConfig

KEY = "dev_icon_choices"
LIBS = {"fa", "fa-regular", "remix-fill", "remix-line", "material-icons", "material-symbols"}
NAME = re.compile(r"^[a-z0-9_-]{1,60}$")
ROWS = 300


def _row(k):
    return isinstance(k, str) and 0 < len(k) <= 40


@api_view(["GET", "PUT"])
@permission_classes([IsAdminUser])
def icon_choices(request):
    if request.method == "GET":
        return Response(json.loads(SiteConfig.get(KEY) or "{}"))
    choices, custom = request.data.get("choices"), request.data.get("custom", {})
    if not isinstance(choices, dict) or not isinstance(custom, dict) or len(choices) > ROWS or len(custom) > ROWS:
        return Response({"error": "choices와 custom은 줄 이름을 키로 하는 객체여야 합니다."}, status=400)
    for k, v in choices.items():
        if not (_row(k) and isinstance(v, dict) and v.get("lib") in LIBS and NAME.match(str(v.get("name", "")))):
            return Response({"error": f"잘못된 선택: {k!s:.40}"}, status=400)
    for k, v in custom.items():
        if not (_row(k) and isinstance(v, str) and NAME.match(v)):
            return Response({"error": f"잘못된 이름: {k!s:.40}"}, status=400)
    value = {
        "choices": {k: {"lib": v["lib"], "name": v["name"]} for k, v in choices.items()},
        "custom": dict(custom),
        "saved_by": request.user.username,
        "saved_at": timezone.localtime().isoformat(timespec="seconds"),
    }
    SiteConfig.objects.update_or_create(key=KEY, defaults={"value": json.dumps(value, ensure_ascii=False)})
    return Response(value)
