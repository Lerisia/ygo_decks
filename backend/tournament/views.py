from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Tournament
from .serializers import TournamentSerializer

class TournamentCreateView(generics.CreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    # permission_classes = [permissions.IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def perform_create(self, serializer):
        serializer.save(host=self.request.user)
        return Response(serializer.data)
    
class TournamentDetailView(generics.RetrieveAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer

    def get(self, request, *args, **kwargs):
        tournament = self.get_object()
        is_host = request.user == tournament.host if request.user.is_authenticated else False
        data = self.get_serializer(tournament).data
        data["is_host"] = is_host
        return Response(data)

class TournamentListView(generics.ListAPIView):
    queryset = Tournament.objects.all().order_by('-event_date')
    serializer_class = TournamentSerializer
    permission_classes = [permissions.AllowAny]
    
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .models import Bracket, BracketParticipant, BracketMatch
from django.db.models import Q
import random


@api_view(['POST'])
def create_bracket(request):
    name = request.data.get('name')
    type = request.data.get('type')
    participants = request.data.get('participants', [])

    if type not in dict(Bracket.TOURNAMENT_TYPES):
        return Response({'error': 'Invalid bracket type.'}, status=400)

    bracket = Bracket.objects.create(name=name, type=type)

    for pname in participants:
        BracketParticipant.objects.create(bracket=bracket, name=pname)

    return Response({'bracket_id': bracket.id}, status=201)


@api_view(['GET'])
def get_bracket_detail(request, bracket_id):
    try:
        bracket = Bracket.objects.get(id=bracket_id)
    except Bracket.DoesNotExist:
        return Response({'error': 'Bracket not found.'}, status=404)

    participants = list(bracket.participants.values('id', 'name', 'wins', 'losses', 'draws'))
    matches = list(bracket.matches.values('round', 'player1__name', 'player2__name', 'result'))

    return Response({
        'bracket': {
            'id': bracket.id,
            'name': bracket.name,
            'type': bracket.type,
            'round': bracket.round,
            'participants': participants,
            'matches': matches
        }
    })


@api_view(['GET'])
def generate_next_pairings(request, bracket_id):
    try:
        bracket = Bracket.objects.get(id=bracket_id)
    except Bracket.DoesNotExist:
        return Response({'error': 'Bracket not found.'}, status=404)

    round_num = bracket.round

    if bracket.type == 'swiss':
        participants = list(bracket.participants.all())
        participants.sort(key=lambda p: (-p.wins, -p.draws, p.name))
        paired_ids = set()
        new_matches = []

        for i in range(0, len(participants) - 1, 2):
            p1 = participants[i]
            p2 = participants[i + 1]

            already_played = BracketMatch.objects.filter(
                bracket=bracket, round__lt=round_num
            ).filter(
                Q(player1=p1, player2=p2) | Q(player1=p2, player2=p1)
            ).exists()

            if already_played:
                continue

            match = BracketMatch.objects.create(
                bracket=bracket,
                round=round_num,
                player1=p1,
                player2=p2
            )
            new_matches.append({'player1': p1.name, 'player2': p2.name})
            paired_ids.update([p1.id, p2.id])

        bracket.round += 1
        bracket.save()

        return Response({'pairings': new_matches})

    elif bracket.type == 'single_elim':
        round_matches = BracketMatch.objects.filter(bracket=bracket, round=round_num)
        if round_matches.exists():
            return Response({'error': 'Round already exists'}, status=400)

        if round_num == 1:
            participants = list(bracket.participants.all())
            random.shuffle(participants)
        else:
            prev_matches = BracketMatch.objects.filter(bracket=bracket, round=round_num - 1)
            participants = []
            for match in prev_matches:
                if match.result == 'P1':
                    participants.append(match.player1)
                elif match.result == 'P2':
                    participants.append(match.player2)

        new_matches = []
        for i in range(0, len(participants) - 1, 2):
            m = BracketMatch.objects.create(
                bracket=bracket,
                round=round_num,
                player1=participants[i],
                player2=participants[i + 1]
            )
            new_matches.append({'player1': m.player1.name, 'player2': m.player2.name})

        bracket.round += 1
        bracket.save()

        return Response({'pairings': new_matches})

    return Response({'error': 'Unsupported bracket type'}, status=400)


@api_view(['POST'])
def submit_match_result(request, bracket_id):
    match_id = request.data.get('match_id')
    result = request.data.get('result')

    try:
        match = BracketMatch.objects.get(id=match_id, bracket_id=bracket_id)
    except BracketMatch.DoesNotExist:
        return Response({'error': 'Match not found.'}, status=404)

    if result not in ['P1', 'P2', 'DRAW']:
        return Response({'error': 'Invalid result.'}, status=400)

    match.result = result
    match.save()

    if match.bracket.type == 'swiss':
        p1 = match.player1
        p2 = match.player2
        if result == 'P1':
            p1.wins += 1
            p2.losses += 1
        elif result == 'P2':
            p2.wins += 1
            p1.losses += 1
        else:
            p1.draws += 1
            p2.draws += 1
        p1.save()
        p2.save()

    return Response({'message': 'Result saved.'})


@api_view(['GET'])
def get_standings(request, bracket_id):
    try:
        bracket = Bracket.objects.get(id=bracket_id)
    except Bracket.DoesNotExist:
        return Response({'error': 'Bracket not found.'}, status=404)

    if bracket.type != 'swiss':
        return Response({'error': 'Standings only available for Swiss type.'}, status=400)

    participants = bracket.participants.all().order_by('-wins', '-draws', 'name')
    result = [{
        'name': p.name,
        'wins': p.wins,
        'draws': p.draws,
        'losses': p.losses
    } for p in participants]

    return Response({'standings': result})


@api_view(['GET'])
def get_bracket_tree(request, bracket_id):
    try:
        bracket = Bracket.objects.get(id=bracket_id)
    except Bracket.DoesNotExist:
        return Response({'error': 'Bracket not found.'}, status=404)

    if bracket.type != 'single_elim':
        return Response({'error': 'Bracket tree only available for single elimination.'}, status=400)

    matches = bracket.matches.all().order_by('round', 'id')
    tree = [{
        'round': m.round,
        'player1': m.player1.name,
        'player2': m.player2.name,
        'result': m.result
    } for m in matches]

    return Response({'tree': tree})
