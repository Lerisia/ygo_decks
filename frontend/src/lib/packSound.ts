/** The pack opening's sounds, the game's own (md_ui/packopen/sound). Played through Web Audio, opened within the first
 *  tap, so the ones that follow a tap by a moment (the tear, the cards coming out) still play on a phone. The viewer
 *  can turn them off; that is remembered. */
const BASE = "/media/md_ui/packopen/sound/";
const NAMES = ["01_op", "02_packout", "02_packout_1pack", "03_cut", "04_cardin", "05_cardout", "card_move_01", "card_move_02", "card_move_03", "card_move_04",
               "card_sr", "card_ur", "card_shake", "hope", "kaminari_01", "kaminari_02", "kaminari_03", "proc_rare",
               "proc_rare_02"] as const;
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

/** volume as the game's sound table sets it; rate shifts the pitch (the game varies a card's move a little each time). */
export function playPackSound(name: PackSoundName, volume = 0.8, rate = 1) {
  if (!ctx || !soundOn()) return;
  const audio = ctx;
  load(name).then((buf) => {
    if (!buf) return;
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    gain.gain.value = volume;
    src.connect(gain).connect(audio.destination);
    src.start();
  });
}

/** A card's move: one of the game's four, at a pitch a little different each time (SE_PACK_CARD_MOVE). */
export function playCardMove(volume = 0.7) {
  const n = 1 + Math.floor(Math.random() * 4);
  playPackSound(`card_move_0${n}` as PackSoundName, volume, 0.92 + Math.random() * 0.25);
}
