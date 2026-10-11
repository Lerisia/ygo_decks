"""Scanner test set: staff check the boxes on real uploads (카드, 덱 칸, 머리글), the yardstick for retraining the
detector (엘리스 2026-10-11)."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import ScanSample

CLASSES = [
    ("card", "카드"),
    ("deck_panel", "덱 칸"),
    ("head_main", "메인 머리글"),
    ("head_extra", "엑스트라 머리글"),
    ("head_side", "사이드 머리글"),
]
KINDS = {
    "wide": "가로로 긴 화면", "tall": "세로로 긴 화면", "single": "카드 한 장 모양", "none": "카드 못 찾음",
    "few": "카드 적음", "deck": "덱", "many": "카드 많음",
}
KEYS = {k for k, _ in CLASSES}


def kind_of(width, height, found):
    """Which part of the test set an upload belongs to, from its shape and how many cards the scanner found on it."""
    ratio = width / height
    if ratio > 1.8:
        return "wide"
    if height > width * 1.6:
        return "tall"
    if 0.62 <= ratio <= 0.76 and found <= 2:
        return "single"
    if found == 0:
        return "none"
    if found <= 15:
        return "few"
    return "many" if found > 60 else "deck"


def _row(s, full=False):
    row = {"id": s.id, "kind": s.kind, "status": s.status, "image_url": s.image.url, "width": s.width, "height": s.height,
           "boxes": s.boxes if full else len(s.boxes), "note": s.note}
    if full:
        row["reviewed_by"] = s.reviewed_by.username if s.reviewed_by else None
    return row


def _clean(boxes):
    """Boxes clipped to the picture, or None when anything in them isn't a box."""
    if not isinstance(boxes, list):
        return None
    out = []
    for b in boxes:
        try:
            c, x, y, w, h = b["c"], float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])
        except (KeyError, TypeError, ValueError):
            return None
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(1.0, x + w), min(1.0, y + h)
        if c not in KEYS or x1 - x0 <= 0 or y1 - y0 <= 0:
            return None
        out.append({"c": c, "x": round(x0, 5), "y": round(y0, 5), "w": round(x1 - x0, 5), "h": round(y1 - y0, 5)})
    return out


@api_view(["GET"])
@permission_classes([IsAdminUser])
def samples(request):
    qs = ScanSample.objects.all()
    status, kind = request.query_params.get("status"), request.query_params.get("kind")
    counts = {k: 0 for k, _ in ScanSample.Status.choices}
    for s in qs.values_list("status", flat=True):
        counts[s] += 1
    if status in counts:
        qs = qs.filter(status=status)
    if kind in KINDS:
        qs = qs.filter(kind=kind)
    return Response({
        "results": [_row(s) for s in qs],
        "counts": counts,
        "classes": [{"key": k, "label": v} for k, v in CLASSES],
        "kinds": [{"key": k, "label": v} for k, v in KINDS.items()],
    })


@api_view(["GET", "PUT"])
@permission_classes([IsAdminUser])
def sample(request, sample_id):
    s = ScanSample.objects.select_related("reviewed_by").filter(id=sample_id).first()
    if not s:
        return Response({"error": "없는 그림입니다."}, status=404)
    if request.method == "PUT":
        data = request.data
        if "boxes" in data:
            boxes = _clean(data["boxes"])
            if boxes is None:
                return Response({"error": "상자 형식이 맞지 않습니다."}, status=400)
            s.boxes = boxes
        if "status" in data:
            if data["status"] not in ScanSample.Status.values:
                return Response({"error": "상태 값이 맞지 않습니다."}, status=400)
            s.status = data["status"]
        if "note" in data:
            s.note = str(data["note"])[:200]
        s.reviewed_by = request.user
        s.save()
    return Response(_row(s, full=True))


def load_detector():
    from ultralytics import YOLO
    from .crop import model_path
    return YOLO(model_path)


def detect_cards(detector, path, width, height, conf):
    """The card boxes the detector finds on a picture, as fractions, for staff to start from."""
    result = detector.predict(path, conf=conf, verbose=False)[0]
    return [{"c": "card", "x": round(float(x0) / width, 5), "y": round(float(y0) / height, 5),
             "w": round(float(x1 - x0) / width, 5), "h": round(float(y1 - y0) / height, 5)}
            for x0, y0, x1, y1 in result.boxes.xyxy.cpu().numpy()]
