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