import { describe, expect, it } from "vitest";
import { SLIDE_CSP, SLIDE_FONTS, fontFaces, slidePage, slideProblems } from "./page";

describe("slidePage", () => {
  it("wraps the body with the policy, the look, the fonts and MotionKit", () => {
    const fonts = fontFaces([{ font: SLIDE_FONTS[0]!, data: Buffer.from("ttf") }]);
    expect(fonts).toContain(`src:url(data:font/ttf;base64,${Buffer.from("ttf").toString("base64")})`);
    const page = slidePage("<h1>Hi</h1>", "ink", fonts);
    expect(page).toContain(`content="${SLIDE_CSP}"`);
    expect(page).toContain("--background:#17150F;--text:#FAF8F3");
    expect(page).toContain("window.motion = motion");
    expect(page).toMatch(/<body data-look="ink">\n<h1>Hi<\/h1>\n<\/body>/);
    expect(slidePage("", "overlay", "")).toContain("--background:transparent");
  });
});

describe("slideProblems", () => {
  it("accepts a self-contained animated slide", () => {
    expect(slideProblems(`<style>h1{animation:in .4s var(--spring) both}@keyframes in{from{opacity:0}}</style><h1>Hi</h1><svg viewBox="0 0 10 10"><rect width="10" height="2"/></svg>`)).toEqual([]);
  });

  it("refuses a whole document, anything loaded, media, the clock and transitions", () => {
    const problems = slideProblems(
      `<html><img src="https://x.test/a.png"><video></video><script>setTimeout(() => {}, 9)</script><style>a{transition: opacity 1s}</style>`,
    );
    expect(problems).toHaveLength(5);
    expect(slideProblems(`<style>@import url("x.css")</style>`)[0]).toContain("can't load anything");
  });
});
