const API_URL = "/api/tournament/";

export interface Tournament {
  id: number;
  name: string;
  edition?: number;
  cover_image?: string;
  event_date: string;
  description?: string;
  status: string;
  is_host?: boolean;
}

export const fetchTournaments = async (): Promise<Tournament[]> => {
    try {
        const response = await fetch(API_URL, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error("Error fetching tournaments");
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching tournaments:", error);
        throw error;
    }
};

export const fetchTournamentDetails = async (id: string | number): Promise<Tournament> => {
    try {
        const response = await fetch(`${API_URL}${id}/`, {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error("Error fetching tournament details");
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching tournament details:", error);
        throw error;
    }
};

export const createTournament = async (formData: {
    name: string;
    edition?: string;
    cover_image: File | null;
    description: string;
    event_date: string;
}) => {
    const token = localStorage.getItem("access_token");

    const data = new FormData();
    data.append("name", formData.name);
    if (formData.edition) data.append("edition", formData.edition);
    if (formData.cover_image) data.append("cover_image", formData.cover_image);
    if (formData.description) data.append("description", formData.description);
    data.append("event_date", formData.event_date);
    data.append("status", "upcoming");

    const response = await fetch("/api/tournament/create", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
        },
        body: data,
    });

    if (!response.ok) {
        return await response.json();

    }
};
