# Generated by Django 5.1.6 on 2025-02-27 15:27

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('deck', '0019_remove_deck_tags_delete_tag'),
    ]

    operations = [
        migrations.AlterField(
            model_name='deck',
            name='aesthetic_tags',
            field=models.ManyToManyField(to='deck.aesthetictag'),
        ),
        migrations.AlterField(
            model_name='deck',
            name='performance_tags',
            field=models.ManyToManyField(to='deck.performancetag'),
        ),
    ]
