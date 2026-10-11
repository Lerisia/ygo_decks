from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Rebuild 서포트 (cards naming a 카드군 or a card they are not part of) from the Japanese texts and the groups."

    def handle(self, *args, **opts):
        from carddb.support import compute, save
        self.stdout.write(str(save(compute())))
