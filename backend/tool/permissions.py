"""Who may read or write a record sheet.

A sheet is owned by `RecordGroup.user`; shared sheets add `RecordGroupMember` rows on top,
so nothing about existing solo sheets changes.
"""
from .models import RecordGroupMember

OWNER, EDITOR, VIEWER, PUBLIC, ADMIN = "owner", "editor", "viewer", "public", "admin"
_NEEDS = {
    "view": {OWNER, EDITOR, VIEWER, PUBLIC, ADMIN},
    "write": {OWNER, EDITOR},
    "manage": {OWNER},
}


def role_of(user, group):
    if group is None:
        return None
    if user is not None and getattr(user, "is_authenticated", False):
        if group.user_id == user.id:
            return OWNER
        role = (RecordGroupMember.objects.filter(record_group=group, user=user)
                .values_list("role", flat=True).first())
        if role:
            return role
        if group.is_public:
            return PUBLIC
        # Site staff may read any sheet for support and moderation, never write to one.
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return ADMIN
    return PUBLIC if group.is_public else None


def allows(role, need):
    return role in _NEEDS[need]


def user_brief(u):
    """Contributor chip: name plus the icon/border they have equipped."""
    if u is None:
        return None
    icon = u.avatar_icon
    border = u.equipped_border
    return {
        "id": u.id,
        "username": u.username,
        "icon": icon.cropped_image.url if icon and icon.cropped_image else None,
        "border": border.key if border else None,
    }
