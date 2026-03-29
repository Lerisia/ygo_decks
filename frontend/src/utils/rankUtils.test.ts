import { getNextRankState } from "./rankUtils";

// 루키: 승리 시 무조건 승급, 패배 시 변화 없음
describe("루키", () => {
  test("승리 시 승급", () => {
    expect(getNextRankState("rookie2", 0, "win")).toEqual({ rank: "rookie1", wins: 0 });
    expect(getNextRankState("rookie1", 0, "win")).toEqual({ rank: "bronze5", wins: 0 });
  });
  test("패배 시 변화 없음", () => {
    expect(getNextRankState("rookie2", 0, "lose")).toEqual({ rank: "rookie2", wins: 0 });
  });
});

// 브론즈: 승리 시 무조건 승급, 패배 시 변화 없음
describe("브론즈", () => {
  test("승리 시 승급", () => {
    expect(getNextRankState("bronze5", 0, "win")).toEqual({ rank: "bronze4", wins: 0 });
    expect(getNextRankState("bronze1", 0, "win")).toEqual({ rank: "silver5", wins: 0 });
  });
  test("패배 시 변화 없음", () => {
    expect(getNextRankState("bronze3", 0, "lose")).toEqual({ rank: "bronze3", wins: 0 });
  });
});

// 실버: 2승으로 승급, 패배해도 승수 안 떨어짐, 강등 없음
describe("실버", () => {
  test("0승에서 승리 → 1승", () => {
    expect(getNextRankState("silver5", 0, "win")).toEqual({ rank: "silver5", wins: 1 });
  });
  test("1승에서 승리 → 승급", () => {
    expect(getNextRankState("silver5", 1, "win")).toEqual({ rank: "silver4", wins: 0 });
    expect(getNextRankState("silver1", 1, "win")).toEqual({ rank: "gold5", wins: 0 });
  });
  test("패배해도 승수 안 떨어짐", () => {
    expect(getNextRankState("silver3", 1, "lose")).toEqual({ rank: "silver3", wins: 1 });
    expect(getNextRankState("silver3", 0, "lose")).toEqual({ rank: "silver3", wins: 0 });
  });
});

// 골드: 4승으로 승급, 패배해도 승수 안 떨어짐, 강등 없음
describe("골드", () => {
  test("승수 증가", () => {
    expect(getNextRankState("gold5", 0, "win")).toEqual({ rank: "gold5", wins: 1 });
    expect(getNextRankState("gold5", 2, "win")).toEqual({ rank: "gold5", wins: 3 });
  });
  test("3승에서 승리 → 승급", () => {
    expect(getNextRankState("gold5", 3, "win")).toEqual({ rank: "gold4", wins: 0 });
    expect(getNextRankState("gold1", 3, "win")).toEqual({ rank: "platinum5", wins: 0 });
  });
  test("패배해도 승수 안 떨어짐", () => {
    expect(getNextRankState("gold3", 2, "lose")).toEqual({ rank: "gold3", wins: 2 });
    expect(getNextRankState("gold3", 0, "lose")).toEqual({ rank: "gold3", wins: 0 });
  });
});

