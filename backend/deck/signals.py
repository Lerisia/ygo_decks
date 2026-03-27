from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import Deck


def generate_and_save_all_lookups():
    from deck.management.commands.generate_lookup import generate_lookup_table, save_lookup_table
    from user.models import User

    save_lookup_table(generate_lookup_table(), "lookup_table.json")

    for user in User.objects.filter(use_custom_lookup=True):
        excluded = list(user.owned_decks.values_list("id", flat=True))
        if not excluded:
            continue
        table = generate_lookup_table(excluded)
        save_lookup_table(table, f"lookup_table_{user.id}.json")


@receiver(post_save, sender=Deck)
def regenerate_lookup_on_deck_save(sender, **kwargs):
    generate_and_save_all_lookups()


@receiver(post_delete, sender=Deck)
def regenerate_lookup_on_deck_delete(sender, **kwargs):
    generate_and_save_all_lookups()
