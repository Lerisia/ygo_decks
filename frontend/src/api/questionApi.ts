// Get questions from BE
export const fetchQuestions = async () => {
  try {
    const response = await fetch(`/api/get_questions/`);
    if (!response.ok) throw new Error("Failed to fetch questions");
    const data = await response.json();
    return data.questions;
  } catch (error) {
    console.error("Error fetching questions:", error);
    return [];
  }
};
export type RecommendStep = {
  candidate_count: number;
  resolved: boolean;
  available: Record<string, number[]>;
};

// Candidate count + viable options for the current answers (replaces the lookup table).
export const fetchRecommendStep = async (answerKey: string): Promise<RecommendStep> => {
  const token = localStorage.getItem("access_token");
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`/api/deck/recommend/step?key=${encodeURIComponent(answerKey)}`, { headers });
  if (!response.ok) throw new Error(`Failed to fetch recommend step: ${response.status}`);
  return response.json();
};
