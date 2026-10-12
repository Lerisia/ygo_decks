import { useState } from "react";

type DetectionResult = {
  card_name: string;
  confidence: number;
  card_image: string;
};

type ApiResponse = {
  boxed_image: string;
  result: DetectionResult[];
};

// One scanner for a deck list and for a single card (엘리스 10/12: the card scanner went into this one); guests may
// use it too, once every ten seconds.
export default function AIScanner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [deckResults, setDeckResults] = useState<DetectionResult[] | null>(null);
  const [boxedImage, setBoxedImage] = useState<string | null>(null);

  const handleDeckUpload = async () => {
    if (!deckFile) return;
    setLoading(true);
    setError("");
    setDeckResults(null);
    setBoxedImage(null);

    const formData = new FormData();
    formData.append("image", deckFile);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("/api/classify-deck/", {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error && res.status === 429 ? data.error : "오류가 발생했습니다.");
        return;
      }
      setDeckResults((data as ApiResponse).result || []);
      setBoxedImage((data as ApiResponse).boxed_image);
    } catch {
      setError("오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 pt-6 pb-4 md:px-8 md:pb-8 max-w-4xl mx-auto">
      <div className="max-w-lg md:max-w-xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-center mb-4">덱 스캐너</h1>
          <p className="text-center text-gray-700 dark:text-gray-300 mb-6 text-base md:text-lg">
            유희왕 마스터 듀얼 '덱 리스트' 사진을 올려주세요.
            <br />
            카드 한 장 사진이나 일러스트만 있는 사진도 됩니다.
          </p>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 md:p-5 mb-6 text-base md:text-base space-y-1">
            <p className="text-gray-600 dark:text-gray-400">
              ⚠️ 지나친 저화질, 어둡게 표시된 미보유 카드는 인식이 어렵습니다.
            </p>
            <p className="text-red-600 dark:text-red-400">
              ⚠️ 덱 리스트 오른쪽에 보유 중인 다른 카드가 보이면 안 됩니다!
            </p>
          </div>

          <label className="block mb-4">
            <div className="flex items-center justify-center w-full h-32 md:h-40 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {deckFile ? (
                  <p className="text-base font-medium text-gray-700 dark:text-gray-300">{deckFile.name}</p>
                ) : (
                  <>
                    <p className="text-2xl md:text-3xl mb-1">📁</p>
                    <p className="text-base">클릭하여 이미지 선택</p>
                  </>
                )}
              </div>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setDeckFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>

          <button
            onClick={handleDeckUpload}
            disabled={!deckFile || loading}
            className={`w-full py-3 rounded-lg font-semibold md:text-lg transition ${
              !deckFile || loading
                ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {loading ? "분석 중..." : "분석하기"}
          </button>

          {error && <p className="text-red-600 mt-4 text-center md:text-lg">{error}</p>}

          {boxedImage && (
            <div className="mt-8">
              <h2 className="text-lg md:text-xl font-semibold mb-3">감지된 카드 위치</h2>
              <img
                src={boxedImage}
                alt="감지된 카드"
                className="w-full max-h-[500px] object-contain border rounded-lg shadow"
              />
            </div>
          )}

          {deckResults && deckResults.length === 0 && (
            <p className="mt-8 text-center text-gray-600 dark:text-gray-400 md:text-lg">카드를 찾지 못했습니다.</p>
          )}

          {deckResults && deckResults.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg md:text-xl font-semibold mb-4">분석 결과</h2>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                {deckResults.map((r, idx) => (
                  <div
                    key={idx}
                    className="border dark:border-gray-700 p-2 rounded-lg shadow-sm bg-white dark:bg-gray-800 flex flex-col items-center text-center"
                  >
                    <img
                      src={r.card_image}
                      alt={r.card_name}
                      className="w-full aspect-[2/3] object-cover rounded mb-2"
                    />
                    <p className="font-semibold text-xs md:text-sm">{r.card_name}</p>
                    <p
                      className={`text-xs md:text-sm ${
                        r.confidence < 30
                          ? "text-red-600"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {r.confidence.toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
