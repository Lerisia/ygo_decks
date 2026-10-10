"""The data steps around switching the site's features to the new card DB.

  swap_cards prepare   before the deploy's migration: links, one DuchMind word per card per pack
                       (the new unique rule), answers of live games in Master Duel names
  swap_cards finish    after it: links again, site data, art, thumbnails, icon spots, recorder stats
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


def words_to_drop(rows):
    """rows = (id, pack_id, new_card_id, enabled). Keep one word per (pack, card): enabled first, then the oldest."""
    keep = {}
    for wid, pack, card, enabled in sorted(rows, key=lambda r: (r[1], r[2], not r[3], r[0])):
        keep.setdefault((pack, card), wid)
    kept = set(keep.values())
    return sorted(r[0] for r in rows if r[0] not in kept)


class Command(BaseCommand):
    help = "Data steps for the card DB swap: `prepare` before the migration, `finish` after it."

    def add_arguments(self, parser):
        parser.add_argument("step", choices=["prepare", "finish"])
        parser.add_argument("--ignore-rooms", action="store_true", help="Go ahead even if a multiplayer room is mid-game.")

    def handle(self, *args, **opts):
        getattr(self, opts["step"])(opts)

    def prepare(self, opts):
        from carddb.display import display_name
        from carddb.importer import fill_new_card_links
        from multiplayer.models import DuchMindWord, Room
        from solo.models import SoloDailyPoints, SoloDrawing, SoloTwentyGame

        live = Room.objects.filter(status="in_game").count()
        if live and not opts["ignore_rooms"]:
            raise CommandError(f"{live} room(s) mid-game; wait for them or pass --ignore-rooms")
        self.stdout.write(f"links: {fill_new_card_links()}")
        with transaction.atomic():
            drop = words_to_drop(list(DuchMindWord.objects.filter(new_card__isnull=False)
                                      .values_list("id", "pack_id", "new_card_id", "enabled")))
            for i in range(0, len(drop), 500):
                DuchMindWord.objects.filter(id__in=drop[i:i + 500]).delete()
            offers = SoloDailyPoints.objects.exclude(pending_offer_cards=[]).update(pending_offer_cards=[], pending_offer_token="")
            games = 0
            for g in SoloTwentyGame.objects.filter(status="active", new_card__isnull=False).select_related("new_card"):
                if g.new_card.name_ko and g.card_name_snapshot != g.new_card.name_ko:
                    SoloTwentyGame.objects.filter(id=g.id).update(card_name_snapshot=g.new_card.name_ko)
                    games += 1
            drawings = 0
            for d in SoloDrawing.objects.filter(expires_at__gt=timezone.now(), new_card__isnull=False).select_related("new_card"):
                name = display_name(d.new_card)
                if name and d.word != name:
                    SoloDrawing.objects.filter(id=d.id).update(word=name)
                    drawings += 1
        self.stdout.write(f"duplicate words dropped: {len(drop)}; drawing offers cleared: {offers}; "
                          f"twenty answers renamed: {games}; drawing answers renamed: {drawings}")

    def finish(self, opts):
        from cardsite.copy import copy_site_data
        from carddb.importer import fill_new_card_links, restore_pendulum_art
        from tracker.learned import rebuild_card_deck_stats

        self.stdout.write(f"links: {fill_new_card_links()}")
        self.stdout.write(f"site data: {copy_site_data()}")
        self.stdout.write(f"pendulum art restored: {restore_pendulum_art()}")
        call_command("make_card_thumbs", stdout=self.stdout)
        call_command("fit_card_icons", stdout=self.stdout)
        self.stdout.write(f"recorder card stats: {rebuild_card_deck_stats()} rows")
