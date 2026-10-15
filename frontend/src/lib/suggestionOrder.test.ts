import { describe, expect, it } from "vitest";
import { orderSuggestions } from "./suggestionOrder";

const card = (name: string, rank: number, order: number) => ({ name, kind: "card" as const, rank, order });
const group = (name: string, rank: number, order: number) => ({ name, kind: "group" as const, rank, order });
const support = (name: string, rank: number, order: number) => ({ name, kind: "support" as const, rank, order });
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("/dev/cards suggestions order", () => {
  it("lifts the closest 카드군·서포트 over cards that only start with the typing (참혈 2026-10-15)", () => {
    const items = [
      card("엘펜노츠 레기나", 1, 0), card("엘펜노츠 디나", 1, 1), card("엘펜노츠 루키나", 1, 2),
      group("엘펜노츠", 1, 0), support("엘펜노츠의 감옥신정", 1, 0),
    ];
    expect(names(orderSuggestions(items, 10))).toEqual(["엘펜노츠", "엘펜노츠 레기나", "엘펜노츠 디나", "엘펜노츠 루키나", "엘펜노츠의 감옥신정"]);
  });
  it("keeps a card named exactly above it", () => {
    const items = [card("블랙 매지션 걸", 1, 1), card("블랙 매지션", 0, 0), group("블랙 매지션", 0, 0), support("블랙 매지션", 0, 0)];
    expect(names(orderSuggestions(items, 10))).toEqual(["블랙 매지션", "블랙 매지션", "블랙 매지션", "블랙 매지션 걸"]);
    expect(orderSuggestions(items, 10).map((x) => x.kind)).toEqual(["card", "group", "support", "card"]);
  });
  it("takes only the closest one up; the others stay where they rank", () => {
    const items = [card("드래곤메이드 하스키", 1, 0), group("메이드", 2, 0), support("드래곤메이드의 시중", 1, 0), group("드래곤메이드", 1, 1)];
    expect(names(orderSuggestions(items, 10))).toEqual(["드래곤메이드", "드래곤메이드 하스키", "드래곤메이드의 시중", "메이드"]);
  });
  it("is the plain order with no 카드군·서포트, cut to the limit", () => {
    const items = [card("C", 2, 0), card("B", 1, 1), card("A", 1, 0)];
    expect(names(orderSuggestions(items, 2))).toEqual(["A", "B"]);
  });
});
