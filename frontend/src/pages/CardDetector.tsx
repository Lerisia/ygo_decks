import { useEffect, useState } from "react";

export default function CardClassifier() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    card_id: string;
    image_url: string;
    confidence: number;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      const res = await fetch("/api/predict-card/", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("예측 실패");

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError("예측 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">카드 이름 판별기</h1>
      <div className="text-red-600 mb-4 text-center">
        아래와 같이 카드의 "일러스트만" 넣어주세요.
        <div className="mt-2 flex justify-center">
            <img
            src="/images/haru_urara.PNG"
            alt="일러스트 예시"
            className="h-32 object-contain border rounded shadow"
            />
        </div>
      </div>
      <div className="text-red-600 mb-4 text-center">
        카드 테두리, 금제, 레어도 뱃지 등이 튀어나오면 인식이 되지 않을 수 있습니다. 안 보이도록 살짝 작게 잘라서 업로드해주세요.
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        className="mb-4 w-full"
      />

      <button
        onClick={handleUpload}
        disabled={!selectedFile || isLoading}
        className={`w-full py-2 rounded ${
          isLoading
            ? "bg-gray-400"
            : "bg-blue-500 hover:bg-blue-600 text-white"
        }`}
      >
        {isLoading ? "예측 중..." : "예측하기"}
      </button>

      {error && <p className="text-red-500 mt-4">{error}</p>}

      {result && (
        <div className="mt-6 text-center">
          <p className="text-lg font-semibold">예측 결과:</p>
          <p className="text-xl mt-2">{result.name} ({result.card_id})</p>
          <img
            src={result.image_url}
            alt={result.name}
            className="mt-4 w-59 h-85 object-cover mx-auto rounded shadow"
          />
          <p className="mt-2 text-sm text-gray-700">
            예측 확률: {(result.confidence * 100).toFixed(2)}%
          </p>
        </div>
      )}
    </div>
  );
}
