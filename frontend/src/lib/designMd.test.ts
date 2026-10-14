import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderDesignMd, resolveTone, toneText } from "./designMd";

const FILE = new URL("../../DESIGN.md", import.meta.url);

describe("DESIGN.md", () => {
  it("is written from the design page's data (DESIGN_MD=write npx vitest run src/lib/designMd.test.ts makes it again)", () => {
    const md = renderDesignMd();
    if (process.env.DESIGN_MD === "write") writeFileSync(FILE, md);
    expect(readFileSync(FILE, "utf8"), "frontend/DESIGN.md is out of date: cd frontend && DESIGN_MD=write npx vitest run src/lib/designMd.test.ts").toBe(md);
  });
});

describe("resolveTone", () => {
  it("reads a Tailwind class, its opacity and a hex", () => {
    expect(resolveTone("bg-blue-600")).toEqual({ hex: "#2563eb", alpha: 1, prop: "bg" });
    expect(resolveTone("bg-blue-900/20")).toEqual({ hex: "#1e3a8a", alpha: 0.2, prop: "bg" });
    expect(resolveTone("text-white").hex).toBe("#ffffff");
    expect(toneText("#D2B48C")).toBe("#d2b48c");
    expect(toneText("bg-black/60")).toBe("#000000 60%");
  });
});
