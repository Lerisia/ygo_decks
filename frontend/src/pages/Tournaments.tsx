import { useEffect, useState } from "react";
import { fetchTournaments, Tournament } from "../api/tournamentApi";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";

export default function TournamentList() {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [loggedIn, setLoggedIn] = useState<boolean>(false);
    const navigate = useNavigate();
    
    useEffect(() => {
        fetchTournaments()
            .then((data) => {
                console.log("Fetched tournaments:", data);
                setTournaments(data);
            })
            .catch(error => console.error("Error fetching tournaments:", error));

        // 로그인 상태 확인
        setLoggedIn(isAuthenticated());
    }, []);

    return (
        <div className="h-auto min-h-screen p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">대회 목록</h1>
                {loggedIn ? (
                    <button
                        onClick={() => navigate("/tournaments/create")}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition"
                    >
                        대회 생성
                    </button>
                ) : (
                    <div className="relative group">
                        <button
                            className="px-4 py-2 bg-gray-400 text-white rounded-lg shadow cursor-not-allowed"
                            disabled
                        >
                            대회 생성
                        </button>
                        <span className="absolute left-1/2 transform -translate-x-1/2 mt-2 w-48 text-center text-xs text-gray-700 bg-gray-100 p-2 rounded shadow opacity-0 group-hover:opacity-100 transition">
                            로그인한 유저만 대회를 생성할 수 있습니다
                        </span>
                    </div>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tournaments.map(tournament => (
                    <div 
                        key={tournament.id} 
                        className="border rounded-lg p-4 shadow cursor-pointer hover:shadow-lg transition" 
                        onClick={() => navigate(`/tournaments/${tournament.id}`)}
                    >
                        {typeof tournament.cover_image === "string" && (
                            <img 
                                src={tournament.cover_image} 
                                alt={tournament.name} 
                                className="w-full h-48 object-cover mb-2 rounded" 
                            />
                        )}
                        <h2 
                            className="text-lg font-semibold hover:underline"
                            onClick={(e) => { e.stopPropagation(); navigate(`/tournaments/${tournament.id}`); }}
                        >
                            {tournament.edition ? `제 ${tournament.edition}회 ${tournament.name}` : tournament.name}
                        </h2>
                        <p className="text-sm text-gray-500">
                            일시: {new Date(tournament.event_date).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className={`text-sm font-semibold ${
                            tournament.status === 'ongoing' ? 'text-green-500' :
                            tournament.status === 'completed' ? 'text-gray-500' :
                            'text-blue-500'
                        }`}>
                            {tournament.status === 'ongoing' ? '진행 중' :
                            tournament.status === 'completed' ? '종료' :
                            '시작 전'}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
