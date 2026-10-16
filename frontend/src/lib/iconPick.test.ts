import { describe, expect, it } from "vitest";
import type { IconChoice } from "@/api/devIconsApi";
import { dropTyped, isPicked, togglePick, typeRemix, typedLibs, unlisted } from "./iconPick";
import { remixTyped } from "./remixName";

const search: IconChoice = { lib: "remix-line", name: "search" };

describe("a pick shows only in the style it was made in (참혈 2026-10-16)", () => {
  it("tells Remix 면 from 선", () => {
    expect(isPicked(search, ["remix-line"], "search")).toBe(true);
    expect(isPicked(search, ["remix-fill"], "search")).toBe(false);
    expect(isPicked(search, ["remix-line"], "search-2")).toBe(false);
    expect(isPicked(undefined, ["remix-line"], "search")).toBe(false);
  });

  it("tells Font Awesome from its 외곽선", () => {
    const bell: IconChoice = { lib: "fa-regular", name: "bell" };
    expect(isPicked(bell, ["fa-regular"], "bell")).toBe(true);
    expect(isPicked(bell, ["fa"], "bell")).toBe(false);
  });

  it("an icon drawn the same in both styles is one cell, picked in either", () => {
    expect(isPicked({ lib: "remix-fill", name: "close" }, ["remix-fill", "remix-line"], "close")).toBe(true);
    expect(isPicked({ lib: "remix-line", name: "close" }, ["remix-fill", "remix-line"], "close")).toBe(true);
  });
});

describe("pressing a cell", () => {
  it("picks it, a second press lets it go", () => {
    const one = togglePick({}, "🔍 검색", ["remix-line"], "search");
    expect(one).toEqual({ "🔍 검색": search });
    expect(togglePick(one, "🔍 검색", ["remix-line"], "search")).toEqual({});
  });

  it("the other style of the same icon takes the pick over", () => {
    expect(togglePick({ "🔍 검색": search }, "🔍 검색", ["remix-fill"], "search")).toEqual({ "🔍 검색": { lib: "remix-fill", name: "search" } });
  });

  it("a one-look cell lets a pick go in either style", () => {
    expect(togglePick({ "✕ 닫기": { lib: "remix-line", name: "close" } }, "✕ 닫기", ["remix-fill", "remix-line"], "close")).toEqual({});
  });
});

describe("a Remix name typed into a row's box", () => {
  const row = "🎮 놀이터 탭";

  it("shows one cell when typed with its style, both when bare", () => {
    expect(typedLibs(remixTyped("search-line"))).toEqual(["remix-line"]);
    expect(typedLibs(remixTyped("game"))).toEqual(["remix-fill", "remix-line"]);
  });

  it("typed with its style is picked at once and kept as typed", () => {
    expect(typeRemix({ choices: {}, custom: {} }, row, remixTyped("game-line"), ["gamepad"])).toEqual({
      choices: { [row]: { lib: "remix-line", name: "game" } },
      custom: { [row]: "game-line" },
    });
  });

  it("typed bare it is kept, with nothing picked until one of its two cells is pressed", () => {
    expect(typeRemix({ choices: {}, custom: {} }, row, remixTyped("game"), ["gamepad"])).toEqual({ choices: {}, custom: { [row]: "game" } });
  });

  it("one already among the row's own is not shown twice", () => {
    expect(typeRemix({ choices: {}, custom: {} }, row, remixTyped("gamepad"), ["gamepad"])).toEqual({ choices: {}, custom: {} });
    expect(typeRemix({ choices: {}, custom: {} }, row, remixTyped("gamepad-line"), ["gamepad"])).toEqual({
      choices: { [row]: { lib: "remix-line", name: "gamepad" } },
      custom: {},
    });
  });

  it("the name it replaces takes its pick along, a pick among the row's own stays", () => {
    const was = { choices: { [row]: { lib: "remix-fill", name: "game" } as IconChoice }, custom: { [row]: "game" } };
    expect(typeRemix(was, row, remixTyped("sword"), [])).toEqual({ choices: {}, custom: { [row]: "sword" } });
    const own = { choices: { [row]: { lib: "remix-fill", name: "gamepad" } as IconChoice }, custom: { [row]: "game" } };
    expect(typeRemix(own, row, remixTyped("sword"), ["gamepad"])).toEqual({ choices: own.choices, custom: { [row]: "sword" } });
    expect(typeRemix(was, row, remixTyped("game"), [])).toEqual(was);
  });

  it("taken out, it lets go of a pick in a style it showed", () => {
    expect(dropTyped({ [row]: { lib: "remix-line", name: "game" } }, row, remixTyped("game"))).toEqual({});
    const fill = { "🔍 검색": { lib: "remix-fill", name: "search" } as IconChoice };
    expect(dropTyped(fill, "🔍 검색", remixTyped("search-line"))).toBe(fill);
    expect(dropTyped({ "🔍 검색": search }, "🔍 검색", remixTyped("search-line"))).toEqual({});
  });
});

describe("saved rows the page no longer has", () => {
  it("are listed, never dropped", () => {
    const choices = { "📢 공지": { lib: "remix-fill", name: "megaphone" } as IconChoice, "🚪 나가기": search };
    expect(unlisted(choices, { "🧪 시험": "flask" }, new Set(["📢 공지"]))).toEqual(["🚪 나가기", "🧪 시험"]);
    expect(unlisted(choices, {}, new Set(["📢 공지", "🚪 나가기"]))).toEqual([]);
  });
});
