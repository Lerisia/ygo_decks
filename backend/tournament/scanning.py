"""Deck screenshot -> [(card_id or None, similarity)] via the card app's scanner: the detector cuts the cards, the
identifier names each by its nearest print (card/identify.py, 엘리스 10/12); None for a picture past knowing."""
import os


def scan_deck_image(image_path, work_dir):
    from PIL import Image

    from card.crop import crop_cards_and_draw_boxes
    from card.identify import identify

    card_dir = os.path.join(work_dir, "cards")
    illust_dir = os.path.join(work_dir, "illusts")
    os.makedirs(card_dir, exist_ok=True)
    os.makedirs(illust_dir, exist_ok=True)
    crop_cards_and_draw_boxes(
        image_path=image_path,
        card_output_dir=card_dir,
        illust_output_dir=illust_dir,
        boxed_image_path=os.path.join(work_dir, "boxed.jpg"),
    )
    cards = sorted(f for f in os.listdir(card_dir) if f.startswith("card"))
    return [(m.card_id, m.similarity) for m in identify([Image.open(os.path.join(card_dir, f)) for f in cards])]
