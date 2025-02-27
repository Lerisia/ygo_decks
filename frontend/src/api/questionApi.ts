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