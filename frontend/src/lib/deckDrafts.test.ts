import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardListItem } from "@/api/cardDexApi";
import {
  type DeckDraft, NEW_CODE, addCard, addCards, blankDeck, clearLocalDrafts, clearTabDraft, copyIndex, copyRank, coverLook, deckDayLine, deckIssues, deckWarnings, deckUpdated, fromDoc,
  keepTabDraft, kindCounts, localDrafts, lookAt, lookThumb, notOutCards, overLimit, removeCard, savedCovers, setCover, setLook, setLookAll,
  sortedCopies, sortedZone, tabDraft,
} from "./deckDrafts";
import type { BanRule } from "./banlists";
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
const deck = (main: number[], extra: number[] = []): DeckDraft => ({
  ...blankDeck(), main, extra, looks: { main: main.map(() => null), extra: extra.map(() => null) },
});

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
    expect(addCard(full, CARDS.get(6)!, CARDS)).toEqual({ deck: { ...full, extra: [6], looks: { ...full.looks, extra: [null] } } });
    const fullExtra = deck([], Array.from({ length: 15 }, (_, i) => 100 + i));
    expect(addCard(fullExtra, CARDS.get(6)!, CARDS)).toHaveProperty("error");
  });

  it("puts every card a picture held in at once, each as often as it held it, leaving out what cannot go in (전체 투입)", () => {
    const fresh = card(40, "새 카드", "spell", "spell");   // not among the deck's cards yet
    const r = addCards(deck([1]), [{ card: CARDS.get(2)!, count: 3 }, { card: CARDS.get(5)!, count: 1 }, { card: CARDS.get(9)!, count: 1 }, { card: fresh, count: 2 }], CARDS);
    expect(r.deck).toEqual(deck([1, 2, 2, 40, 40], [5]));
    expect([r.added, r.left, r.why]).toEqual([5, 2, "같은 이름의 카드는 3장까지 넣을 수 있습니다."]);
    expect(addCards(deck([]), [], CARDS)).toEqual({ deck: deck([]), added: 0, left: 0, why: "" });
  });

  it("takes out the one copy pressed, by its place in the zone", () => {
    expect(removeCard(deck([1, 3, 1]), "main", 2)).toEqual(deck([1, 3]));
    expect(removeCard(deck([1, 3, 1]), "main", 0)).toEqual(deck([3, 1]));
    expect(removeCard(deck([1], [5]), "extra", 0)).toEqual(deck([1]));
    expect(removeCard(deck([1]), "extra", 0)).toEqual(deck([1]));
    expect(removeCard(deck([1]), "main", 4)).toEqual(deck([1]));
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
    // the places behind them: copies of a card keep the order they went in
    expect(sortedCopies([3, 1, 9, 4, 1, 3], order)).toEqual([1, 4, 3, 0, 5, 2]);
  });
});

