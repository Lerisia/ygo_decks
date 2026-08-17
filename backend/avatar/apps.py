from django.apps import AppConfig


class AvatarConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'avatar'

    def ready(self):
        # Wire up the Card.card_illust → CardIcon.cropped_image
        # auto-regeneration signal once both apps are loaded.
        from . import models as _avatar_models
        _avatar_models._connect_card_signals()
