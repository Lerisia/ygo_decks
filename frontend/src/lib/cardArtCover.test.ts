import { describe, expect, it } from "vitest";
import { artLabels, coverCrop } from "./cardArtCover";

describe("coverCrop", () => {
  it("takes a square art whole", () => {
    expect(coverCrop(512, 512, false, "top")).toEqual({ sx: 0, sy: 0, sw: 512, sh: 512, side: 512 });
  });

  it("moves the square down a 펜듈럼 art", () => {
    expect(coverCrop(512, 653, false, "top").sy).toBe(0);
    expect(coverCrop(512, 653, false, "center").sy).toBe(70.5);
    expect(coverCrop(512, 653, false, "bottom")).toEqual({ sx: 0, sy: 141, sw: 512, sh: 512, side: 512 });
  });

  it("draws an 오버프레임 art back out to the card's width", () => {
    expect(coverCrop(512, 1024, true, "center")).toEqual({ sx: 0, sy: 160, sw: 512, sh: 704, side: 704 });
  });
});

describe("artLabels", () => {
  it("names the prints as the card page does, and the region when there are two", () => {
    const art = (id: number, version: "common" | "ocg" | "tcg", overframe = false) => ({ id, version, url: "", overframe });
    expect(artLabels([art(3, "ocg"), art(3, "tcg"), art(3901, "common"), art(3902, "common", true)])).toEqual([
      { print: "기본 일러스트", version: "일본판" },
      { print: "기본 일러스트", version: "한국판" },
      { print: "다른 일러 1", version: "" },
      { print: "오버프레임", version: "" },
    ]);
  });
});
