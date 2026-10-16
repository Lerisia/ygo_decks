import { describe, expect, it } from "vitest";
import { remixKey, remixTyped } from "./remixName";

describe("a Remix name typed by hand (참혈 2026-10-16)", () => {
  it("keeps the style when it is typed, none when it is not", () => {
    expect(remixTyped("search-line")).toEqual({ name: "search", style: "line" });
    expect(remixTyped("ri-sword-fill")).toEqual({ name: "sword", style: "fill" });
    expect(remixTyped(" Sword Line ")).toEqual({ name: "sword", style: "line" });
    expect(remixTyped("sword")).toEqual({ name: "sword", style: null });
    expect(remixTyped("line-chart")).toEqual({ name: "line-chart", style: null });
    expect(remixTyped("  ")).toEqual({ name: "", style: null });
  });

  it("is kept as typed, and read back the same way", () => {
    expect(remixKey({ name: "search", style: "line" })).toBe("search-line");
    expect(remixKey({ name: "sword", style: null })).toBe("sword");
    expect(remixTyped(remixKey({ name: "search", style: "fill" }))).toEqual({ name: "search", style: "fill" });
  });
});
