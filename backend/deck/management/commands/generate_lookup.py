from django.core.management.base import BaseCommand
import json
import os
from itertools import combinations
from deck.models import Deck
from user.models import User  # 모든 유저를 조회하기 위해 추가

STATUS_MAPPING = {"unique": 1, "multiple": 0}

def sorted_key(answers):
    return "|".join(sorted(answers))

def mark_subsets_multiple(lookup_table, parts):
    num = len(parts)
    for r in range(1, num):
        for combo in combinations(parts, r):
            ckey = sorted_key(combo)
            if ckey in lookup_table:
                lookup_table[ckey] = STATUS_MAPPING["multiple"]

def generate_lookup_table(excluded_decks=None):
    lookup_table = {}
    
    if excluded_decks:
        decks = Deck.objects.exclude(id__in=excluded_decks).prefetch_related(
            "summoning_methods", "aesthetic_tags", "performance_tags"
        )
    else:
        decks = Deck.objects.prefetch_related(
            "summoning_methods", "aesthetic_tags", "performance_tags"
        )

    deck_keys = []

    for deck in decks:
        base_items = [
            f"s={deck.strength}",
            f"d={deck.difficulty}",
            f"t={deck.deck_type}",
            f"a={deck.art_style}"
        ]

        summoning_methods = [f"sm={method}" for method in sorted(deck.summoning_methods.values_list("method", flat=True))]
        aesthetic_tags = [f"atag={tag}" for tag in sorted(deck.aesthetic_tags.values_list("id", flat=True))]
        performance_tags = [f"ptag={tag}" for tag in sorted(deck.performance_tags.values_list("id", flat=True))]
        
        all_items = base_items + summoning_methods + aesthetic_tags + performance_tags
        base_key = sorted_key(all_items)
        deck_keys.append(base_key)

        if base_key not in lookup_table:
            lookup_table[base_key] = STATUS_MAPPING["unique"]
        else:
            lookup_table[base_key] = STATUS_MAPPING["multiple"]

        num_parts = len(all_items)
        for r in range(1, num_parts):
            for subset in combinations(all_items, r):
                sub_key = sorted_key(subset)
                if sub_key in lookup_table:
                    if lookup_table[sub_key] == STATUS_MAPPING["unique"]:
                        lookup_table[sub_key] = STATUS_MAPPING["multiple"]
                        mark_subsets_multiple(lookup_table, sub_key.split("|"))
                else:
                    lookup_table[sub_key] = STATUS_MAPPING["unique"]

    for base_key in deck_keys:
        final_key = sorted_key([base_key, "end"])
        if final_key not in lookup_table:
            lookup_table[final_key] = lookup_table[base_key]
    
    lookup_table["empty"] = STATUS_MAPPING["multiple"]

    return lookup_table

def save_lookup_table(lookup_table, filename="lookup_table.json"):
    lookup_file_path = os.path.join("media/lookup_tables", filename)
    os.makedirs(os.path.dirname(lookup_file_path), exist_ok=True)

    with open(lookup_file_path, "w") as f:
        json.dump(lookup_table, f, indent=4)

    print(f"✅ Created Look-up Table: {lookup_file_path}")

class Command(BaseCommand):
    help = "Generate the Look-up Table for deck recommendations."

    def add_arguments(self, parser):
        parser.add_argument(
            "--user_id",
            type=int,
            help="Exclude decks owned by this user."
        )
        parser.add_argument(
            "--all_users",
            action="store_true",
            help="Generate lookup tables for all users."
        )

    def handle(self, *args, **options):
        user_id = options.get("user_id")
        all_users = options.get("all_users")

        # Case 1: Custom lookup table for a user
        if user_id:
            try:
                user = User.objects.get(id=user_id)
                excluded_decks = list(user.owned_decks.values_list("id", flat=True))
                print(f"🔹 User {user_id} 맞춤형 Look-up Table 생성 (보유 덱 제외)")
            except User.DoesNotExist:
                self.stderr.write(f"❌ User ID {user_id} not found.")
                return

            lookup_table = generate_lookup_table(excluded_decks)
            filename = f"lookup_table_{user_id}.json"
            save_lookup_table(lookup_table, filename)

            self.stdout.write(f"✅ Look-up Table 생성 완료: {filename}")

        # Case 2: Custom lookup table for all user
        elif all_users:
            users = User.objects.filter(use_custom_lookup=True)
            self.stdout.write(f"🔹 커스텀 룩업 활성화 유저: {users.count()}명")
            skipped = 0
            for user in users:
                excluded_decks = list(user.owned_decks.values_list("id", flat=True))
                if not excluded_decks:
                    skipped += 1
                    continue
                lookup_table = generate_lookup_table(excluded_decks)
                filename = f"lookup_table_{user.id}.json"
                save_lookup_table(lookup_table, filename)
            if skipped:
                self.stdout.write(f"⏭️ 보유 덱 없는 유저 {skipped}명 스킵")

            self.stdout.write("✅ 모든 유저의 Look-up Table 생성 완료!")

        # Case 3: Default lookup
        else:
            lookup_table = generate_lookup_table()
            save_lookup_table(lookup_table, "lookup_table.json")
            self.stdout.write("✅ 기본 Look-up Table 생성 완료: lookup_table.json")
