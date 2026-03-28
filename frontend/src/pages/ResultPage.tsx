import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fetchDeckResult, DeckData } from "../api/deckApi";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";

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

const statLabels = [
  { key: "consistency", label: "안정성" },
  { key: "breakthrough", label: "돌파력" },
  { key: "interruption", label: "견제력" },
  { key: "recovery", label: "복구력" },
  { key: "deck_space", label: "덱 스페이스" },
] as const;

function ResultPage() {
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<DeckData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const answerKey = searchParams.get("key") || localStorage.getItem("answerKey");

    if (!answerKey) {
      navigate("/unauthorized");
      return;
    }

    localStorage.setItem("answerKey", answerKey);
    const finalAnswerKey = answerKey === "empty" ? "empty" : expandAnswerKey(answerKey);

    fetchDeckResult(finalAnswerKey)
      .then((data: DeckData) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => {
        setError("결과를 불러오지 못했습니다.");
        setLoading(false);
      });

    return () => {
      localStorage.removeItem("answerKey");
    };
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-gray-500 dark:text-gray-400">로딩 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <p className="text-xl font-bold text-red-500">오류 발생</p>
        <p className="text-gray-500 dark:text-gray-400 mt-2">{error}</p>
      </div>
    );
  }

  const hasStats = result?.stats && statLabels.some(({ key }) => result.stats?.[key] != null);
  const chartData = hasStats
    ? statLabels.map(({ key, label }) => ({
        stat: label,
        value: result?.stats?.[key] ?? 0,
      }))
    : [];

  const tags = [
    ...(result?.performance_tags || []),
    ...(result?.aesthetic_tags || []),
  ].filter(tag => tag !== "해당 없음");

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-3xl font-extrabold text-center">{result?.name}</h1>

      {result?.cover_image && (
        <img
          src={result.cover_image}
          alt={result.name}
          className="mt-4 rounded-xl shadow-lg w-full max-w-sm mx-auto"
        />
      )}

      {hasStats && (
        <div className="mt-6 mx-auto">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={chartData}>
              <PolarGrid />
              <PolarAngleAxis
                dataKey="stat"
                tick={({ x, y, payload, index }: any) => {
                  const val = chartData[index]?.value;
                  return (
                    <g>
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-current text-xs">
                        {payload.value}
                      </text>
                      <text x={x} y={y + 14} textAnchor="middle" className="fill-blue-500 text-xs font-bold">
                        {val}
                      </text>
                    </g>
                  );
                }}
              />
              <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
              <Radar dataKey="value" fill="#3b82f6" fillOpacity={0.4} stroke="#3b82f6" />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">덱 파워</span>
          <span className="font-semibold">{result?.strength}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">난이도</span>
          <span className="font-semibold">{result?.difficulty}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">덱 타입</span>
          <span className="font-semibold">{result?.deck_type}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">아트 스타일</span>
          <span className="font-semibold">{result?.art_style}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">소환법</span>
          <span className="font-semibold">{result?.summoning_methods.join(", ")}</span>
        </div>
        {tags.length > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">태그</span>
            <span className="font-semibold text-right">{tags.join(", ")}</span>
          </div>
        )}
      </div>

      {result?.id && (
        <button
          onClick={() => navigate(`/database/${result.id}`)}
          className="mt-6 w-full py-3 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          도감에서 자세히 보기
        </button>
      )}
    </div>
  );
}

export default ResultPage;
