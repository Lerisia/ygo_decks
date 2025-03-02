import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fetchDeckResult, DeckData } from "../api/deckApi";

// We use Abbreviation for keys because of look-up table size
// But DB has full name of keys so we should convert to full name to get final result
const fieldMapping: { [key: string]: string } = {
  s: "strength",
  d: "difficulty",
  t: "deck_type",
  a: "art_style",
  sm: "summoning_methods",
  ptag: "performance_tags",
  atag: "aesthetic_tags",
};

const expandAnswerKey = (answerKey: string): string => {
  if (answerKey === "empty") return "empty";

  return answerKey
    .split("|")
    .map(pair => {
      const [shortKey, value] = pair.split("=");
      if (!value) return shortKey;
      return `${fieldMapping[shortKey] || shortKey}=${value}`;
    })
    .join("|");
};

function ResultPage() {
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const answerKey = searchParams.get("key") || localStorage.getItem("answerKey");

    if (!answerKey) {
      console.error("No answerKey found");
      navigate("/unauthorized");
      return;
    }

    console.log("Fetching deck result for:", answerKey);
    localStorage.setItem("answerKey", answerKey);

    const finalAnswerKey = answerKey === "empty" ? "empty" : expandAnswerKey(answerKey);

    fetchDeckResult(finalAnswerKey)
      .then((data: DeckData) => {
        console.log("Deck result found:", data);
        setResult(data);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching deck result:", error);
        setError("Failed to fetch deck data.");
        setLoading(false);
      });

    return () => {
      console.log("Cleaning up: Removing answerKey from localStorage");
      localStorage.removeItem("answerKey");
    };
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-3xl font-extrabold">로딩 중...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-3xl font-extrabold text-red-500">오류 발생</h1>
        <p className="text-lg">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 text-center">
      <h1 className="text-3xl font-extrabold">{result?.name}</h1>
      {result?.cover_image && (
        <img src={result.cover_image} alt={result.name} className="mt-4 rounded-lg shadow-md w-full max-w-md mx-auto" />
      )}
      <p className="text-lg font-bold mt-2">성능: {result?.strength}</p>
      <p className="text-lg font-bold">난이도: {result?.difficulty}</p>
      <p className="text-lg font-bold">덱 타입: {result?.deck_type}</p>
      <p className="text-lg font-bold">아트 스타일: {result?.art_style}</p>
      <p className="text-lg font-bold">주요 소환법: {result?.summoning_methods.join(", ")}</p>
      <p className="text-lg font-bold">
        태그: {[
          ...(result?.performance_tags || []),
          ...(result?.aesthetic_tags || [])
        ]
          .filter(tag => tag !== "해당 없음")
          .join(", ")}
      </p>

      <p className="mt-2 text-lg break-keep">{result?.description}</p>
    </div>
  );
}

export default ResultPage;
