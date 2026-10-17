/** The deck builder's sounds, the game's own deck editor's (md_ui/sfx, drawn out of Master Duel: mdpipeline/sfx_extract.py;
 *  엘리스 2026-10-18 "마듀랑 같은 효과음"). Played through Web Audio (lib/webAudio), opened within the first press so the
 *  ones that follow a press by a moment still play on a phone, as the pack opening's are (lib/packSound). The viewer can
 *  turn them off; that is remembered. */
import { openAudio } from "@/lib/webAudio";

const BASE = "/media/md_ui/sfx/";
// move1–4: SE_CARD_MOVE_01–04, a card put in or taken out (one of the four each time, as the game varies it);
// select: SE_MENU_SELECT_01, a card under the mouse; decide: SE_MENU_DECIDE; cancel: SE_MENU_CANCEL;
// open / close: SE_CARDEXPAND_DISPLAY / CLOSE, a card shown and put away; verify: SE_SYS_VERIFY, the deck saved
const NAMES = ["move1", "move2", "move3", "move4", "select", "decide", "cancel", "open", "close", "verify"] as const;
export type DeckSoundName = (typeof NAMES)[number];
const OFF = "deck_sound_off";
// a step quieter than the game, as the pack opening's are: loud for a page
const MASTER = 0.6;
const HOVER_GAP_MS = 70;

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let lastHover = 0;

export function deckSoundOn(): boolean {
  try {
    return localStorage.getItem(OFF) !== "1";
  } catch {
    return true;
  }
}

export function setDeckSoundOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF);
    else localStorage.setItem(OFF, "1");
  } catch {
    /* kept for this page only */
  }
  if (on) unlockDeckSound();
}

function load(name: string) {
  if (!ctx) return Promise.resolve(null);
  const audio = ctx;
  if (!buffers.has(name)) {
    // a sound that failed to come is asked for again at the next press, not left silent for the visit
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

/** Call within a press: opens the sound (the site's one context) and fetches the sounds. */
export function unlockDeckSound() {
  if (!deckSoundOn()) return;
  const opened = openAudio();
  if (opened !== ctx) {
    ctx = opened;
    buffers.clear();
  }
  if (ctx) NAMES.forEach(load);
}

export function playDeckSound(name: DeckSoundName, volume = 0.8, rate = 1) {
  if (!ctx || !deckSoundOn()) return;
  const audio = ctx;
  if (audio.state !== "running") audio.resume().catch(() => {});
  load(name).then((buf) => {
    if (!buf) return;
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    gain.gain.value = volume * MASTER;
    src.connect(gain).connect(audio.destination);
    src.start(0);
  });
}

/** A card put in or taken out: one of the game's four, at a pitch a little different each time. */
export function playDeckMove() {
  playDeckSound(`move${1 + Math.floor(Math.random() * 4)}` as DeckSoundName, 0.9, 0.94 + Math.random() * 0.12);
}

/** A card the mouse comes over: the game's tick, not more often than the ear tells apart. */
export function playDeckHover() {
  const now = performance.now();
  if (now - lastHover < HOVER_GAP_MS) return;
  lastHover = now;
  playDeckSound("select", 0.35);
}
