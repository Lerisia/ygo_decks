/** Dragging cards with a mouse, as Master Duel's PC deck editor does (엘리스 2026-10-18): a card from the search
 *  dropped on the deck goes in, a copy from the deck dropped on the search comes out. What a drag carries is kept in
 *  its own types, so a zone can light up before the drop (a drag's data can't be read until then). */
import type { DragEvent } from "react";
import type { CardListItem } from "@/api/cardDexApi";
import { type DeckZone, isExtraCard } from "./deckDrafts";

/** A pointer that hovers and points finely: a mouse (or a trackpad), not a finger. */
export const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";

const CARD = "application/x-ygo-card";
const DECK_CARD = "application/x-ygo-deck-card";
const zoneType = (zone: DeckZone) => `application/x-ygo-zone-${zone}`;

export function startCardDrag(e: DragEvent, card: CardListItem) {
  e.dataTransfer.setData(CARD, JSON.stringify(card));
  e.dataTransfer.setData(zoneType(isExtraCard(card) ? "extra" : "main"), "");
  e.dataTransfer.effectAllowed = "copy";
}

export function startDeckCardDrag(e: DragEvent, zone: DeckZone, at: number) {
  e.dataTransfer.setData(DECK_CARD, JSON.stringify({ zone, at }));
  e.dataTransfer.effectAllowed = "move";
}

/** The zone a card being dragged over the deck belongs in, or null when it isn't a card from the search. */
export function draggedCardZone(e: DragEvent): DeckZone | null {
  const types = Array.from(e.dataTransfer.types);
  if (!types.includes(CARD)) return null;
  return types.includes(zoneType("extra")) ? "extra" : "main";
}

export const draggingDeckCard = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(DECK_CARD);

export function droppedCard(e: DragEvent): CardListItem | null {
  const raw = e.dataTransfer.getData(CARD);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CardListItem;
  } catch {
    return null;
  }
}

export function droppedDeckCard(e: DragEvent): { zone: DeckZone; at: number } | null {
  const raw = e.dataTransfer.getData(DECK_CARD);
  if (!raw) return null;
  try {
    const got = JSON.parse(raw);
    return got && (got.zone === "main" || got.zone === "extra") && Number.isInteger(got.at) ? got : null;
  } catch {
    return null;
  }
}
