from django.db import models
from django.contrib.auth import get_user_model
from datetime import datetime, timezone

User = get_user_model()

class Tournament(models.Model):
    STATUS_CHOICES = [
        ('upcoming', '시작 전'),
        ('ongoing', '진행 중'),
        ('completed', '종료'),
    ]
    
    name = models.CharField(max_length=255)
    edition = models.IntegerField(blank=True, null=True)
    cover_image = models.ImageField(upload_to='tournament_covers/', blank=True, null=True)
    host = models.ForeignKey(User, on_delete=models.CASCADE, related_name='hosted_tournaments')
    description = models.TextField(blank=True, null=True)
    event_date = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='upcoming')

    def __str__(self):
        return self.name

class DeckPhoto(models.Model):
    image = models.ImageField(upload_to='deck_photos/')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='deck_photos')

    def __str__(self):
        return f"Deck Photo by {self.uploaded_by.username}"

class Participant(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('forfeited', 'Forfeited'),
        ('eliminated', 'Eliminated'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tournament_participations')
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name='participants')
    deck_photos = models.ManyToManyField(DeckPhoto, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='active')
    
    def __str__(self):
        return f"{self.user.username} in {self.tournament.name} ({self.status})"

class GroupStage(models.Model):
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name='group_stages')
    name = models.CharField(max_length=50)
    participants = models.ManyToManyField(Participant, related_name='groups')
    matches = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.tournament.name} - {self.name}"

class Bracket(models.Model):
    TOURNAMENT_TYPES = [
        ('swiss', 'Swiss'),
        ('single_elim', 'Single Elimination'),
        ('round_robin', 'Round Robin'),
        ('random', 'Random Matchups'),
        ('group_stage', 'Group Stage'),
    ]
    
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name='brackets')
    group_stage = models.ForeignKey(GroupStage, on_delete=models.CASCADE, related_name='brackets', null=True, blank=True)
    round = models.IntegerField()
    type = models.CharField(max_length=20, choices=TOURNAMENT_TYPES)
    matches = models.JSONField(default=dict)
    
    def __str__(self):
        return f"{self.tournament.name} - Round {self.round} ({self.type})"
