from django.apps import AppConfig


class DeckConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'deck'

    def ready(self):
        from .signals import connect_signals
        connect_signals()
