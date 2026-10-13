import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardListItem } from "@/api/cardDexApi";
import {
  type DeckDraft, NEW_CODE, addCard, blankDeck, getDeck, kindCounts, listDecks, removeCard, saveDeck, sortedZone,
} from "./deckDrafts";
import { isDeckEditorPath } from "./deckListPaths";

const card = (id: number, name: string, category: CardListItem["category"], frame: string): CardListItem => ({
  id, name, category, frame, face_thumb_url: null, thumb_url: null, image_url: null, rarity: "", ban: "",
});
const CARDS = new Map(
  [
    card(1, "블랙 매지션", "monster", "normal"),
    card(2, "블랙 매지션", "monster", "effect"),   // another print under the same name
    card(3, "블랙 매지션의 속공", "spell", "spell"),
    card(4, "함정", "trap", "trap"),
    card(5, "융합", "monster", "fusion_pendulum"),
    card(6, "싱크로", "monster", "synchro"),
    card(7, "엑시즈", "monster", "xyz"),
    card(8, "링크", "monster", "link"),
    card(9, "토큰", "monster", "token"),
    card(10, "의식", "monster", "ritual"),
  ].map((c) => [c.id, c]),
);
const deck = (main: number[], extra: number[] = []): DeckDraft => ({ ...blankDeck(), main, extra });

describe("adding and taking out cards", () => {
  it("puts fusion, synchro, xyz and link monsters in the extra deck, the rest in the main deck", () => {
    expect(addCard(deck([]), CARDS.get(1)!, CARDS)).toEqual({ deck: deck([1]) });
    expect(addCard(deck([]), CARDS.get(5)!, CARDS)).toEqual({ deck: deck([], [5]) });
    expect(addCard(deck([]), CARDS.get(8)!, CARDS)).toEqual({ deck: deck([], [8]) });
    expect(addCard(deck([]), CARDS.get(10)!, CARDS)).toEqual({ deck: deck([10]) });
  });

  it("allows three cards of a name across main and extra, whatever their ids", () => {
    const three = addCard(deck([1, 2]), CARDS.get(1)!, CARDS);
    expect(three).toEqual({ deck: deck([1, 2, 1]) });
    expect(addCard(deck([1, 2, 1]), CARDS.get(2)!, CARDS)).toHaveProperty("error");
    expect(addCard(deck([], [8, 8, 8]), CARDS.get(8)!, CARDS)).toHaveProperty("error");
  });

  it("keeps tokens out and stops at each zone's size", () => {
    expect(addCard(deck([]), CARDS.get(9)!, CARDS)).toHaveProperty("error");
    const full = deck(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(addCard(full, CARDS.get(3)!, CARDS)).toHaveProperty("error");
    expect(addCard(full, CARDS.get(6)!, CARDS)).toEqual({ deck: { ...full, extra: [6] } });
    const fullExtra = deck([], Array.from({ length: 15 }, (_, i) => 100 + i));
    expect(addCard(fullExtra, CARDS.get(6)!, CARDS)).toHaveProperty("error");
  });

  it("takes out one copy", () => {
    expect(removeCard(deck([1, 3, 1]), "main", 1)).toEqual(deck([3, 1]));
    expect(removeCard(deck([1], [5]), "extra", 5)).toEqual(deck([1]));
    expect(removeCard(deck([1]), "extra", 1)).toEqual(deck([1]));
  });
});

describe("a zone's lines", () => {
  it("counts kinds in Master Duel's order, leaving out those with none", () => {
    expect(kindCounts([1, 2, 3, 3, 4, 10], CARDS)).toEqual([
      { label: "몬스터", count: 3 }, { label: "마법", count: 2 }, { label: "함정", count: 1 },
    ]);
    expect(kindCounts([5, 6, 8, 8], CARDS)).toEqual([
      { label: "융합", count: 1 }, { label: "싱크로", count: 1 }, { label: "링크", count: 2 },
    ]);
    expect(kindCounts([4, 7], CARDS)).toEqual([{ label: "함정", count: 1 }, { label: "엑시즈", count: 1 }]);
  });

  it("orders a zone as the server ordered the cards, copies together, cards it hasn't placed last", () => {
    const order = new Map([[3, 2], [1, 0], [4, 1]]);
    expect(sortedZone([3, 1, 9, 4, 1, 3], order)).toEqual([1, 1, 4, 3, 3, 9]);
  });
});

describe("keeping decks in this browser", () => {
  let stored: Record<string, string>;

  beforeEach(() => {
    stored = {};
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => (stored[k] = v) });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("has no decks to begin with, and stores nothing by looking", () => {
    expect(listDecks()).toEqual([]);
    expect(stored).toEqual({});
  });

  it("gives a new deck its code and day on saving, and keeps them when it is saved again", () => {
    const saved = saveDeck({ ...blankDeck(), name: "새 덱", main: [1] });
    expect(saved.code).toMatch(/^[0-9a-z]{8}$/);
    expect(saved.createdAt).toBe("2026-10-13T12:00:00.000Z");
    expect(getDeck(saved.code)).toEqual(saved);
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const again = saveDeck({ ...saved, name: "고친 덱" });
    expect(again).toEqual({ ...saved, name: "고친 덱" });
    expect(listDecks().map((d) => d.name)).toEqual(["고친 덱"]);
  });

  it("lists the newest deck first", () => {
    const first = saveDeck({ ...blankDeck(), name: "먼저" });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    saveDeck({ ...blankDeck(), name: "나중" });
    saveDeck(first);
    expect(listDecks().map((d) => d.name)).toEqual(["나중", "먼저"]);
  });

  it("finds no deck under an unknown code, nor under new", () => {
    expect(getDeck("nothing1")).toBeNull();
    expect(getDeck(NEW_CODE)).toBeNull();
  });
});

describe("the pages' paths", () => {
  it("knows the making and changing pages, where the search sits at the bottom", () => {
    expect(isDeckEditorPath("/decklists/new")).toBe(true);
    expect(isDeckEditorPath("/decklists/ab12cd34/edit")).toBe(true);
    expect(isDeckEditorPath("/decklists")).toBe(false);
    expect(isDeckEditorPath("/decklists/ab12cd34")).toBe(false);
    expect(isDeckEditorPath("/cards/new")).toBe(false);
  });
});
