"""Regenerate lookup tables whenever deck data changes.

The tendency test reads pre-generated lookup tables; if they go stale after a
deck edit, valid-looking answer keys 404 on /api/deck/result. Debounced so a
burst of admin edits triggers one regeneration.
"""
import logging
import sys
import threading

from django.db.models.signals import m2m_changed, post_delete, post_save

log = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 10
_timer = None
_timer_lock = threading.Lock()


def _regenerate_all():
    from user.models import User
    from .management.commands.generate_lookup import generate_lookup_table, save_lookup_table
    try:
        save_lookup_table(generate_lookup_table(), "lookup_table.json")
        for user in User.objects.filter(use_custom_lookup=True):
            excluded = list(user.owned_decks.values_list("id", flat=True))
            if excluded:
                save_lookup_table(generate_lookup_table(excluded), f"lookup_table_{user.id}.json")
        log.info("Lookup tables regenerated after deck change")
    except Exception:
        log.exception("Lookup table regeneration failed")


def schedule_lookup_regeneration(**kwargs):
    if "test" in sys.argv:
        return
    # num_views is bumped on every result view; that never affects the tables.
    update_fields = kwargs.get("update_fields")
    if update_fields and set(update_fields) <= {"num_views"}:
        return
    action = kwargs.get("action")
    if action is not None and action not in ("post_add", "post_remove", "post_clear"):
        return
    global _timer
    with _timer_lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(DEBOUNCE_SECONDS, _regenerate_all)
        _timer.daemon = True
        _timer.start()


def connect_signals():
    from .models import Deck
    post_save.connect(schedule_lookup_regeneration, sender=Deck, dispatch_uid="deck-lut-save")
    post_delete.connect(schedule_lookup_regeneration, sender=Deck, dispatch_uid="deck-lut-delete")
    m2m_changed.connect(schedule_lookup_regeneration, sender=Deck.summoning_methods.through, dispatch_uid="deck-lut-sm")
    m2m_changed.connect(schedule_lookup_regeneration, sender=Deck.performance_tags.through, dispatch_uid="deck-lut-ptag")
    m2m_changed.connect(schedule_lookup_regeneration, sender=Deck.aesthetic_tags.through, dispatch_uid="deck-lut-atag")