describe("today's 금제", () => {
  const banned = (id: number, name: string, ban: CardListItem["ban"]) => ({ ...card(id, name, "monster", "effect"), ban });
  const forbidden = banned(20, "금지", "forbidden"), limited = banned(21, "제한", "limited"), semi = banned(22, "준제한", "semi_limited");
  const cards = new Map([...CARDS, [20, forbidden], [21, limited], [22, semi]]);

  it("lets cards in over it, up to 3 of a name, only telling (참혈 2026-10-17)", () => {
    expect(addCard(deck([]), forbidden, cards)).toEqual({ deck: deck([20]) });
    expect(addCard(deck([21]), limited, cards)).toEqual({ deck: deck([21, 21]) });
    expect(addCard(deck([22, 22]), semi, cards)).toEqual({ deck: deck([22, 22, 22]) });
    expect(addCard(deck([22, 22, 22]), semi, cards)).toEqual({ error: "같은 이름의 카드는 3장까지 넣을 수 있습니다." });
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

describe("the 금제 the deck picked (참혈 2026-10-16)", () => {
  const released = (ocg: string | null) => ({ md: "2022-01-19", ocg, tcg: null });
  const one = { ...card(30, "하나", "monster", "effect"), ban: "forbidden" as const, released: released("2019-01-01") };
  const two = { ...card(31, "둘", "monster", "effect"), released: released("2021-06-01") };
  const three = { ...card(32, "셋", "monster", "effect"), released: released(null) };
  const cards = new Map([...CARDS, [30, one], [31, two], [32, three]]);
  // an OCG list of 2020: 하나 free there (forbidden in Master Duel today), 둘 limited and not out yet, 셋 never out
  const ocg2020: BanRule = { format: "ocg", limits: { 31: "limited" }, releasedBy: "2020-01-01" };

  it("finds the cards over it, and the cards not out yet then, each with its line", () => {
    expect(overLimit([30, 31, 31], cards, ocg2020).map((o) => [o.card.id, o.count, o.line])).toEqual([[31, 2, "둘: 제한 카드는 1장까지입니다 (2장)."]]);
    expect(overLimit([30, 31, 31], cards).map((o) => o.card.id)).toEqual([30]);
    expect(notOutCards([32, 30, 31, 31], cards, ocg2020).map((o) => [o.card.id, o.line])).toEqual([
      [31, "둘: 미출시 카드입니다."], [32, "셋: 미출시 카드입니다."],
    ]);
    expect(notOutCards([32, 30, 31], cards)).toEqual([]);   // Master Duel's newest before its table comes: all out
  });

  it("gives both pages' warning line one count: too few in the main, the cards over the list, the cards not out yet (참혈 2026-10-16)", () => {
    const w = deckWarnings(deck([30, 31, 31, 32]), cards, ocg2020);
    expect(w.short).toBe(true);
    expect(w.over.map((o) => o.card.id)).toEqual([31]);
    expect(w.later.map((o) => o.card.id)).toEqual([31, 32]);
    const full = deckWarnings(deck(Array.from({ length: 40 }, () => 1), [30]), cards);
    expect(full).toEqual({ short: false, over: [expect.objectContaining({ card: one, count: 1 })], later: [] });   // the extra deck counts too
  });

  it("tells the deck as the server does: too few, then over the list, then not out yet", () => {
    expect(deckIssues(deck([30, 31, 31, 32]), cards, ocg2020)).toEqual([
      "메인 덱이 40장보다 적습니다 (4/40).",
      "둘: 제한 카드는 1장까지입니다 (2장).",
      "둘: 미출시 카드입니다.",
      "셋: 미출시 카드입니다.",
    ]);
  });

  it("is kept with the deck: a new deck follows Master Duel's newest, a saved one keeps its own", () => {
    expect(blankDeck().banlist).toBe("md");
    expect(fromDoc({ code: "abcd1234", name: "덱", description: "", main: [], extra: [], cover_cards: [], created_at: "", updated_at: "", main_count: 0, extra_count: 0, issues: [], banlist: "ocg:2020-01-01" }).banlist)
      .toBe("ocg:2020-01-01");
    expect(fromDoc({ code: "abcd1234", name: "덱", description: "", main: [], extra: [], cover_cards: [], created_at: "", updated_at: "", main_count: 0, extra_count: 0, issues: [] }).banlist)
      .toBe("md");
  });
});

describe("each copy's look (참혈 2026-10-16)", () => {
  const shine = (face: number) => ({ face, finish: "shine" as const });

  it("goes in with the look picked, its own print in 일반 kept as none", () => {
    expect(addCard(deck([]), CARDS.get(1)!, CARDS, shine(9001))).toEqual({ deck: { ...deck([1]), looks: { main: [shine(9001)], extra: [] } } });
    expect(addCard(deck([]), CARDS.get(1)!, CARDS, { face: 1, finish: "normal" })).toEqual({ deck: deck([1]) });
    expect(addCard(deck([]), CARDS.get(5)!, CARDS, { face: 5, finish: "royal" })).toEqual({
      deck: { ...deck([], [5]), looks: { main: [], extra: [{ face: 5, finish: "royal" }] } },
    });
  });

  it("is set on one copy, or on every copy of the card, and leaves with its copy", () => {
    const d = setLook(deck([1, 3, 1]), "main", 2, shine(9001));
    expect(d.looks.main).toEqual([null, null, shine(9001)]);
    expect(lookAt(d, "main", 2)).toEqual(shine(9001));
    expect(lookAt(d, "main", 0)).toEqual({ face: 1, finish: "normal" });
    expect(setLook(d, "main", 2, { face: 1, finish: "normal" }).looks.main).toEqual([null, null, null]);
    expect(removeCard(d, "main", 0).looks.main).toEqual([null, shine(9001)]);
    expect(setLookAll(d, "main", 1, { face: 1, finish: "royal" }).looks.main).toEqual([{ face: 1, finish: "royal" }, null, { face: 1, finish: "royal" }]);
  });

  it("tells which copy of its card a place holds, and back", () => {
    expect(copyRank([1, 3, 1, 1], 3)).toBe(2);
    expect(copyRank([1, 3, 1, 1], 1)).toBe(0);
    expect(copyIndex([1, 3, 1, 1], 1, 1)).toBe(2);
    expect(copyIndex([1, 3, 1, 1], 1, 3)).toBe(-1);
  });

  it("draws a copy in its print's small face, its own when the print is not known", () => {
    const c = { ...CARDS.get(1)!, face_thumb_url: "/own.webp", alts: [{ id: 9001, thumb: "/alt.webp" }] };
    expect(lookThumb(c, null)).toBe("/own.webp");
    expect(lookThumb(c, shine(9001))).toBe("/alt.webp");
    expect(lookThumb(c, shine(9002))).toBe("/own.webp");
  });
});

describe("대표 카드", () => {
  const pick = (id: number, copy = 0) => ({ id, copy });

  it("fills the slot pressed, a card already in another slot trading places with it", () => {
    const d = deck([1, 3, 4], [5]);
    const one = setCover(d, 0, pick(3));
    expect(one.covers).toEqual([pick(3), null, null]);
    expect(setCover(one, 2, pick(5)).covers).toEqual([pick(3), null, pick(5)]);
    expect(setCover(setCover(one, 2, pick(5)), 2, pick(3)).covers).toEqual([pick(5), null, pick(3)]);
    expect(setCover(setCover(one, 1, pick(4)), 0, null).covers).toEqual([null, pick(4), null]);
  });

  it("is the copy pressed: another copy of it in the same slot or another moves it there", () => {
    const d = setCover(deck([1, 3, 1]), 0, pick(1, 1));
    expect(setCover(d, 0, pick(1, 0)).covers).toEqual([pick(1, 0), null, null]);
    expect(setCover(d, 1, pick(1, 0)).covers).toEqual([null, pick(1, 0), null]);
  });

  it("follows its copy as copies leave, and lets the card go when its last copy does", () => {
    const d = { ...deck([1, 1, 1, 3], [5]), covers: [pick(1, 1), pick(3), pick(5)] };
    expect(removeCard(d, "main", 0).covers).toEqual([pick(1, 0), pick(3), pick(5)]);   // an earlier copy left
    expect(removeCard(d, "main", 2).covers).toEqual([pick(1, 1), pick(3), pick(5)]);   // a later one
    expect(removeCard(d, "main", 1).covers).toEqual([pick(1, 1), pick(3), pick(5)]);   // its own: the next takes its place
    const last = { ...deck([3, 1, 1]), covers: [pick(1, 1)] };
    expect(removeCard(last, "main", 2).covers).toEqual([pick(1, 0)]);                  // its own and the last: the one before
    expect(removeCard(removeCard(last, "main", 2), "main", 1).covers).toEqual([null]);
    expect(removeCard(d, "main", 3).covers).toEqual([pick(1, 1), null, pick(5)]);
  });

  it("is drawn in its copy's look, and saved without the gaps with which copy each is", () => {
    const d = setLook({ ...deck([1, 1, 3], [5]), covers: [pick(1, 1), null, pick(5)] }, "main", 1, { face: 9001, finish: "royal" });
    expect(coverLook(d, pick(1, 1))).toEqual({ face: 9001, finish: "royal" });
    expect(coverLook(d, pick(1, 0))).toBeNull();
    expect(coverLook(d, pick(1, 5))).toEqual({ face: 9001, finish: "royal" });   // fewer copies now: the last
    expect(coverLook(d, pick(7))).toBeNull();
    expect(savedCovers(d)).toEqual({ cover_cards: [1, 5], cover_copies: [1, 0] });
    expect(savedCovers({ ...d, extra: [], covers: [pick(5), pick(1, 4)] })).toEqual({ cover_cards: [1], cover_copies: [1] });
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
    keepTabDraft({ ...deck([1, 3]), code: "whatever", name: "손님 덱", looks: { main: [null, { face: 9, finish: "shine" }], extra: [] } });
    expect(tabDraft()).toEqual({ ...deck([1, 3]), name: "손님 덱", looks: { main: [null, { face: 9, finish: "shine" }], extra: [] } });   // always a new deck
    expect(tabDraft()?.name).toBe("손님 덱");
    clearTabDraft();
    expect(tabDraft()).toBeNull();
    // one kept before looks and copies: none, and the first copy
    tab.deck_draft_tab = JSON.stringify({ ...blankDeck(), main: [1, 3], extra: [], looks: undefined, covers: [3, null] });
    expect(tabDraft()).toEqual({ ...deck([1, 3]), covers: [{ id: 3, copy: 0 }, null] });
    // the 금제 picked (참혈 2026-10-16) goes along; one kept before it is Master Duel's newest
    keepTabDraft({ ...deck([1]), banlist: "tcg:2025-04-07" });
    expect(tabDraft()?.banlist).toBe("tcg:2025-04-07");
    tab.deck_draft_tab = JSON.stringify({ main: [1], extra: [] });
    expect(tabDraft()?.banlist).toBe("md");
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
    const doc = {
      code: "ab12cd34", name: "덱", description: "", main_count: 2, extra_count: 0, cover_cards: [1], cover_copies: [1], created_at: "a", updated_at: "b",
      main: [1, 1], extra: [], issues: [], looks: { main: [null, { face: 9, finish: "royal" as const }], extra: [] },
    };
    expect(fromDoc(doc)).toEqual({
      code: "ab12cd34", name: "덱", description: "", createdAt: "a", updatedAt: "b", main: [1, 1], extra: [],
      looks: { main: [null, { face: 9, finish: "royal" }], extra: [] }, covers: [{ id: 1, copy: 1 }], banlist: "md",
      deck: null, deckChosen: false,
    });
    // filed under a 도감 deck on the board (엘리스 2026-10-17): the cards' say, or the author's pick
    expect(fromDoc({ ...doc, deck: { id: 7, name: "히어로" }, deck_chosen: true })).toMatchObject({ deck: { id: 7, name: "히어로" }, deckChosen: true });
    // a deck from before looks and copies (or one whose looks no longer line up): plain, the first copy
    expect(fromDoc({ ...doc, looks: { main: [null], extra: [] }, cover_copies: undefined }))
      .toMatchObject({ looks: { main: [null, null], extra: [] }, covers: [{ id: 1, copy: 0 }] });
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

describe("the day a deck shows (참혈 2026-10-16)", () => {
  it("shows the later of its first and last save, 등록일 when they fall on one day", () => {
    expect(deckDayLine({ createdAt: "2026-10-16T03:00:00Z", updatedAt: "2026-10-16T05:00:00.5Z" })).toBe("등록일 2026.10.16");
    expect(deckDayLine({ createdAt: "2026-10-14T03:00:00Z", updatedAt: "2026-10-16T05:00:00Z" })).toBe("갱신일 2026.10.16");
    expect(deckDayLine({ createdAt: "2026-10-14T03:00:00Z", updatedAt: "" })).toBe("등록일 2026.10.14");
  });
});
