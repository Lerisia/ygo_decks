import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardListItem } from "@/api/cardDexApi";
import {
  type DeckDraft, NEW_CODE, addCard, blankDeck, clearLocalDrafts, clearTabDraft, coverIds, deckIssues, deckUpdated, fromDoc, keepTabDraft, kindCounts,
  localDrafts, overLimit, removeCard, setCover, sortedZone, tabDraft,
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

describe("today's 금제", () => {
  const banned = (id: number, name: string, ban: CardListItem["ban"]) => ({ ...card(id, name, "monster", "effect"), ban });
  const forbidden = banned(20, "금지", "forbidden"), limited = banned(21, "제한", "limited"), semi = banned(22, "준제한", "semi_limited");
  const cards = new Map([...CARDS, [20, forbidden], [21, limited], [22, semi]]);

  it("keeps a forbidden card out, a limited one to 1 and a semi-limited one to 2", () => {
    expect(addCard(deck([]), forbidden, cards)).toEqual({ error: "금지 카드는 넣을 수 없습니다." });
    expect(addCard(deck([]), limited, cards)).toEqual({ deck: deck([21]) });
    expect(addCard(deck([21]), limited, cards)).toEqual({ error: "제한 카드는 1장까지 넣을 수 있습니다." });
    expect(addCard(deck([22]), semi, cards)).toEqual({ deck: deck([22, 22]) });
    expect(addCard(deck([22, 22]), semi, cards)).toHaveProperty("error");
  });

  it("tells a deck what keeps it from being played, as the server does", () => {
    expect(deckIssues(deck([20, 21, 21, 1]), cards)).toEqual([
      "메인 덱이 40장보다 적습니다 (4/40).",
      "금지: 금지 카드입니다.",
      "제한: 제한 카드는 1장까지입니다 (2장).",
    ]);
    expect(deckIssues(deck(Array.from({ length: 40 }, () => 1)), cards)).toEqual([]);
  });

  it("finds a zone's cards over today's list, for the warning by its title", () => {
    expect(overLimit([21, 1, 21, 20], cards).map((o) => [o.card.id, o.count])).toEqual([[20, 1], [21, 2]]);
    expect(overLimit([21, 22, 22], cards)).toEqual([]);
  });
});

describe("대표 카드", () => {
  it("fills the slot pressed, a card already in another slot trading places with it", () => {
    const d = deck([1, 3, 4], [5]);
    const one = setCover(d, 0, 3);
    expect(one.covers).toEqual([3, null, null]);
    expect(setCover(one, 2, 5).covers).toEqual([3, null, 5]);
    expect(setCover(setCover(one, 2, 5), 2, 3).covers).toEqual([5, null, 3]);
    expect(setCover(setCover(one, 1, 4), 0, null).covers).toEqual([null, 4, null]);
  });

  it("lets a card go when its last copy leaves the deck, and saves them without the gaps", () => {
    const d = { ...deck([1, 1, 3], [5]), covers: [1, 3, 5] };
    expect(removeCard(d, "main", 1).covers).toEqual([1, 3, 5]);
    expect(removeCard(removeCard(d, "main", 1), "main", 1).covers).toEqual([null, 3, 5]);
    expect(coverIds({ ...d, covers: [null, 3, 5] })).toEqual([3, 5]);
    expect(coverIds({ ...d, extra: [], covers: [5, 1] })).toEqual([1]);
  });
});

describe("decks kept outside the server", () => {
  let local: Record<string, string>, tab: Record<string, string>;
  const store = (m: Record<string, string>) => ({
    getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => (m[k] = v), removeItem: (k: string) => delete m[k],
  });

  beforeEach(() => {
    local = {};
    tab = {};
    vi.stubGlobal("localStorage", store(local));
    vi.stubGlobal("sessionStorage", store(tab));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a guest's deck in the tab until it is saved or given up, through the reload signing in makes", () => {
    expect(tabDraft()).toBeNull();
    keepTabDraft({ ...blankDeck(), code: "whatever", name: "손님 덱", main: [1, 3] });
    expect(tabDraft()).toEqual({ ...blankDeck(), name: "손님 덱", main: [1, 3] });   // always a new deck
    expect(tabDraft()?.name).toBe("손님 덱");
    clearTabDraft();
    expect(tabDraft()).toBeNull();
  });

  it("hands over the first layout's browser decks, keeping those that could not move", () => {
    const old = { ...blankDeck(), code: "ab12cd34", name: "예전 덱", createdAt: "2026-10-13T12:00:00.000Z" };
    local.deck_drafts_v0 = JSON.stringify([old, { ...old, code: "zz" }]);
    expect(localDrafts().map((d) => d.code)).toEqual(["ab12cd34", "zz"]);
    clearLocalDrafts([old]);
    expect(localDrafts()).toEqual([old]);
    clearLocalDrafts();
    expect(localDrafts()).toEqual([]);
  });

  it("reads the server's deck as the pages hold it", () => {
    expect(fromDoc({
      code: "ab12cd34", name: "덱", description: "", main_count: 1, extra_count: 0, cover_cards: [1], created_at: "a", updated_at: "b", main: [1], extra: [], issues: [],
    })).toEqual({ code: "ab12cd34", name: "덱", description: "", createdAt: "a", updatedAt: "b", main: [1], extra: [], covers: [1] });
    expect(deckUpdated({ createdAt: "2026-10-13T12:00:00.000Z" })).toBe("2026-10-13T12:00:00.000Z");
    expect(blankDeck().code).toBe(NEW_CODE);
  });
});

describe("the pages' paths", () => {
  it("knows the making and changing pages, where the search sits at the bottom", () => {
    expect(isDeckEditorPath("/dev/decklists/new")).toBe(true);
    expect(isDeckEditorPath("/dev/decklists/ab12cd34/edit")).toBe(true);
    expect(isDeckEditorPath("/dev/decklists")).toBe(false);
    expect(isDeckEditorPath("/dev/decklists/ab12cd34")).toBe(false);
    expect(isDeckEditorPath("/decklists/new")).toBe(false);   // the old address only sends on
    expect(isDeckEditorPath("/cards/new")).toBe(false);
  });
});
