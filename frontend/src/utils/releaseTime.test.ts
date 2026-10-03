import { releaseIso, releaseParts, currentYearKst, daysInMonth } from "./releaseTime";

describe("release time helpers", () => {
  it("builds 6 pm Korea time on the given day", () => {
    expect(releaseIso(2026, 10, 6)).toBe("2026-10-06T18:00:00+09:00");
    expect(new Date(releaseIso(2026, 10, 6)).toISOString()).toBe("2026-10-06T09:00:00.000Z");
  });

  it("reads the Korean calendar day back from a stored time", () => {
    expect(releaseParts("2026-10-06T18:00:00+09:00")).toEqual({ year: 2026, month: 10, day: 6 });
    expect(releaseParts("2026-10-06T16:00:00Z")).toEqual({ year: 2026, month: 10, day: 7 });
    expect(releaseParts(null)).toBeNull();
  });

  it("uses this year in Korea", () => {
    expect(currentYearKst(new Date("2026-12-31T16:00:00Z"))).toBe(2027);
    expect(currentYearKst(new Date("2026-10-03T03:00:00Z"))).toBe(2026);
  });

  it("knows month lengths", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
  });
});
