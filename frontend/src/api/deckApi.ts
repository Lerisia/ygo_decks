export type DeckData = {
  id: number;
  name: string;
  cover_image?: string;
  strength: string;
  difficulty: string;
  deck_type: string;
  art_style: string;
  summoning_methods: string[];
  performance_tags: string[];
  aesthetic_tags: string[];
  description: string;
};

export const fetchDeckResult = async (answerKey: string) => {
  try {
    const token = localStorage.getItem("access_token");
    const headers: HeadersInit = token
      ? { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      : { "Content-Type": "application/json" }; // If not logged in

    const response = await fetch(`/api/deck/result?key=${encodeURIComponent(answerKey)}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error("Failed to fetch result");
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching deck result:", error);
    return null;
  }
};

export const getAllDecks = async () => {
  const response = await fetch("/api/deck/");
  return response.json();
};

export const getDeckData = async (deckId: number) => {
  const response = await fetch(`/api/deck/${deckId}/`);
  return response.json();
};