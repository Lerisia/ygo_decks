"""Deck screenshot -> [(card_id, confidence)] via the card app's scanner."""
import os


def scan_deck_image(image_path, work_dir):
    from card.classify import predict_card_from_bytes
    from card.crop import crop_cards_and_draw_boxes

    card_dir = os.path.join(work_dir, "cards")
    illust_dir = os.path.join(work_dir, "illusts")
    os.makedirs(card_dir, exist_ok=True)
    os.makedirs(illust_dir, exist_ok=True)
    crop_cards_and_draw_boxes(
        image_path=image_path,
        card_output_dir=card_dir,
        illust_output_dir=illust_dir,
        boxed_image_path=os.path.join(work_dir, "boxed.jpg"),
        min_conf=0.9,
    )
    results = []
    for fname in sorted(f for f in os.listdir(illust_dir) if f.startswith("illust")):
        with open(os.path.join(illust_dir, fname), "rb") as f:
            card_id, confidence = predict_card_from_bytes(f.read())
        results.append((card_id, confidence))
    return results
