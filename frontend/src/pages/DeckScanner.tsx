import { useState } from "react";
import { isAuthenticated } from "@/api/accountApi";

type DetectionResult = {
  card_name: string;
  confidence: number;
  card_image: string;
};

type ApiResponse = {
  boxed_image: string;
  result: DetectionResult[];
};

const isLoggedIn = isAuthenticated();

export default function DeckScanner() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [boxedImage, setBoxedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpload = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError("");
    setResults([]);
    setBoxedImage(null);

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
        const token = localStorage.getItem("access_token");

        const res = await fetch("/api/classify-deck/", {
          method: "POST",
          body: formData,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

      if (!res.ok) throw new Error("분석 실패");

      const data: ApiResponse = await res.json();
      setResults(data.result || []);
      setBoxedImage(data.boxed_image);
    } catch (e) {
      setError("오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 max-w-4xl mx-auto flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-6">덱 스캐너 (베타 테스트)</h1>
      <div className="text-center">
        유희왕 마스터 듀얼 '덱 리스트' 사진을 올려주세요.
      </div>
      <div className="text-center mb-4">
        <p>
          단일 카드는{" "}
          <a href="/card-detector" className="underline">
            링크
          </a>
          에서 따로 판별 가능합니다.
        </p>
      </div>
      <div className="text-blue-600 mb-4 text-center">
        지나친 저화질, 어둡게 표시된 미보유 카드, 일부 샤인/로얄 인식 불가
      </div>
      <div className="text-red-600 text-center">
        주의: 덱 리스트 오른쪽에 보유 중인 다른 카드가 보이면 안 됩니다!
      </div>
      <div className="text-red-600 mb-4 text-center">
        연속 요청 방지를 위해 10초당 1회만 사용 가능합니다.
      </div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        className="mb-4 text-center w-full"
      />
        {!isLoggedIn && (
        <p className="text-red-600 mt-4 text-center">
            로그인 후 이용해 주세요.
        </p>
        )}

    <button
    onClick={handleUpload}
    disabled={!selectedFile || loading || !isLoggedIn}
    className={`w-full max-w-[300px] mx-auto py-2 rounded ${
        loading || !isLoggedIn
        ? "bg-gray-400"
        : "bg-blue-600 hover:bg-blue-700 text-white"
    }`}
    >
    {loading ? "분석 중..." : "이미지 업로드 및 분석"}
    </button>


      {error && <p className="text-red-600 mt-4">{error}</p>}

      {boxedImage && (
        <div className="mt-6 w-full">
          <h2 className="text-xl font-semibold mb-2">감지된 카드 위치</h2>
          <img
            src={boxedImage}
            alt="감지된 카드"
            className="w-full max-h-[500px] object-contain border rounded shadow"
          />
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-8 w-full">
          <h2 className="text-xl font-semibold mb-4">분석 결과:</h2>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
            {results.map((r, idx) => (
              <div
                key={idx}
                className="border p-3 rounded shadow bg-white flex flex-col items-center text-center"
              >
                <img
                  src={r.card_image}
                  alt={r.card_name}
                  className="w-full aspect-[2/3] object-cover rounded mb-2"
                />
                <p className="font-semibold text-sm">{r.card_name}</p>
                <p
                  className={`text-sm ${
                    r.confidence < 30 ? "text-red-600" : "text-gray-700"
                  }`}
                  >
                  확신도: {r.confidence.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
