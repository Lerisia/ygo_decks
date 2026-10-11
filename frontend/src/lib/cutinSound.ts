export type CutinSound = { audio: HTMLAudioElement; ready: Promise<void> };

/** The attribute's sound, started muted within the tap (browsers let sound start only from one) and stopped again;
 *  `ready` once that is done, so that the cut-in can play it from the start without the stop cutting it off. */
export function primeCutinSound(attribute: string): CutinSound | null {
  if (!attribute) return null;
  const audio = new Audio(`/media/md_ui/cutin/sound/${attribute}.wav`);
  audio.muted = true;
  const ready = audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
    }, () => {})
    .finally(() => {
      audio.muted = false;
    });
  return { audio, ready };
}
