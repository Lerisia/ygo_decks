import { useNavigate } from "react-router-dom";
import { MENU_GROUPS } from "@/lib/siteMenu";

const ICONS: Record<string, string> = { "/deck-scanner": "🪄", "/tier-list-maker": "📊" };

/** 도구: the convenience tools, one tile each (more will join this group). */
function Tools() {
  const navigate = useNavigate();
  const tools = MENU_GROUPS.find((g) => g.key === "tools")?.items ?? [];

  return (
    <div className="min-h-screen px-0 sm:px-4 py-6 md:py-10 max-w-lg md:max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-4xl font-bold text-center mb-2">도구</h1>
      <p className="text-center text-gray-500 dark:text-gray-400 mb-6 md:mb-8 text-sm md:text-base">덱을 고르고 정리할 때 쓰는 도구</p>
      <div className="grid grid-cols-2 gap-4 md:gap-6 px-4 sm:px-0">
        {tools.map((t) => (
          <button
            key={t.to}
            onClick={() => navigate(t.to)}
            className="flex flex-col items-center justify-center p-5 md:p-8 bg-white dark:bg-gray-800 rounded-xl shadow hover:shadow-md transition text-center"
          >
            <span className="text-3xl md:text-5xl mb-2">{ICONS[t.to] ?? "🧰"}</span>
            <span className="font-semibold md:text-lg">{t.label}</span>
            <span className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Tools;
