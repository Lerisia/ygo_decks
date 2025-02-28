from django.db import models
from deck.models import Deck

class UserResponse(models.Model):
    session_id = models.CharField(max_length=255, null=True, blank=True)
    date = models.DateTimeField(auto_now_add=True)
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE)
    answers = models.JSONField()
    
    class Meta:
        ordering = ['-date']

    def __str__(self):
        return f"Response by {self.session_id} on {self.date} - Deck: {self.deck.name}"
