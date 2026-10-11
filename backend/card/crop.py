import cv2
import os
import argparse
from ultralytics import YOLO
from PIL import Image
import numpy as np
from django.conf import settings

model_path = os.path.join(settings.BASE_DIR, "card", "best.pt")

# detector v2 (엘리스 10/11): the cards it finds sit at 0.93 and up; below 0.75 come other games' cards, number badges
# and boxes round several small cards
CARD_CONF = 0.75


def detector_settings(names, train_args):
    """The class index of "card" (the v2 detector also finds the deck panel and the main / extra / side headings) and
    the image size the model was trained at."""
    card = next((i for i, n in names.items() if n == "card"), 0)
    return card, (train_args or {}).get("imgsz", 640)


def keep_card_box(box, conf, min_conf=CARD_CONF):
    """A detected card worth cropping: confident enough, big enough to cut its art from, and not a sliver (a card less
    than half on screen, which the detector is taught to leave)."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    return conf >= min_conf and w >= 16 and h >= 24 and w / h >= 0.35

def crop_illust_from_card(card_img: Image.Image) -> Image.Image:
    def is_pendulum_card(card_img: Image.Image) -> bool:
        np_img = np.array(card_img)
        h, w, _ = np_img.shape

        # Check if the top part is 'green' color
        top = np_img[int(h * 0.10):int(h * 0.17), int(w * 0.38):int(w * 0.45), :]
        # Chec if the bottom part is 'greenary' color
        bottom = np_img[int(h * 0.9):, int(w * 0.15):int(w * 0.5), :]

        top_hsv = cv2.cvtColor(top, cv2.COLOR_RGB2HSV)
        bottom_hsv = cv2.cvtColor(bottom, cv2.COLOR_RGB2HSV)

        lower_green = np.array([55, 10, 140])
        upper_green = np.array([95, 255, 255])
        green_mask = cv2.inRange(bottom_hsv, lower_green, upper_green)
        green_ratio = np.sum(green_mask > 0) / green_mask.size

        top_hue = np.mean(top_hsv[:, :, 0])
        return green_ratio > 0.2 and not (35 <= top_hue <= 97)

    W, H = card_img.size

    if is_pendulum_card(card_img):
        x1 = int(W * 0.12)
        y1 = int(H * 0.22)
        x2 = int(W * 0.93)
        y2 = int(H * 0.63)
    else:
        x1 = int(W * 0.16)
        y1 = int(H * 0.22)
        x2 = int(W * 0.86)
        y2 = int(H * 0.70)

    return card_img.crop((x1, y1, x2, y2))


def sort_boxes_top_left_to_bottom_right(boxes, y_threshold=30):
    boxes = np.array(boxes)
    indices = list(range(len(boxes)))

    indices.sort(key=lambda idx: boxes[idx][1])

    rows = []
    used = [False] * len(boxes)

    for i in indices:
        if used[i]:
            continue
        current_row = [i]
        used[i] = True
        y1_i = boxes[i][1]

        for j in indices:
            if used[j]:
                continue
            y1_j = boxes[j][1]
            if abs(y1_i - y1_j) < y_threshold:
                current_row.append(j)
                used[j] = True

        current_row = sorted(current_row, key=lambda idx: boxes[idx][0])
        rows.extend(current_row)

    return rows


def crop_cards_and_draw_boxes(
    image_path,
    model_path=model_path,
    card_output_dir="cropped_cards",
    illust_output_dir="cropped_illusts",
    boxed_image_path="boxed.jpg",
    min_conf=CARD_CONF
):
    os.makedirs(card_output_dir, exist_ok=True)
    os.makedirs(illust_output_dir, exist_ok=True)

    # Load original image and model
    image = cv2.imread(image_path)
    if image is None:
        print("❌ 이미지 로드 실패:", image_path)
        return

    model = YOLO(model_path)
    card, imgsz = detector_settings(model.names, (model.ckpt or {}).get("train_args"))
    results = model.predict(image, imgsz=imgsz, classes=[card], verbose=False)[0]  # inference only

    # Get detection results
    boxes = results.boxes.xyxy.cpu().numpy()
    confs = results.boxes.conf.cpu().numpy()

    # Get sorted index
    sorted_indices = sort_boxes_top_left_to_bottom_right(boxes)
    boxes = [boxes[i] for i in sorted_indices]
    confs = [confs[i] for i in sorted_indices]

    boxed = image.copy()
    count = 0

    for i, (box, conf) in enumerate(zip(boxes, confs)):
        if not keep_card_box(box, conf, min_conf):
            continue

        x1, y1, x2, y2 = map(int, box)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        # Save card images
        card_filename = os.path.join(card_output_dir, f"card_{count+1:02}.jpg")
        cv2.imwrite(card_filename, crop)

        # Crop and save card illusts
        pil_card = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        illust = crop_illust_from_card(pil_card)
        illust_save_path = os.path.join(illust_output_dir, f"illust_{count+1:02}.jpg")
        illust.save(illust_save_path)

        # Drow bow to input image
        cv2.rectangle(boxed, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(boxed, f"{conf:.2f}", (x1, y1 - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        count += 1

    cv2.imwrite(boxed_image_path, boxed)
    print(f"✅ {count}장의 카드가 {card_output_dir}에 저장됨")
    print(f"✅ {count}장의 일러스트가 {illust_output_dir}에 저장됨")
    print(f"🖼️ 박스 시각화: {boxed_image_path}")