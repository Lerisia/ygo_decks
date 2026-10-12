from django.conf import settings
from django.core.management.base import BaseCommand

from carddb import md_packs


class Command(BaseCommand):
    help = ("Store Master Duel's packs and the cards in each from masterduelmeta.com, with the game's own pack numbers, "
            "Korean names and covers (settings.MD_PACK_MAP), the versions campaigns made of them (Yugipedia, kept at "
            "settings.MD_ALT_CAMPAIGNS) and the master pack as AppMedia lists it (kept at settings.MD_MASTER_LIST) — "
            "the pack simulator.")

    def add_arguments(self, parser):
        parser.add_argument("--pause", type=float, default=1.0)

    def handle(self, *args, **opts):
        campaigns = md_packs.campaign_prints(md_packs.load_campaigns(settings.MD_ALT_CAMPAIGNS))
        master = md_packs.master_list_prints(md_packs.load_master_list(settings.MD_MASTER_LIST))
        out = md_packs.sync(md_packs.fetch_sets(), md_packs.fetch_cards(pause=opts["pause"]),
                            pack_map=md_packs.load_pack_map(settings.MD_PACK_MAP), campaigns=campaigns, master=master)
        self.stdout.write(f"md packs: {out['packs']} packs, {out['cards']} cards ({out['added']} added, "
                          f"{out['removed']} removed, {out['changed']} changed), {out['versions']} campaign versions "
                          f"from {len(campaigns)} arts, {len(master)} master pack cards from AppMedia")
        if out["unknown_prints"]:
            self.stdout.write(f"  prints not in the card DB: {out['unknown_prints'][:20]}")
        if out["unknown_kinds"]:
            self.stdout.write(f"  kinds left out: {out['unknown_kinds']}")
