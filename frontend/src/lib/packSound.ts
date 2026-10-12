/** The pack opening's sounds, the game's own (md_ui/packopen/sound). Played through Web Audio, opened within the first
 *  tap, so the ones that follow a tap by a moment (the tear, the cards coming out) still play on a phone. The viewer
 *  can turn them off; that is remembered. */
const BASE = "/media/md_ui/packopen/sound/";
const NAMES = ["01_op", "02_packout", "02_packout_1pack", "03_cut", "04_cardin", "05_cardout", "card_move_01", "card_move_02", "card_move_03", "card_move_04",
               "card_sr", "card_ur", "card_shake", "hope", "upgrad_01", "upgrad_01_ur", "kaminari_01", "kaminari_02", "kaminari_03", "proc_rare",
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
    // a sound that failed to come (the site restarting for a deploy, a dropped connection) is asked for again at the
    // next tap, not left silent for the rest of the visit
    buffers.set(name, fetch(`${BASE}${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => audio.decodeAudioData(b))
      .catch(() => {
        buffers.delete(name);
        return null;
      }));
  }
  return buffers.get(name)!;
}

/** Call within a tap: opens the sound and fetches the sounds. A phone that left the page (another app, the screen
 *  locked) hands it back "interrupted" or "suspended", so any state but running is resumed here, within the tap, with
 *  a silent sound played in it as an iPhone wants (엘리스 10/13: "소리가 아예 안 나요"). */
export function unlockPackSound() {
  if (!soundOn()) return;
  try {
    // an iPhone keeps a page's Web Audio quiet in silent mode unless the page asks to play as media does — as the
    // 소환 연출's sounds (an Audio element) already play (엘리스 10/13: "소리 왜 안 나지")
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx || ctx.state === "closed") {
      ctx = new Ctx();
      buffers.clear();
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    const blank = ctx.createBufferSource();
    blank.buffer = ctx.createBuffer(1, 1, 22050);
    blank.connect(ctx.destination);
    blank.start();
    NAMES.forEach(load);
  } catch {
    ctx = null;
  }
}

/** volume as the game's sound table sets it; rate shifts the pitch (the game varies a card's move a little each time). */
export function playPackSound(name: PackSoundName, volume = 0.8, rate = 1) {
  if (!ctx || !soundOn()) return;
  const audio = ctx;
  if (audio.state !== "running") audio.resume().catch(() => {});
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
