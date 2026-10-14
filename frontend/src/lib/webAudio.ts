/** The site's one Web Audio context, for the pack opening's sounds and a summon's (엘리스 2026-10-14). Opened within a
 *  tap: a phone lets sound start only from one, and once open it plays the sounds that follow the tap by a moment. */
let ctx: AudioContext | null = null;

/** Call within a tap: the context, opened, or null when the browser has none. A phone that left the page (another app,
 *  the screen locked) hands it back "interrupted" or "suspended", so any state but running is resumed here, with a
 *  silent sound played in it as an iPhone wants (엘리스 10/13: "소리가 아예 안 나요"). */
export function openAudio(): AudioContext | null {
  try {
    // an iPhone keeps a page's Web Audio quiet in silent mode unless the page asks to play as media does
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx || ctx.state === "closed") ctx = new Ctx();
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    const blank = ctx.createBufferSource();
    blank.buffer = ctx.createBuffer(1, 1, 22050);
    blank.connect(ctx.destination);
    blank.start();
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}
