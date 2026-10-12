import { describe, expect, it } from "vitest";
import { mdSeason } from "./mdSeason";

describe("mdSeason", () => {
  it("counts one season a month from 시즌 58 in October 2026", () => {
    expect(mdSeason(new Date("2026-10-06T09:00:00Z"))).toBe(58);
    expect(mdSeason(new Date("2026-11-15T00:00:00+09:00"))).toBe(59);
    expect(mdSeason(new Date("2027-01-01T00:00:00+09:00"))).toBe(61);
    expect(mdSeason(new Date("2026-09-30T12:00:00+09:00"))).toBe(57);
  });
  it("reads the month in Korea, not in UTC", () => {
    expect(mdSeason(new Date("2026-10-31T16:00:00Z"))).toBe(59);   // 11/1 01:00 KST
  });
});
