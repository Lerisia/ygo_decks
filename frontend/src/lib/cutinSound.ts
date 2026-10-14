import { openAudio } from "@/lib/webAudio";

/** A summon's attribute sound: `ready` once it is fetched and decoded, `play` starts it at once (엘리스 2026-10-14: the
 *  cut-in waits for it and starts it with its first frame, through Web Audio as the pack opening does — the Audio
 *  element it had, started muted in the tap and stopped again, could be stopped after the real start when the file
 *  came late, and an iPhone could refuse a start made after the tap). */
export type CutinSound = { ready: Promise<void>; play: () => void };

const decoded = new Map<string, Promise<AudioBuffer | null>>();
// half its level (about -6 dB): a tap on a card's page does not expect a sound at full blast (엘리스 2026-10-14)
const VOLUME = 0.5;

/** Call within the tap. */
export function primeCutinSound(attribute: string): CutinSound | null {
  if (!attribute) return null;
  const audio = openAudio();
  if (!audio) return null;
  const key = attribute;
  if (!decoded.has(key)) {
    // a file that failed to come (a deploy restarting the site, a dropped connection) is asked for again next time
    decoded.set(key, fetch(`/media/md_ui/cutin/sound/${attribute}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => audio.decodeAudioData(b))
      .catch(() => {
        decoded.delete(key);
        return null;
      }));
  }
  let buffer: AudioBuffer | null = null;
  const ready = decoded.get(key)!.then((b) => {
    buffer = b;
  });
  return {
    ready,
    play() {
      if (!buffer) return;
      if (audio.state !== "running") audio.resume().catch(() => {});
      const src = audio.createBufferSource();
      const gain = audio.createGain();
      src.buffer = buffer;
      gain.gain.value = VOLUME;
      src.connect(gain).connect(audio.destination);
      src.start();
    },
  };
}
