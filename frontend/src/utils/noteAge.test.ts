import { isStaleNote } from "./noteAge";

const now = new Date("2026-10-03T12:00:00+09:00");

describe("isStaleNote", () => {
  it("marks notes older than two years", () => {
    expect(isStaleNote("2024-09-30", now)).toBe(true);
    expect(isStaleNote("2023-01-15", now)).toBe(true);
  });

  it("keeps notes from the last two years", () => {
    expect(isStaleNote("2024-10-10", now)).toBe(false);
    expect(isStaleNote("2026-09-01", now)).toBe(false);
  });

  it("never marks undated notes", () => {
    expect(isStaleNote(null, now)).toBe(false);
  });
});
