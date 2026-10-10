from django.core.management.base import BaseCommand

from carddb.importer import import_art


class Command(BaseCommand):
    help = "Link card art saved by mdpipeline/extract_art.py (manifest.json keys like common/4007) to MD prints; --prefix is the path under MEDIA_ROOT."

    def add_arguments(self, parser):
        parser.add_argument("--manifest", required=True)
        parser.add_argument("--prefix", default="cards/art")

    def handle(self, *args, **opts):
        self.stdout.write(str(import_art(opts["manifest"], opts["prefix"])))
