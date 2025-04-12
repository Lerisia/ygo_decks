import { useState, useEffect } from "react";

type Deck = {
  name: string;
  num_views: number;
  percentage: number;
  cover_image: string | null;
};

function DeckStatisticsTable() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [totalViews, setTotalViews] = useState<number>(0);
  const [totalDecks, setTotalDecks] = useState<number>(0);

  useEffect(() => {
    fetch("/api/statistics/decks/")
      .then((res) => res.json())
      .then((data) => {
        setTotalViews(data.total_views);
        setTotalDecks(data.total_decks);
        setDecks(data.decks);
      });
  }, []);

  return (
    <div className="h-auto min-h-screen p-6 bg-white dark:bg-gray-900 rounded-lg shadow-md">
      <h2 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
        자주 등장한 덱 순위 (2025.04)
      </h2>
      <p className="text-lg md:text-xl lg:text-2xl font-medium text-gray-600 dark:text-gray-400 mb-4">
        총 참여 횟수: <span className="text-blue-500 font-bold">{totalViews.toLocaleString()}</span> | 
        총 덱 개수: <span className="text-green-500 font-bold">{totalDecks.toLocaleString()}</span>
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-700">
              <th className="whitespace-nowrap px-3 py-3 text-center text-sm md:text-lg lg:text-xl font-semibold text-gray-700 dark:text-gray-300">
                순위
              </th>
              <th className="px-6 py-3 text-left text-sm md:text-lg lg:text-xl font-semibold text-gray-700 dark:text-gray-300">
                덱
              </th>
              <th className="px-6 py-3 text-center text-sm md:text-lg lg:text-xl font-semibold text-gray-700 dark:text-gray-300">
                등장 횟수
              </th>
              <th className="px-6 py-3 text-center text-sm md:text-lg lg:text-xl font-semibold text-gray-700 dark:text-gray-300">
                등장 비율
              </th>
            </tr>
          </thead>
          <tbody>
            {decks.map((deck, index) => (
              <tr
                key={index}
                className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition"
              >
                <td className="w-12 px-3 py-2 text-center text-gray-700 dark:text-gray-300 font-bold text-base md:text-lg lg:text-xl">
                  {index + 1}
                </td>
                <td className="px-6 py-2 flex items-center space-x-4 break-keep">
                  {deck.cover_image && (
                    <img
                      src={deck.cover_image}
                      alt={deck.name}
                      className="w-12 h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 object-cover block"
                    />
                  )}
                  <span className="text-gray-800 dark:text-gray-100 font-medium text-base md:text-lg lg:text-xl">
                    {deck.name}
                  </span>
                </td>
                <td className="px-6 py-2 text-center text-gray-700 dark:text-gray-300 font-semibold text-base md:text-lg lg:text-xl">
                  {deck.num_views.toLocaleString()}
                </td>
                <td className="px-6 py-2 text-center text-gray-700 dark:text-gray-300 font-semibold text-base md:text-lg lg:text-xl">
                  {deck.percentage.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DeckStatisticsTable;
