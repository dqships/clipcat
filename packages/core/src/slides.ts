// Motion slides: short animated cards (a title, a list, a number) the AI
// editor designs in HTML and CSS for a line, shown as full-frame b-roll. A
// slide is an asset of kind "slide" placed by an ordinary b-roll proposal,
// so it follows its words through edits like any other b-roll.

import { z } from "zod";
import type { AspectRatio, Asset, SlideLook } from "./project";

export const SLIDE = {
  /** Source seconds a slide may cover. */
  min: 2,
  max: 10,
} as const;

/** The AI editor's design: the slide's body, in HTML and CSS. */
export const AgentSlide = z.object({ html: z.string().min(1).max(200_000) });
export type AgentSlide = z.infer<typeof AgentSlide>;

/** The frame a slide is designed and checked in, for the project's shape. */
export function slideSize(aspect: AspectRatio): { width: number; height: number } {
  return aspect === "9:16" ? { width: 1080, height: 1920 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
}

/** A name for the media list, from the slide's brief. */
export function slideName(brief: string): string {
  const line = brief.trim().split("\n")[0]!.replace(/\s+/g, " ");
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || "Slide";
}

/** A slide still to be designed: no HTML yet, so nothing shows until the AI editor has written it. */
export function slideAsset(id: string, brief: string, look: SlideLook, duration: number): Asset {
  return {
    id,
    name: slideName(brief),
    path: "",
    kind: "slide",
    media: { duration, width: 0, height: 0 },
    prep: null,
    description: brief.trim(),
    slide: { brief: brief.trim(), look, html: "" },
  };
}

/** Slides nothing uses any more: their proposal was replaced by a rerun. */
export function unusedSlides(assets: Pick<Asset, "id" | "kind">[], proposals: { overlay: { assetId: string } | null }[]): Set<string> {
  const used = new Set(proposals.flatMap((p) => (p.overlay ? [p.overlay.assetId] : [])));
  return new Set(assets.filter((a) => a.kind === "slide" && !used.has(a.id)).map((a) => a.id));
}
