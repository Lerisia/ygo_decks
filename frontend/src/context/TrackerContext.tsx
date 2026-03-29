import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import DuelTracker from "@/api/trackerApi";
import { addMatchToRecordGroup } from "@/api/toolApi";
import { getAllDecks } from "@/api/deckApi";
import { getNextRankAndWins } from "@/lib/rankUtils";

interface TrackerState {
  isTracking: boolean;
  coinToss: string | null;
  firstSecond: string | null;
  pendingSave: boolean;
  savedCount: number;
  nativeStatus: string;

  selectedGroup: number | null;
  selectedDeck: number | null;
  trackingMode: string; // "rank" | "rating" | "none"
  useRank: boolean;
  currentRank: string;
  currentWins: number | null;

  editCoin: string | null;
  editFS: string | null;
  editResult: string | null;
  previewRank: string;
  previewWins: number | null;

  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  setSelectedGroup: (id: number | null) => void;
  setSelectedDeck: (id: number | null) => void;
  setTrackingMode: (m: string) => void;
  setUseRank: (v: boolean) => void;
  setCurrentRank: (r: string) => void;
  setCurrentWins: (w: number | null) => void;
  setEditCoin: (v: string | null) => void;
  setEditFS: (v: string | null) => void;
  setEditResult: (v: string | null) => void;
  saveMatch: (opponentDeckId: number | null) => Promise<void>;
  dismissConfirmation: () => void;
}

