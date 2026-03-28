import { useTracker } from "@/context/TrackerContext";
import { useNavigate } from "react-router-dom";
import { getRankLabel } from "@/lib/rankUtils";

export default function TrackerBanner() {
  const t = useTracker();
  const navigate = useNavigate();

  if (!t.isTracking || t.pendingSave) return null;

  return (
    <button
      onClick={() => navigate("/tracker")}
      className="fixed top-0 left-0 right-0 z-[90] bg-green-600 text-white text-xs py-1.5 text-center sm:hidden"
    >
      트래킹 중
      {t.useRank && t.currentRank && (
        <span className="ml-2 opacity-80">
          {getRankLabel(t.currentRank)} {t.currentWins !== null ? `${t.currentWins}승` : ""}
        </span>
      )}
      {t.savedCount > 0 && (
        <span className="ml-2 opacity-80">{t.savedCount}전 기록됨</span>
      )}
    </button>
  );
}
