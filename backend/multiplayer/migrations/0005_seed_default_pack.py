from django.db import migrations


def forwards(apps, schema_editor):
    Pack = apps.get_model("multiplayer", "DuchMindWordPack")
    Word = apps.get_model("multiplayer", "DuchMindWord")
    default = Pack.objects.filter(is_default=True).first()
    if default is None:
        default = Pack.objects.create(
            name="기본 단어장",
            description="시스템이 제공하는 기본 단어장입니다.",
            owner=None,
            is_default=True,
            is_public=True,
        )
    # Move all existing pack=None entries into the default pack
    Word.objects.filter(pack__isnull=True).update(pack=default)


def backwards(apps, schema_editor):
    # Don't undo the seeding; just let the table be removed by schema migration backwards.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("multiplayer", "0004_duchmindwordpack_and_more"),
    ]
    operations = [migrations.RunPython(forwards, backwards)]
