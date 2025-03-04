from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

class Tournament(models.Model):
    class TournamentType(models.TextChoices):
        INDIVIDUAL = "individual", "개인전"
        TEAM = "team", "팀전"

    name = models.CharField(max_length=255, verbose_name="대회 이름")
    edition = models.PositiveIntegerField(verbose_name="대회 회차")
    host = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="주최자")
    tournament_type = models.CharField(
        max_length=10,
        choices=TournamentType.choices,
        default=TournamentType.INDIVIDUAL,
        verbose_name="대회 유형"
    )
    
    def __str__(self):
        return f"{self.name} - 제 {self.edition}회"

    class Meta:
        unique_together = ("name", "edition")

class Team(models.Model):
    name = models.CharField(max_length=255, verbose_name="팀 이름")
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="teams", verbose_name="소속 대회")

    def __str__(self):
        return f"{self.name} ({self.tournament.name} - 제 {self.tournament.edition}회)"

class Participant(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, verbose_name="참가자")
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="participants", verbose_name="소속 대회")
    team = models.ForeignKey(Team, on_delete=models.SET_NULL, blank=True, null=True, related_name="members", verbose_name="소속 팀")

    def __str__(self):
        return f"{self.user.username} - {self.tournament.name} ({self.team.name if self.team else '개인전'})"

    class Meta:
        unique_together = ("user", "tournament")