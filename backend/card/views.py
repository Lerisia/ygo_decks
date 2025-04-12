import csv
import random
from PIL import Image
import os
from django.http import HttpResponse
from django.conf import settings
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.response import Response
from .models import UploadRecord, CardDetection, Card
from rest_framework.parsers import MultiPartParser
from .classify import predict_card_from_bytes
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.core.files.base import ContentFile
from django.http import JsonResponse
import tempfile, os
from .crop import crop_cards_and_draw_boxes
import os
import uuid
import tempfile
from django.views.decorators.http import require_POST
from django.core.files.storage import default_storage
from card.crop import crop_cards_and_draw_boxes
from rest_framework.permissions import IsAuthenticated

@api_view(["GET"])
def export_cards_csv(request):
    """Convert card data to CSV file"""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="cards.csv"'

    writer = csv.writer(response, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(["ID", "Image URL"])

    for card in Card.objects.iterator():
        image_url = request.build_absolute_uri(card.card_illust.url) if card.card_illust else ""

        writer.writerow([
            str(card.card_id),
            image_url
        ])

    return response

@api_view(["GET"])
def get_quiz_card(request):
    card = Card.objects.filter(
        korean_name__isnull=False,
        card_illust__isnull=False
    ).order_by("?").first()

    if not card:
        return Response({"error": "유효한 카드가 없습니다."}, status=404)

    original_path = card.card_illust.path
    base_filename = os.path.basename(original_path)
    base_name, ext = os.path.splitext(base_filename)

    original_url = request.build_absolute_uri(card.card_illust.url)

    sizes = [8, 12, 16, 24]
    upscale_map = {
        8: 160,
        12: 168,
        16: 160,
        24: 168,
    }

    resized_urls = {}

    for size in sizes:
        output_dir = os.path.join(settings.MEDIA_ROOT, f"quiz_thumbnails/{size}x{size}_shown")
        os.makedirs(output_dir, exist_ok=True)

        output_filename = f"{base_name}_{size}x{size}_shown{ext}"
        output_path = os.path.join(output_dir, output_filename)

        if not os.path.exists(output_path):
            img = Image.open(original_path).convert("RGB")
            img = img.resize((size, size), Image.NEAREST)  # 1차 저해상도 축소
            img = img.resize((upscale_map[size], upscale_map[size]), Image.NEAREST)  # 2차 확대
            img.save(output_path)

        resized_url = request.build_absolute_uri(
            f"{settings.MEDIA_URL}quiz_thumbnails/{size}x{size}_shown/{output_filename}"
        )
        resized_urls[f"{size}x{size}"] = resized_url

    return Response({
        "id": card.card_id,
        "name": card.korean_name,
        "images": {
            **resized_urls,
            "original": original_url,
        }
    })

@api_view(["POST"])
@parser_classes([MultiPartParser])
def predict_card_api(request):
    if "image" not in request.FILES:
        return Response({"error": "No image uploaded."}, status=400)

    image_file = request.FILES["image"]
    image_bytes = image_file.read()

    try:
        top5_ids = predict_card_from_bytes(image_bytes)
    except Exception as e:
        return Response({"error": f"Prediction failed: {str(e)}"}, status=500)

    card_id, confidence = predict_card_from_bytes(image_bytes)
    card = Card.objects.filter(card_id=card_id).first()

    if not card:
        return Response({"error": f"Card ID {card_id} not found in DB."}, status=404)

    return Response({
        "card_id": card.card_id,
        "name": card.korean_name,
        "image_url": request.build_absolute_uri(card.card_illust.url) if card.card_illust else None,
        "confidence": round(confidence, 4)
    })
    
from datetime import timedelta
from django.utils import timezone

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def classify_deck_image(request):
    user = request.user
    if not user.is_staff:
        one_minute_ago = timezone.now() - timedelta(seconds=10)
        recent = UploadRecord.objects.filter(
            user=user,
            detected_at__gte=one_minute_ago
        ).exists()
        if recent:
            return JsonResponse({'error': '10초에 한 번만 요청할 수 있습니다.'}, status=429)
    image_file = request.FILES.get('image')
    if not image_file:
        return JsonResponse({'error': 'No image provided'}, status=400)

    # 1. Save upload record
    upload_record = UploadRecord.objects.create(
        uploaded_image=image_file,
        user=user
    )

    # 2. Create directory with record id
    upload_dir = os.path.join(settings.MEDIA_ROOT, f"upload_{upload_record.id}")
    card_dir = os.path.join(upload_dir, "cards")
    illust_dir = os.path.join(upload_dir, "illusts")
    boxed_path = os.path.join(upload_dir, "boxed.jpg")
    os.makedirs(card_dir, exist_ok=True)
    os.makedirs(illust_dir, exist_ok=True)

    # 3. Save image
    image_path = os.path.join(upload_dir, "input.jpg")
    with open(image_path, 'wb') as f:
        for chunk in image_file.chunks():
            f.write(chunk)

    # 4. Crop
    crop_cards_and_draw_boxes(
        image_path=image_path,
        card_output_dir=card_dir,
        illust_output_dir=illust_dir,
        boxed_image_path=boxed_path,
        min_conf=0.9
    )

    # 5. Classify
    results = []
    illust_files = sorted([f for f in os.listdir(illust_dir) if f.startswith("illust")])
    for fname in illust_files:
        fpath = os.path.join(illust_dir, fname)
        card_fname = fname.replace("illust", "card")
        card_image_path = os.path.join(f"upload_{upload_record.id}", "cards", card_fname)

        with open(fpath, "rb") as f:
            image_bytes = f.read()

        card_id, confidence = predict_card_from_bytes(image_bytes)

        try:
            card_obj = Card.objects.get(card_id=card_id)
        except Card.DoesNotExist:
            card_obj = None

        card_name = (
            card_obj.korean_name
            if card_obj and card_obj.korean_name
            else card_obj.name
            if card_obj and card_obj.name
            else "Unknown"
        )

        # Save the result
        CardDetection.objects.create(
            record=upload_record,
            card=card_obj,
            confidence=confidence,
            illust_image=os.path.join(f"upload_{upload_record.id}", "illusts", fname)
        )

        results.append({
            'card_name': card_name,
            'confidence': round(float(confidence) * 100, 2),
            'card_image': os.path.join(settings.MEDIA_URL, card_image_path)
        })

    boxed_image_url = os.path.join(settings.MEDIA_URL, f"upload_{upload_record.id}/boxed.jpg")

    return JsonResponse({
        'boxed_image': boxed_image_url,
        'result': results
    })

