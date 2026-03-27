import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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

type CardResult = {
  name: string;
  card_id: string;
  image_url: string;
  confidence: number;
};

const tabs = [
  { key: "deck", label: "덱 스캐너" },
  { key: "card", label: "카드 스캐너" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export default function AIScanner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "deck";

  const setTab = (tab: TabKey) => {
    setSearchParams({ tab });
    setDeckFile(null);
    setDeckResults([]);
    setBoxedImage(null);
    setCardFile(null);
    setCardResult(null);
    setError("");
  };

  const isLoggedIn = isAuthenticated();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [deckResults, setDeckResults] = useState<DetectionResult[]>([]);
  const [boxedImage, setBoxedImage] = useState<string | null>(null);

  const [cardFile, setCardFile] = useState<File | null>(null);
  const [cardResult, setCardResult] = useState<CardResult | null>(null);

  const handleDeckUpload = async () => {
    if (!deckFile) return;
    setLoading(true);
    setError("");
    setDeckResults([]);
    setBoxedImage(null);

    const formData = new FormData();
    formData.append("image", deckFile);

    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch("/api/classify-deck/", {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("분석 실패");
      const data: ApiResponse = await res.json();
      setDeckResults(data.result || []);
      setBoxedImage(data.boxed_image);
    } catch {
      setError("오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleCardUpload = async () => {
    if (!cardFile) return;
    setLoading(true);
    setError("");
    setCardResult(null);

    const formData = new FormData();
    formData.append("image", cardFile);

    try {
      const res = await fetch("/api/predict-card/", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("예측 실패");
      const data = await res.json();
      setCardResult(data);
    } catch {
      setError("예측 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 max-w-4xl mx-auto">
      <div className="flex max-w-md mx-auto border-b border-gray-300 dark:border-gray-600 mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`flex-1 py-3 text-center font-semibold transition ${
              activeTab === tab.key
                ? "border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "deck" && (
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold text-center mb-4">덱 스캐너</h1>
          <p className="text-center text-gray-700 dark:text-gray-300 mb-6">
            유희왕 마스터 듀얼 '덱 리스트' 사진을 올려주세요.
          </p>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6 text-sm space-y-1">
            <p className="text-gray-600 dark:text-gray-400">
              ⚠️ 지나친 저화질, 어둡게 표시된 미보유 카드, 일부 샤인/로얄은 인식이 어렵습니다.
            </p>
            <p className="text-red-600 dark:text-red-400">
              ⚠️ 덱 리스트 오른쪽에 보유 중인 다른 카드가 보이면 안 됩니다!
            </p>
          </div>

          <label className="block mb-4">
            <div className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {deckFile ? (
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{deckFile.name}</p>
                ) : (
                  <>
                    <p className="text-2xl mb-1">📁</p>
                    <p className="text-sm">클릭하여 이미지 선택</p>
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

          {!isLoggedIn && (
            <p className="text-red-600 text-sm text-center mb-4">
              로그인 후 이용해 주세요.
            </p>
          )}

          <button
            onClick={handleDeckUpload}
            disabled={!deckFile || loading || !isLoggedIn}
            className={`w-full py-3 rounded-lg font-semibold transition ${
              !deckFile || loading || !isLoggedIn
                ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {loading ? "분석 중..." : "분석하기"}
          </button>

          {error && <p className="text-red-600 mt-4 text-center">{error}</p>}

          {boxedImage && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-3">감지된 카드 위치</h2>
              <img
                src={boxedImage}
                alt="감지된 카드"
                className="w-full max-h-[500px] object-contain border rounded-lg shadow"
              />
            </div>
          )}

          {deckResults.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-4">분석 결과</h2>
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
                    <p className="font-semibold text-xs">{r.card_name}</p>
                    <p
                      className={`text-xs ${
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
      )}

      {activeTab === "card" && (
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold text-center mb-4">카드 스캐너</h1>
          <p className="text-center text-gray-700 dark:text-gray-300 mb-6">
            카드의 일러스트를 올려주세요.
          </p>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
            <div className="flex justify-center mb-3">
              <img
                src="/images/haru_urara.PNG"
                alt="일러스트 예시"
                className="h-28 object-contain rounded shadow"
              />
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              위처럼 일러스트 부분만 넣어주세요.<br />
              카드 테두리, 금제, 레어도 뱃지 등이 보이면 인식이 어려울 수 있습니다.
            </p>
          </div>

          <label className="block mb-4">
            <div className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition">
              <div className="text-center text-gray-500 dark:text-gray-400">
                {cardFile ? (
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{cardFile.name}</p>
                ) : (
                  <>
                    <p className="text-2xl mb-1">📁</p>
                    <p className="text-sm">클릭하여 이미지 선택</p>
                  </>
                )}
              </div>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setCardFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>

          <button
            onClick={handleCardUpload}
            disabled={!cardFile || loading}
            className={`w-full py-3 rounded-lg font-semibold transition ${
              !cardFile || loading
                ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {loading ? "분석 중..." : "분석하기"}
          </button>

          {error && <p className="text-red-500 mt-4 text-center">{error}</p>}

          {cardResult && (
            <div className="mt-8 text-center">
              <h2 className="text-lg font-semibold mb-3">분석 결과</h2>
              <p className="text-xl font-medium">
                {cardResult.name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {cardResult.card_id}
              </p>
              <img
                src={cardResult.image_url}
                alt={cardResult.name}
                className="w-48 mx-auto object-cover rounded-lg shadow"
              />
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                확신도: {(cardResult.confidence * 100).toFixed(1)}%
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
