# Generated by Django 5.1.6 on 2025-02-28 05:55

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('deck', '0020_alter_deck_aesthetic_tags_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='aesthetictag',
            name='description',
            field=models.TextField(blank=True, help_text='Enter a brief description of this tag.'),
        ),
        migrations.AddField(
            model_name='performancetag',
            name='description',
            field=models.TextField(blank=True, help_text='Enter a brief description of this tag.'),
        ),
    ]
