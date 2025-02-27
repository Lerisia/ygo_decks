export type DeckData = {
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
    const response = await fetch(`api/deck?key=${encodeURIComponent(answerKey)}`);
    
    if (!response.ok) {
      throw new Error("Failed to fetch result");
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching deck result:", error);
    return null;
  }
};
