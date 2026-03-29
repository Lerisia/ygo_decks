import { registerPlugin } from '@capacitor/core';

interface DuelTrackerPlugin {
  startTracking(): Promise<{ started: boolean }>;
  stopTracking(): Promise<{ stopped: boolean }>;
  getLatestResult(): Promise<{
    coinToss: string | null;
    firstSecond: string | null;
    duelResult: string | null;
    timestamp: number;
    status: string;
    overlayAction?: string | null;
    overlayCoin?: string | null;
    overlayFS?: string | null;
    overlayResult?: string | null;
  }>;
}

const DuelTracker = registerPlugin<DuelTrackerPlugin>('DuelTracker');

export default DuelTracker;
