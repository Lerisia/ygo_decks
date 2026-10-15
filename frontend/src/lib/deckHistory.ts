import type { DeckDraft } from "./deckDrafts";

/** The deck builder's undo / redo (참혈 2026-10-16): what the deck holds — its cards and 대표 카드 — before each change.
 *  Its name and description are typed in boxes that undo on their own, so they are left as they are. */
export type DeckSnap = Pick<DeckDraft, "main" | "extra" | "covers">;
export type DeckHistory = { past: DeckSnap[]; future: DeckSnap[] };

export const EMPTY_HISTORY: DeckHistory = { past: [], future: [] };
const LIMIT = 100;

const snap = (d: DeckSnap): DeckSnap => ({ main: d.main, extra: d.extra, covers: d.covers });

/** A change is made: the deck before it can be gone back to, and nothing can be redone any more. */
export const record = (h: DeckHistory, before: DeckSnap): DeckHistory => ({ past: [...h.past, snap(before)].slice(-LIMIT), future: [] });

/** One step back from `now`: the history after it and the deck to show, or null with nothing to undo. */
export const undo = (h: DeckHistory, now: DeckSnap): [DeckHistory, DeckSnap] | null =>
  h.past.length ? [{ past: h.past.slice(0, -1), future: [snap(now), ...h.future] }, h.past[h.past.length - 1]] : null;

/** One step forward again, or null with nothing to redo. */
export const redo = (h: DeckHistory, now: DeckSnap): [DeckHistory, DeckSnap] | null =>
  h.future.length ? [{ past: [...h.past, snap(now)].slice(-LIMIT), future: h.future.slice(1) }, h.future[0]] : null;
