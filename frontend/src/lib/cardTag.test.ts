import { describe, expect, it } from "vitest";
import { cardTagLook } from "./cardTag";
import { FRAME_COLORS } from "./cardFrames";

describe("card tag colours (참혈 2026-10-15)", () => {
  it("takes the card's frame colour", () => {
    expect(cardTagLook("몬스터", "normal")?.style.background).toBe(FRAME_COLORS.normal);
    expect(cardTagLook("몬스터", "ritual")?.style.background).toBe(FRAME_COLORS.ritual);
    expect(cardTagLook("마법", "spell")?.style.background).toBe(FRAME_COLORS.spell);
    expect(cardTagLook("링크", "link")?.style.background).toBe(FRAME_COLORS.link);
  });
  it("draws a pendulum half its own colour, half spell green", () => {
    expect(cardTagLook("몬스터", "effect_pendulum")?.style.background).toBe(`linear-gradient(${FRAME_COLORS.effect} 55%, ${FRAME_COLORS.spell} 55%)`);
  });
  it("keeps the text readable and outlines the black xyz on a dark screen", () => {
    expect(cardTagLook("싱크로", "synchro")?.style.color).toBe("#1f2937");
    expect(cardTagLook("함정", "trap")?.style.color).toBe("#ffffff");
    expect(cardTagLook("엑시즈", "xyz")?.dark).toBe(true);
  });
  it("reads a remembered card's tag alone, and leaves other tags grey", () => {
    expect(cardTagLook("몬스터")?.style.background).toBe(FRAME_COLORS.effect);
    expect(cardTagLook("융합")?.style.background).toBe(FRAME_COLORS.fusion);
    expect(cardTagLook("카드군")).toBeNull();
    expect(cardTagLook("검색")).toBeNull();
  });
});
