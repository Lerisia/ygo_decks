/** The pack opening's sounds, the game's own (md_ui/packopen/sound). Played through Web Audio, opened within the first
 *  tap, so the ones that follow a tap by a moment (the tear, the cards coming out) still play on a phone. The viewer
 *  can turn them off; that is remembered. */
const BASE = "/media/md_ui/packopen/sound/";
const NAMES = ["01_op", "03_cut", "05_cardout", "card_move_01", "card_sr", "card_ur", "card_shake"] as const;
export type PackSoundName = (typeof NAMES)[number];
const OFF = "pack_sound_off";

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

export function soundOn(): boolean {
  try {
    return localStorage.getItem(OFF) !== "1";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF);
    else localStorage.setItem(OFF, "1");
  } catch {
    /* kept for this page only */
  }
  if (on) unlockPackSound();
}

function load(name: string) {
  if (!ctx) return Promise.resolve(null);
  const audio = ctx;
  if (!buffers.has(name)) {
    buffers.set(name, fetch(`${BASE}${name}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((b) => audio.decodeAudioData(b))
      .catch(() => null));
  }
  return buffers.get(name)!;
}

/** Call within a tap: opens the sound and fetches the sounds. */
export function unlockPackSound() {
  if (!soundOn()) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    NAMES.forEach(load);
  } catch {
    ctx = null;
  }
}

export function playPackSound(name: PackSoundName, volume = 0.8) {
  if (!ctx || !soundOn()) return;
  const audio = ctx;
  load(name).then((buf) => {
    if (!buf) return;
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = buf;
    gain.gain.value = volume;
    src.connect(gain).connect(audio.destination);
    src.start();
  });
}
