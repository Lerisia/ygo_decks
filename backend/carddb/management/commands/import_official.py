from django.core.management.base import BaseCommand

from carddb.importer import import_official


class Command(BaseCommand):
    help = "Fill the card DB from the crawled official card DB (products_<lang>.json and raw/<lang>/<pid>.html.gz under --dir)."

    def add_arguments(self, parser):
        parser.add_argument("--dir", required=True)
        parser.add_argument("--lang", required=True, choices=["ja", "ko", "en"])

    def handle(self, *args, **opts):
        self.stdout.write(str(import_official(opts["dir"], opts["lang"])))
