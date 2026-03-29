import { registerPlugin } from '@capacitor/core';

interface DuelTrackerPlugin {
  startTracking(): Promise<{ started: boolean }>;
  stopTracking(): Promise<{ stopped: boolean }>;
  setTrackingMode(options: { mode: string }): Promise<{ mode: string }>;
  setRankDisplay(options: { current?: string; preview?: string; rankValue?: string; winsValue?: number }): Promise<{ ok: boolean }>;
  setDeckList(options: { decks: { id: number; name: string }[] }): Promise<{ count: number }>;
  getLatestResult(): Promise<{
    coinToss: string | null;
    firstSecond: string | null;
    duelResult: string | null;
    ratingScore: string | null;
    timestamp: number;
    status: string;
    overlayAction?: string | null;
    overlayCoin?: string | null;
    overlayFS?: string | null;
    overlayResult?: string | null;
    overlayOpponentDeckId?: number;
  }>;
}

const DuelTracker = registerPlugin<DuelTrackerPlugin>('DuelTracker');

export default DuelTracker;
