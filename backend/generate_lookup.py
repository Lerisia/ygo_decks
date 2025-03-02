import json
import os
import django
from itertools import combinations

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from deck.models import Deck

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

def generate_lookup_table():
    lookup_table = {}
    decks = Deck.objects.prefetch_related("summoning_methods", "aesthetic_tags", "performance_tags").all()
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

    lookup_file_path = os.path.join(os.path.dirname(__file__), "lookup_table.json")
    with open(lookup_file_path, "w") as f:
        json.dump(lookup_table, f, indent=4)

    print(f"Created look-up table (file: {lookup_file_path})")

if __name__ == "__main__":
    generate_lookup_table()
