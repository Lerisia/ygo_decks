import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Info, { NextTiles } from "./Info";
import { metaChip } from "@/lib/homeTiles";

const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const order = (html: string, words: string[]) => words.map((w) => text(html).indexOf(w));

describe("the live home (/)", () => {
  const html = render(<Info />);

  it("keeps the 팩깡 pillar", () => {
    expect(html).toContain('aria-labelledby="home-packs"');
    expect(html).toContain("팩 열러 가기");
  });

  it("keeps its six tiles in their order", () => {
    // the 준비 중 chip sits over its title there
    const tiles = ["전적 시트", "메타 통계·내 전적", "놀이터", "퀴즈·미니게임", "티어표 만들기", "AI 덱 스캔", "포인트 상점", "포인트로 아이콘·프레임 사기", "준비 중", "대회"];
    const at = order(html.slice(html.indexOf('id="home-more"')), tiles);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("grid grid-cols-3 lg:grid-cols-6");
    expect(html).not.toContain("data-chip");
  });
});

describe("/dev/home", () => {
  it("shows nothing until the server says this is an operator", () => {
    expect(render(<Info layout="next" />)).toBe('<div class="min-h-screen"></div>');
  });

  const html = render(<NextTiles season={{ season: 58, cup_stage: null }} />);

  it("lays the six tiles out 3 × 2 in 참혈's order", () => {
    expect(html).toMatch(/^<div class="grid grid-cols-3 auto-rows-fr /);
    const tiles = ["메타 통계", "팩깡 시뮬레이터", "대회", "놀이터", "티어표 만들기", "포인트 상점"];
    const at = order(html, tiles);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text(html)).not.toContain("AI 덱 스캔");
    expect(text(html)).not.toContain("전적 시트");
  });

  it("says what 참혈 asked", () => {
    const t = text(html).replace(/\u00a0/g, " ");
    for (const s of ["간편하게 개최 • 참가", "미니게임을 즐기고 포인트 획득", "만들고 이미지로", "각종 꾸미기 아이템 구매", "개발 중", "베타"]) expect(t).toContain(s);
  });

  it("links where each tile goes, the 대회 nowhere", () => {
    for (const to of ["/records", "/packs", "/playground", "/tier-list-maker", "/icon-shop"]) expect(html).toContain(`href="${to}"`);
    expect(html).toMatch(/<div aria-disabled="true"[^>]*>.*?대회/);
  });

  it("names the season in blue, a cup stage in purple", () => {
    expect(html).toContain('data-chip="season"');
    expect(text(html)).toContain("Season 58");
    expect(html).toMatch(/<a class="[^"]*border-blue-300[^"]*" href="\/records"/);
    const cup = render(<NextTiles season={{ season: 58, cup_stage: 2 }} />);
    expect(text(cup)).toContain("DC 2nd Stage");
    expect(cup).toMatch(/<a class="[^"]*border-purple-300[^"]*" href="\/records"/);
  });
});

describe("metaChip", () => {
  it("is the season outside a cup", () => {
    expect(metaChip(58, null)).toEqual({ tone: "season", label: "Season 58", tail: "" });
  });
  it("is the stage during one", () => {
    expect(metaChip(58, 1)).toEqual({ tone: "cup", label: "DC 1st", tail: " Stage" });
    expect(metaChip(59, 2)).toEqual({ tone: "cup", label: "DC 2nd", tail: " Stage" });
  });
});
