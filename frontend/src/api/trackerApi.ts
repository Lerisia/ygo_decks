import { registerPlugin } from '@capacitor/core';

interface DuelTrackerPlugin {
  startTracking(): Promise<{ started: boolean }>;
  stopTracking(): Promise<{ stopped: boolean }>;
  getLatestResult(): Promise<{
    coinToss: string | null;
    duelResult: string | null;
    timestamp: number;
  }>;
}

const DuelTracker = registerPlugin<DuelTrackerPlugin>('DuelTracker');

export default DuelTracker;
