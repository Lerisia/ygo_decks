from django.test import TestCase

from card.models import Card as Old, CardEffectTag
from carddb.models import Card, LegacyCard

from .copy import copy_site_data
from .models import EffectTag, LegacyTheme, Yugipedia


class CopySiteDataTest(TestCase):
    def test_copies_from_the_base_art_row(self):
        Card.objects.create(id=4041, category="monster", name_ja="ブラック・マジシャン", frame="normal")
        alt = Old.objects.create(card_id="4602257801", konami_id="4041", name="Dark Magician", archetype="Wrong", yugipedia_misc=["wrong"])
        base = Old.objects.create(card_id="4602257800", konami_id="4041", name="Dark Magician", archetype="Dark Magician",
                                  korean_archetype="블랙 매지션", yugipedia_archseries=["Dark Magician"], yugipedia_misc=["Normal Monster"])
        CardEffectTag.objects.create(card=base, destroys=True, cat_draw=True, manually_reviewed=True)
        CardEffectTag.objects.create(card=alt, searches=True)
        LegacyCard.objects.create(old_id=alt.id, old_card_id=alt.card_id, card_id=4041, how="konami")
        LegacyCard.objects.create(old_id=base.id, old_card_id=base.card_id, card_id=4041, how="konami")
        self.assertEqual(copy_site_data(), {"themes": 1, "yugipedia": 1, "effect_tags": 1})
        self.assertEqual((LegacyTheme.objects.get(card_id=4041).archetype, LegacyTheme.objects.get(card_id=4041).archetype_ko), ("Dark Magician", "블랙 매지션"))
        yp = Yugipedia.objects.get(card_id=4041)
        self.assertEqual((yp.archseries, yp.misc, yp.actions), (["Dark Magician"], ["Normal Monster"], []))
        tag = EffectTag.objects.get(card_id=4041)
        self.assertEqual((tag.destroys, tag.cat_draw, tag.searches, tag.manually_reviewed), (True, True, False, True))
        self.assertEqual(copy_site_data()["effect_tags"], 1)

    def test_fills_what_the_base_row_lacks_from_the_other_art_rows(self):
        Card.objects.create(id=11708, category="monster", name_ja="屋敷わらし", frame="effect")
        base = Old.objects.create(card_id="5943893000", konami_id="11708", name="Ghost Belle", archetype="Ghost Belle", yugipedia_misc=["Hand trap"])
        late = Old.objects.create(card_id="5943893003", konami_id="11708", name="Ghost Belle", archetype="Other", korean_archetype="요괴소녀",
                                  yugipedia_archseries=["Yo-kai Girl"], yugipedia_misc=["late"])
        CardEffectTag.objects.create(card=late, hand_trap=True)
        for row in (late, base):
            LegacyCard.objects.create(old_id=row.id, old_card_id=row.card_id, card_id=11708, how="konami")
        copy_site_data()
        theme = LegacyTheme.objects.get(card_id=11708)
        self.assertEqual((theme.archetype, theme.archetype_ko), ("Ghost Belle", "요괴소녀"))
        yp = Yugipedia.objects.get(card_id=11708)
        self.assertEqual((yp.archseries, yp.misc), (["Yo-kai Girl"], ["Hand trap"]))
        self.assertTrue(EffectTag.objects.get(card_id=11708).hand_trap)
