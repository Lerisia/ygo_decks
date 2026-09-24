from django.http import JsonResponse

from . import version as ver

OPEN_PATHS = ("/api/tracker/version/", "/api/token/")


class TrackerVersionGate:
    """Refuse API calls from tracker builds below MIN_SUPPORTED, so an unsafe build stops working until it updates.
    0.6.4: builds before it could name a face-down card the game had picked at random (악마양 릴리스).
    Only the tracker sends X-Tracker-Version, so the website is never affected; version and login stay open
    so an old build can still find and fetch the update."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        v = request.headers.get("X-Tracker-Version")
        if (v is not None and request.path.startswith("/api/") and not request.path.startswith(OPEN_PATHS)
                and ver.is_outdated(v, ver.MIN_SUPPORTED) and _user_id(request) not in ver.GATE_EXEMPT_USER_IDS):
            return JsonResponse({"error": "트래커를 최신 버전으로 업데이트해 주세요.", "min_supported": ver.MIN_SUPPORTED,
                                 "url": ver.DOWNLOAD_URL}, status=426)
        return self.get_response(request)


def _user_id(request):
    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication
        found = JWTAuthentication().authenticate(request)
        return found[0].id if found else None
    except Exception:
        return None
