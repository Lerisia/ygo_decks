import requests
import os
import requests
from django.core.files.base import ContentFile
from django.db import transaction
from bs4 import BeautifulSoup
from card.models import LimitRegulation, Card

def fetch_ygo_cards():
    url = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes"
    response = requests.get(url, stream=True)

    if response.status_code != 200:
        print("Failed to fetch data")
        return
    
    data = response.json()
    
    if "data" not in data:
        print("Invalid response format")
        return
    
    cards = data["data"]
    existing_cards = {card.card_id: card for card in Card.objects.all()}
    
    updated_count = 0
    created_count = 0

    for card in cards:
        base_card_id = card.get("id")
        konami_id = card.get("misc_info", [{}])[0].get("konami_id", 0)
        name = card.get("name", "Unknown Name")
        card_images = card.get("card_images", [])
        
        for idx, image in enumerate(card_images):
            new_id = base_card_id * 100 + idx
            image_url = image["image_url"]
            cropped_url = image["image_url_cropped"]
            
            if str(new_id) in existing_cards:
                existing_card = existing_cards[str(new_id)]

                if existing_card.name != name:
                    existing_card.name = name
                    existing_card.save()
                    updated_count += 1

                if not existing_card.card_image:
                    try:
                        img_resp = requests.get(image_url, stream=True)
                        if img_resp.status_code == 200:
                            file_name = f"{new_id}.jpg"
                            existing_card.card_image.save(file_name, ContentFile(img_resp.content), save=False)
                            existing_card.save()
                    except requests.RequestException as e:
                        print(f"❌ Failed to download full image for {name} (ID: {new_id}): {e}")

                if not existing_card.card_illust:
                    try:
                        illust_resp = requests.get(cropped_url, stream=True)
                        if illust_resp.status_code == 200:
                            file_name = f"{new_id}_illust.jpg"
                            existing_card.card_illust.save(file_name, ContentFile(illust_resp.content), save=False)
                            existing_card.save()
                    except requests.RequestException as e:
                        print(f"❌ Failed to download cropped image for {name} (ID: {new_id}): {e}")

            else:
                new_card = Card(card_id=new_id, konami_id=konami_id, name=name)

                try:
                    cropped_resp = requests.get(cropped_url, stream=True)
                    if cropped_resp.status_code == 200:
                        file_name = f"{new_id}_illust.jpg"
                        new_card.card_illust.save(file_name, ContentFile(cropped_resp.content), save=False)
                except requests.RequestException as e:
                    print(f"❌ Failed to download cropped image for {name} (ID: {new_id}): {e}")

                try:
                    image_resp = requests.get(image_url, stream=True)
                    if image_resp.status_code == 200:
                        file_name = f"{new_id}.jpg"
                        new_card.card_image.save(file_name, ContentFile(image_resp.content), save=False)
                except requests.RequestException as e:
                    print(f"❌ Failed to download full image for {name} (ID: {new_id}): {e}")

                new_card.save()
                created_count += 1

    print(f"{created_count} new cards added, {updated_count} cards updated in the database.")

def fetch_korean_name(konami_id):
    url = f"https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid={konami_id}&request_locale=ko"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"❌ Failed to fetch data for Konami ID {konami_id}")
        return None
    
    soup = BeautifulSoup(response.text, "html.parser")
    
    korean_name_tag = soup.find("div", {"id": "cardname", "class": "pc cardname"})
    
    if korean_name_tag:
        raw_lines = korean_name_tag.get_text(separator="\n").split("\n")
        
        lines = [line.strip() for line in raw_lines if line.strip()]
        
        if lines:
            print("new korean name found " + lines[0])
            return lines[0]
        
    print(f"⚠️ Korean name not found for Konami ID {konami_id}")
    return None

def update_korean_names():
    cards = Card.objects.exclude(konami_id=0).exclude(konami_id=None)

    updated_cards = []
    updated_count = 0

    for card in cards:
        if card.korean_name:
            continue

        korean_name = fetch_korean_name(card.konami_id)

        if korean_name:
            card.korean_name = korean_name
            updated_cards.append(card)
            updated_count += 1

    if updated_cards:
        Card.objects.bulk_update(updated_cards, ["korean_name"])

    print(f"✅ {updated_count} cards updated with Korean names.")