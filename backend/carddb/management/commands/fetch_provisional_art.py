from django.core.management import call_command
from django.core.management.base import BaseCommand

from carddb.display import make_thumb
from carddb.provisional import sweep


class Command(BaseCommand):
    help = ("Stand-in art for cards Master Duel has not released: cut from the card image ygoprodeck has for them "
            "(by Konami id), shown until a Master Duel print brings the real art, dropped then. Fetches only cards "
            "without one unless --refresh or ids are given; redraws the faces it touched unless --no-draw.")

    def add_arguments(self, parser):
        parser.add_argument("ids", nargs="*", type=int)
        parser.add_argument("--refresh", action="store_true")
        parser.add_argument("--limit", type=int)
        parser.add_argument("--no-draw", action="store_true")

    def handle(self, *args, **opts):
        result = sweep(ids=opts["ids"], refresh=opts["refresh"], limit=opts["limit"], log=self.stdout.write)
        touched = result.pop("touched")
        if touched and not opts["no_draw"]:
            call_command("draw_card_faces", *touched, stdout=self.stdout)
            for card_id in touched:
                make_thumb(card_id, force=True)
        self.stdout.write(str(result))
