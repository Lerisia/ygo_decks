"""Game module registry.

Each game is a class that subclasses BaseGame in `base.py` and registers itself
via `register_game(name, cls)`. The Room.current_game string field maps to a
registry key here.
"""

from .base import BaseGame  # noqa: F401

_REGISTRY = {}


def register_game(name, cls):
    if not issubclass(cls, BaseGame):
        raise TypeError(f"{cls} must subclass BaseGame")
    _REGISTRY[name] = cls


def get_game(name):
    return _REGISTRY.get(name)


def list_games():
    return list(_REGISTRY.keys())
