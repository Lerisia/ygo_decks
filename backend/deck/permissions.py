from rest_framework.permissions import BasePermission


def can_edit_deck_book(user):
    """Staff, or an editor (User.is_editor): the one grade that may edit the deck book and nothing else."""
    return bool(user and user.is_authenticated and (user.is_staff or getattr(user, "is_editor", False)))


class CanEditDeckBook(BasePermission):
    def has_permission(self, request, view):
        return can_edit_deck_book(request.user)
