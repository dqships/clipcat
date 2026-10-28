// The page a motion slide runs in. The AI editor writes only the body: its
// elements, a <style> and maybe a <script>. ClipCat wraps that in a page with
// the cutting-room palette, the spring and Jost (embedded, since the page may
// load nothing), and the MotionKit runtime, which pauses every animation and
// steps them through time: `window.motion.seek(t)` shows second `t`, so the
// renderer can capture frame by frame and the preview can follow the
// playhead. The same page is served to both on slide://, under a policy that
// lets nothing in or out.

import type { SlideLook } from "@clipcat/core";
import tokens from "../../../../design/tokens.json";

/** Nothing loads from anywhere: styles, scripts and fonts are all in the page. */
export const SLIDE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:";

/** The colors the AI editor designs with, named for the cutting room. */
export const SLIDE_COLORS = {
  paper: tokens.light["color-background"],
  ink: tokens.light["color-text"],
  tape: tokens.light["color-accent"],
  muted: tokens.light["color-text-muted"],
} as const;

/** What a slide's background and text are in each look; an overlay has no background of its own. */
export const LOOKS: Record<SlideLook, { background: string; text: string }> = {
  paper: { background: SLIDE_COLORS.paper, text: SLIDE_COLORS.ink },
  ink: { background: SLIDE_COLORS.ink, text: SLIDE_COLORS.paper },
  overlay: { background: "transparent", text: SLIDE_COLORS.paper },
};

/** Jost SemiBold, split like Google Fonts serves it. */
export type SlideFont = { file: string; unicodeRange: string };
export const SLIDE_FONTS: SlideFont[] = [
  {
    file: "Jost-SemiBold-latin.ttf",
    unicodeRange:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    file: "Jost-SemiBold-latin-ext.ttf",
    unicodeRange:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
];

/** The @font-face rules, with each font's bytes inline. */
export function fontFaces(fonts: { font: SlideFont; data: Buffer }[]): string {
  return fonts
    .map(
      ({ font, data }) =>
        `@font-face{font-family:"Jost";font-weight:100 900;font-style:normal;src:url(data:font/ttf;base64,${data.toString("base64")}) format("truetype");unicode-range:${font.unicodeRange}}`,
    )
    .join("\n");
}

/**
 * MotionKit. Animations are paused at once and only ever moved by seek, so
 * every frame is the same however slowly it renders. `duration` is the end of
 * the last finite animation unless the page sets it; `onSeek` is for anything
 * a script draws from the time. Errors are kept for the AI editor to read.
 */
export const MOTION_RUNTIME = `(() => {
  const errors = [];
  const say = (e) => errors.push(String((e && e.message) || e).slice(0, 300));
  addEventListener("error", (e) => say(e.error || e.message));
  addEventListener("unhandledrejection", (e) => say(e.reason));
  const hooks = [];
  let fixed = null;
  let now = 0;
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const end = () => {
    let max = 0;
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getComputedTiming().endTime;
      if (typeof t === "number" && Number.isFinite(t)) max = Math.max(max, t);
    }
    return max / 1000;
  };
  const show = (t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t * 1000;
    }
    for (const f of hooks) {
      try { f(t); } catch (e) { say(e); }
    }
  };
  const motion = {
    errors,
    get duration() { return fixed === null ? end() : fixed; },
    set duration(v) { fixed = Math.max(0, Number(v) || 0); },
    get time() { return now; },
    onSeek(f) {
      hooks.push(f);
      try { f(now); } catch (e) { say(e); }
    },
    seek(t) {
      now = Math.max(0, Number(t) || 0);
      show(now);
      return settle();
    },
  };
  motion.ready = new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", () => r(), { once: true })))
    .then(() => document.fonts.ready)
    .then(() => {
      show(now);
      return settle();
    });
  document.addEventListener("DOMContentLoaded", () => show(now));
  addEventListener("message", (e) => {
    if (e.data && e.data.type === "clipcat-seek") motion.seek(e.data.t);
  });
  window.motion = motion;
})();`;

const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The whole page for a slide's body. */
export function slidePage(body: string, look: SlideLook, fonts: string): string {
  const { background, text } = LOOKS[look];
  const css = [
    fonts,
    `:root{--paper:${SLIDE_COLORS.paper};--ink:${SLIDE_COLORS.ink};--tape:${SLIDE_COLORS.tape};--muted:${SLIDE_COLORS.muted};` +
      `--spring:${tokens.light["motion-spring"]};--spring-duration:${tokens.light["motion-duration"]};` +
      `--font:${tokens.light["font-family"]};--background:${background};--text:${text}}`,
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}",
    "html{background:transparent}",
    "body{position:relative;background:var(--background);color:var(--text);font-family:var(--font);font-weight:600;line-height:1.1;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}",
  ].join("\n");
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(SLIDE_CSP)}">`,
    `<style>${css}</style>`,
    `<script>${MOTION_RUNTIME}</script>`,
    `</head><body data-look="${look}">`,
    body,
    "</body></html>",
  ].join("\n");
}

/** Problems with a slide's HTML that can be seen without running it. */
export function slideProblems(html: string): string[] {
  const problems: string[] = [];
  if (/<\s*(html|head|body)[\s>]/i.test(html)) problems.push("Write only what goes inside <body>: no <html>, <head> or <body> tags.");
  if (/\b(src|href)\s*=\s*["']?\s*(https?:|\/\/|file:)/i.test(html) || /url\(\s*["']?\s*(https?:|\/\/|file:)/i.test(html) || /@import/i.test(html)) {
    problems.push("The slide can't load anything: no links, web images, web fonts or external scripts. Draw with CSS or inline SVG.");
  }
  if (/<\s*(video|audio|iframe|object|embed)[\s>]/i.test(html)) problems.push("No <video>, <audio>, <iframe>, <object> or <embed>.");
  if (/\b(setTimeout|setInterval|requestAnimationFrame|Date\.now|new Date|performance\.now)\b/.test(html)) {
    problems.push("Don't drive motion from the clock (setTimeout, setInterval, requestAnimationFrame, Date, performance.now): ClipCat steps time itself. Use CSS animations, the Web Animations API, or motion.onSeek(t => …).");
  }
  if (/\btransition\s*:/i.test(html) && !/@keyframes|\.animate\(/.test(html)) problems.push("Transitions only run on a change ClipCat never makes. Use CSS animations (@keyframes) instead.");
  return problems;
}
