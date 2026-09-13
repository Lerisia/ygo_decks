"""Helpers for the per-deck featured YouTube video (see DeckFeaturedVideo)."""


def default_thumbnail(video_id):
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def serialize_featured(fv):
    return {
        "video_id": fv.video_id,
        "title": fv.title,
        "url": fv.url,
        "channel": fv.channel,
        "channel_url": fv.channel_url,
        "lang": fv.lang,
        "lang_label": fv.get_lang_display(),
        "thumbnail_url": fv.thumbnail_url or default_thumbnail(fv.video_id),
        "view_count": fv.view_count,
        "published_at": fv.published_at.isoformat() if fv.published_at else None,
        "duration": fv.duration,
        "note": fv.note,
    }
