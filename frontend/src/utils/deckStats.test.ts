import { describe, expect, it } from "vitest";
import { statPlot, statText } from "./deckStats";

describe("deck stat display", () => {
  it("shows 11 as a question mark drawn at the outer edge", () => {
    expect(statText(11)).toBe("?");
    expect(statPlot(11)).toBe(10);
  });
  it("leaves 0-10 unchanged and marks unset stats", () => {
    expect(statText(7)).toBe("7");
    expect(statPlot(7)).toBe(7);
    expect(statText(0)).toBe("0");
    expect(statText(null)).toBe("-");
    expect(statPlot(undefined)).toBe(0);
  });
});
