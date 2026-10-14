import { describe, expect, it } from "vitest";
import { absoluteUrls, familiesInCss, fontFaceRules, googleFamilies, parseFontPaste } from "./webFontPaste";

describe("pasted web fonts", () => {
  it("finds the stylesheets and @font-face rules in what was pasted", () => {
    expect(parseFontPaste('<link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&amp;display=swap" rel="stylesheet">').urls)
      .toEqual(["https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&display=swap"]);
    expect(parseFontPaste("@import url('https://hangeul.pstatic.net/hangeul_static/css/maru-buri.css');").urls)
      .toEqual(["https://hangeul.pstatic.net/hangeul_static/css/maru-buri.css"]);
    expect(parseFontPaste('@import "https://a.example/x.css";').urls).toEqual(["https://a.example/x.css"]);
    expect(parseFontPaste(" https://a.example/x.css \n").urls).toEqual(["https://a.example/x.css"]);
    const inline = parseFontPaste("@font-face { font-family: 'A'; src: url(a.woff2); }\nbody { color: red }");
    expect([inline.urls, inline.css]).toEqual([[], "@font-face { font-family: 'A'; src: url(a.woff2); }"]);
  });

  it("keeps nothing but @font-face, its addresses made absolute", () => {
    expect(fontFaceRules("/* x */ @font-face{font-family:A} .x{color:red}")).toBe("@font-face{font-family:A}");
    expect(absoluteUrls("src: url(../f/a.woff2), url('data:font/woff2;base64,AA')", "https://a.example/css/x.css"))
      .toBe("src: url(https://a.example/f/a.woff2), url('data:font/woff2;base64,AA')");
  });

  it("names each family with its weights", () => {
    const css = `@font-face { font-family: 'Noto Serif KR'; font-weight: 700; src: url(a) }
      @font-face { font-family: 'Noto Serif KR'; font-weight: 400; unicode-range: U+AC00-D7A3; src: url(b) }
      @font-face { font-family: "Pretendard Variable"; font-weight: 45 920; src: url(c) }
      @font-face { font-family: MaruBuri; src: url(d) }`;
    expect(familiesInCss(css)).toEqual([
      { family: "Noto Serif KR", weights: [400, 700], ranges: [] },
      { family: "Pretendard Variable", weights: [], ranges: [[45, 920]] },
      { family: "MaruBuri", weights: [400], ranges: [] },
    ]);
    expect(googleFamilies("https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@700&family=Gowun+Batang")).toEqual(["Noto Serif KR", "Gowun Batang"]);
  });
});
