"""Base class for multiplayer games.

A game owns its own state (stored in Room.game_state JSON) and reacts to player
actions delivered via WebSocket. The actual broadcasting/persistence is handled
by the consumer/REST layer; the game logic is pure.
"""

from typing import Any, Dict


class BaseGame:
    """Subclass per game and register via games.register_game(name, cls)."""

    name: str = "base"  # registry key

    def __init__(self, room, state: Dict[str, Any]):
        self.room = room
        self.state = state or {}

    # --- Lifecycle hooks ---
    def on_start(self) -> Dict[str, Any]:
        """Called when the host starts the game. Return the initial state."""
        return {}

    def on_player_join(self, player_id: int) -> None:
        pass

    def on_player_leave(self, player_id: int) -> None:
        pass

    def on_action(self, player_id: int, action: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a game action from a player. Return a dict to broadcast."""
        return {}

    def on_end(self) -> Dict[str, Any]:
        """Called when the game ends. Return final results."""
        return {}