// 플래티넘: 4승으로 승급, 패배 시 승수 감소, 5티어 강등 없음, -3에서 패배 시 강등
describe("플래티넘", () => {
  test("승수 증가", () => {
    expect(getNextRankState("platinum3", 0, "win")).toEqual({ rank: "platinum3", wins: 1 });
    expect(getNextRankState("platinum3", 2, "win")).toEqual({ rank: "platinum3", wins: 3 });
  });
  test("3승에서 승리 → 승급", () => {
    expect(getNextRankState("platinum3", 3, "win")).toEqual({ rank: "platinum2", wins: 0 });
    expect(getNextRankState("platinum1", 3, "win")).toEqual({ rank: "diamond5", wins: 0 });
  });
  test("패배 시 승수 감소", () => {
    expect(getNextRankState("platinum3", 2, "lose")).toEqual({ rank: "platinum3", wins: 1 });
    expect(getNextRankState("platinum3", 0, "lose")).toEqual({ rank: "platinum3", wins: -1 });
  });
  test("마이너스에서 승리 시 1승으로 점프", () => {
    expect(getNextRankState("platinum3", -2, "win")).toEqual({ rank: "platinum3", wins: 1 });
  });
  test("-3에서 패배 → 강등", () => {
    expect(getNextRankState("platinum3", -3, "lose")).toEqual({ rank: "platinum4", wins: 0 });
    expect(getNextRankState("platinum2", -3, "lose")).toEqual({ rank: "platinum3", wins: 0 });
  });
  test("5티어에서 0승 패배 → 변화 없음", () => {
    expect(getNextRankState("platinum5", 0, "lose")).toEqual({ rank: "platinum5", wins: 0 });
  });
  test("5티어에서 승수 마이너스 안 됨", () => {
    expect(getNextRankState("platinum5", 1, "lose")).toEqual({ rank: "platinum5", wins: 0 });
  });
});

// 다이아: 4승으로 승급, 패배 시 승수 감소, 5티어 강등 없음, -2에서 패배 시 강등
describe("다이아", () => {
  test("3승에서 승리 → 승급", () => {
    expect(getNextRankState("diamond3", 3, "win")).toEqual({ rank: "diamond2", wins: 0 });
    expect(getNextRankState("diamond1", 3, "win")).toEqual({ rank: "master5", wins: 0 });
  });
  test("패배 시 승수 감소", () => {
    expect(getNextRankState("diamond3", 1, "lose")).toEqual({ rank: "diamond3", wins: 0 });
  });
  test("마이너스에서 승리 시 1승으로 점프", () => {
    expect(getNextRankState("diamond3", -1, "win")).toEqual({ rank: "diamond3", wins: 1 });
  });
  test("-2에서 패배 → 강등", () => {
    expect(getNextRankState("diamond3", -2, "lose")).toEqual({ rank: "diamond4", wins: 0 });
  });
  test("5티어에서 강등 없음", () => {
    expect(getNextRankState("diamond5", 0, "lose")).toEqual({ rank: "diamond5", wins: 0 });
  });
});

// 마스터: 5승으로 승급, 5티어/1티어 강등 없음, -2에서 패배 시 강등
describe("마스터", () => {
  test("4승에서 승리 → 승급", () => {
    expect(getNextRankState("master5", 4, "win")).toEqual({ rank: "master4", wins: 0 });
    expect(getNextRankState("master3", 4, "win")).toEqual({ rank: "master2", wins: 0 });
    expect(getNextRankState("master2", 4, "win")).toEqual({ rank: "master1", wins: 0 });
  });
  test("마스터5에서 0승 패배 → 변화 없음", () => {
    expect(getNextRankState("master5", 0, "lose")).toEqual({ rank: "master5", wins: 0 });
  });
  test("마스터5에서 강등 안 됨", () => {
    expect(getNextRankState("master5", 1, "lose")).toEqual({ rank: "master5", wins: 0 });
  });
  test("마스터4 -2에서 패배 → 강등", () => {
    expect(getNextRankState("master4", -2, "lose")).toEqual({ rank: "master5", wins: 0 });
  });
  test("마스터2 -2에서 패배 → 마스터3으로 강등", () => {
    expect(getNextRankState("master2", -2, "lose")).toEqual({ rank: "master3", wins: 0 });
  });
  test("마스터1 → 영구 고정", () => {
    expect(getNextRankState("master1", null, "win")).toEqual({ rank: "master1", wins: null });
    expect(getNextRankState("master1", null, "lose")).toEqual({ rank: "master1", wins: null });
  });
  test("마이너스에서 승리 시 1승으로 점프", () => {
    expect(getNextRankState("master3", -1, "win")).toEqual({ rank: "master3", wins: 1 });
  });
});
