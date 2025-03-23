import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchTournamentDetails, Tournament } from "../api/tournamentApi";
import { isAdmin, isAuthenticated } from "../api/accountApi";

export default function TournamentDetail() {
    const { tournamentId } = useParams<{ tournamentId: string }>();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [admin, setAdmin] = useState<boolean>(false);
    const [loggedIn, setLoggedIn] = useState<boolean>(false);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        if (tournamentId) {
            fetchTournamentDetails(tournamentId)
                .then(setTournament)
                .catch(error => console.error("Error fetching tournament details:", error));
        }
    }, [tournamentId]);

    useEffect(() => {
        isAdmin()
            .then(setAdmin)
            .catch(error => console.error("Error checking admin status:", error));

        setLoggedIn(isAuthenticated());
    }, []);

    if (!tournament) return <div className="h-auto min-h-screen p-4">Loading...</div>;

    return (
        <div className="h-auto min-h-screen p-4">
            <h1 className="text-3xl font-bold mb-2 text-center">{tournament.edition ? `제 ${tournament.edition}회 ${tournament.name}` : tournament.name}</h1>
            {tournament.cover_image && (
                <img src={tournament.cover_image} alt={tournament.name} className="w-full h-48 md:h-64 object-contain rounded mb-4" />
            )}
            <p className="text-lg text-gray-600 mb-2 text-center">
                일시: {new Date(tournament.event_date).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-gray-800 mb-4 text-center">{tournament.description || "설명이 없습니다."}</p>
            <p className={`text-lg font-semibold mb-4 text-center ${
                tournament.status === 'ongoing' ? 'text-green-500' :
                tournament.status === 'completed' ? 'text-gray-500' :
                'text-blue-500'
            }`}>
                {tournament.status === 'ongoing' ? '진행 중' :
                tournament.status === 'completed' ? '종료' :
                '시작 전'}
            </p>

            <div className="flex justify-center gap-4">
                {tournament.status === 'upcoming' && (
                    loggedIn ? (
                        <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
                            참가 신청
                        </button>
                    ) : (
                        <div className="relative group">
                            <button className="px-4 py-2 bg-gray-400 text-white rounded cursor-not-allowed" disabled>
                                참가 신청
                            </button>
                            <span className="absolute left-1/2 transform -translate-x-1/2 mt-2 w-48 text-center text-xs text-gray-700 bg-gray-100 p-2 rounded shadow opacity-0 group-hover:opacity-100 transition">
                                로그인한 유저만 참가 신청할 수 있습니다
                            </span>
                        </div>
                    )
                )}

                {(tournament.is_host || admin) && (
                    <button className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition">
                        대회 관리
                    </button>
                )}
            </div>
        </div>
    );
}