const TrackerContext = createContext<TrackerState | null>(null);

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker must be inside TrackerProvider");
  return ctx;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [isTracking, setIsTracking] = useState(false);
  const [coinToss, setCoinToss] = useState<string | null>(null);
  const [firstSecond, setFirstSecond] = useState<string | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [nativeStatus, setNativeStatus] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<number | null>(null);
  const [trackingMode, setTrackingMode] = useState("none"); // "rank" | "rating" | "none"
  const [useRank, setUseRank] = useState(false);
  const [currentRank, setCurrentRank] = useState("");
  const [currentWins, setCurrentWins] = useState<number | null>(null);

  const [pendingSave, setPendingSave] = useState(false);
  const [editCoin, setEditCoin] = useState<string | null>(null);
  const [editFS, setEditFS] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<string | null>(null);
  const [previewRank, setPreviewRank] = useState("");
  const [previewWins, setPreviewWins] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isNative = Capacitor.isNativePlatform();

  const coinRef = useRef(coinToss);
  const fsRef = useRef(firstSecond);
  coinRef.current = coinToss;
  fsRef.current = firstSecond;

  // Refs for overlay save (need current values in async callback)
  const selectedGroupRef = useRef(selectedGroup);
  const selectedDeckRef = useRef(selectedDeck);
  const useRankRef = useRef(useRank);
  const currentRankRef = useRef(currentRank);
  const currentWinsRef = useRef(currentWins);
  selectedGroupRef.current = selectedGroup;
  selectedDeckRef.current = selectedDeck;
  useRankRef.current = useRank;
  currentRankRef.current = currentRank;
  currentWinsRef.current = currentWins;

  const resetDetection = () => {
    setCoinToss(null);
    setFirstSecond(null);
    setEditCoin(null);
    setEditFS(null);
    setEditResult(null);
  };

  const startTracking = async () => {
    if (!isNative) throw new Error("앱에서만 사용 가능");
    await DuelTracker.startTracking();
    // Send tracking mode to native
    await DuelTracker.setTrackingMode({ mode: trackingMode });
    // Send deck list to native for overlay search
    try {
      const data = await getAllDecks();
      const decks = (data.decks || data).map((d: any) => ({ id: d.id, name: d.name }));
      await DuelTracker.setDeckList({ decks });
    } catch (e) {
      console.warn("Failed to send deck list to native:", e);
    }
    resetDetection();
    setIsTracking(true);
  };

  const stopTracking = async () => {
    await DuelTracker.stopTracking();
    setIsTracking(false);
  };

  const onDuelDetected = useCallback((coin: string | null, fs: string | null, result: string) => {
    setEditCoin(coin);
    setEditFS(fs);
    setEditResult(result);

    if (useRank && currentRank) {
      const { nextRank, nextWins } = getNextRankAndWins(currentRank, currentWins, result as "win" | "lose");
      setPreviewRank(nextRank);
      setPreviewWins(nextWins);
    }

    setPendingSave(true);
  }, [useRank, currentRank, currentWins]);

  const saveMatch = async (opponentDeckId: number | null) => {
    if (!selectedGroup || !selectedDeck || !editResult) return;

    await addMatchToRecordGroup(selectedGroup, {
      deck: selectedDeck,
      opponent_deck: opponentDeckId,
      coin_toss_result: (editCoin === "win" ? "win" : "lose") as "win" | "lose",
      first_or_second: (editFS === "first" ? "first" : "second") as "first" | "second",
      result: editResult as "win" | "lose",
      rank: useRank ? currentRank : undefined,
      wins: useRank ? currentWins : undefined,
    });

    setSavedCount((c) => c + 1);

    if (useRank && previewRank) {
      setCurrentRank(previewRank);
      setCurrentWins(previewWins);
    }

    setPendingSave(false);
    resetDetection();
  };

  // Save from overlay (uses refs for current values)
  const saveFromOverlay = async (coin: string | null, fs: string | null, result: string | null, opponentDeckId?: number, ratingScore?: string | null) => {
    const group = selectedGroupRef.current;
    const deck = selectedDeckRef.current;
    if (!group || !deck || !result) return;

    const oppDeck = (opponentDeckId && opponentDeckId > 0) ? opponentDeckId : null;
    const score = ratingScore ? parseInt(ratingScore, 10) : undefined;

    try {
      await addMatchToRecordGroup(group, {
        deck: deck,
        opponent_deck: oppDeck,
        coin_toss_result: (coin === "win" ? "win" : "lose") as "win" | "lose",
        first_or_second: (fs === "first" ? "first" : "second") as "first" | "second",
        result: result as "win" | "lose",
        rank: useRankRef.current ? currentRankRef.current : undefined,
        wins: useRankRef.current ? currentWinsRef.current : undefined,
        score: score,
        score_type: score ? "rating" : undefined,
      });

      setSavedCount((c) => c + 1);

      if (useRankRef.current && currentRankRef.current) {
        const { nextRank, nextWins } = getNextRankAndWins(
          currentRankRef.current, currentWinsRef.current, result as "win" | "lose"
        );
        setCurrentRank(nextRank);
        setCurrentWins(nextWins);
      }

      resetDetection();
      setPendingSave(false);
    } catch (e) {
      console.error("Overlay save failed:", e);
    }
  };

  const dismissConfirmation = () => {
    setPendingSave(false);
    resetDetection();
  };

  // Global polling
  useEffect(() => {
    if (isTracking) {
      setNativeStatus("폴링 시작됨" + (isNative ? " (네이티브)" : " (웹)"));
      pollRef.current = setInterval(async () => {
        try {
          const result = await DuelTracker.getLatestResult();
          setNativeStatus(result.status || "(폴링 중 - status 비어있음)");

          // Handle overlay actions (save/dismiss from floating UI)
          if (result.overlayAction === "save") {
            await saveFromOverlay(result.overlayCoin ?? null, result.overlayFS ?? null, result.overlayResult ?? null, result.overlayOpponentDeckId, result.ratingScore);
            return;
          }
          if (result.overlayAction === "dismiss") {
            resetDetection();
            setPendingSave(false);
            return;
          }

          // Normal detection polling
          if (result.timestamp > lastTimestamp) {
            setLastTimestamp(result.timestamp);
            if (result.coinToss) setCoinToss(result.coinToss);
            if (result.firstSecond) setFirstSecond(result.firstSecond);
            if (result.duelResult && !pendingSave) {
              onDuelDetected(
                result.coinToss || coinRef.current,
                result.firstSecond || fsRef.current,
                result.duelResult
              );
            }
          }
        } catch (e: any) {
          setNativeStatus("폴링 에러: " + (e?.message || JSON.stringify(e)));
        }
      }, 2000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isTracking, isNative, lastTimestamp, pendingSave, onDuelDetected]);

  return (
    <TrackerContext.Provider value={{
      isTracking, coinToss, firstSecond, pendingSave, savedCount, nativeStatus,
      selectedGroup, selectedDeck, trackingMode, useRank, currentRank, currentWins,
      editCoin, editFS, editResult, previewRank, previewWins,
      startTracking, stopTracking,
      setSelectedGroup, setSelectedDeck, setTrackingMode, setUseRank, setCurrentRank, setCurrentWins,
      setEditCoin, setEditFS, setEditResult,
      saveMatch, dismissConfirmation,
    }}>
      {children}
    </TrackerContext.Provider>
  );
}
