// B-roll: the user's pictures and videos shown over the speaker for a few
// seconds, filling the frame or in a window in one corner, while the speech
// plays on. Like punch-ins they sit in source time on accepted "visual"
// proposals, so they follow their words through edits, and are timed on the
// output for the export and the preview. Both lay the window out with
// `overlayBox`, so the preview shows what the export renders.

import { z } from "zod";
import type { Asset, Overlay, OverlayPlacement, Project, Proposal, Range } from "./project";
import { outputSpan } from "./punchins";
import type { Timeline } from "./timeline";

export const OVERLAY = {
  /** Source seconds b-roll may cover. */
  min: 1.5,
  max: 15,
  /** The window's distance from the frame's edges, as a share of its shorter side. */
  margin: 0.04,
  /** Corner rounding of a rectangle or square window, as a share of its shorter side. */
  radius: 0.08,
} as const;

/** Accepted b-roll on the output timeline, with its media. */
export type TimedOverlay = Overlay & { id: string; sourceId: string; asset: Asset; start: number; end: number };

/**
 * The b-roll in effect: accepted visual proposals whose media is prepared,
 * timed on `timeline`, in play order. Where two would overlap, the earlier
 * one ends as the next one starts.
 */
export function timedOverlays(project: Pick<Project, "proposals" | "assets">, timeline: Pick<Timeline, "items" | "speed">): TimedOverlay[] {
  const assets = new Map(project.assets.filter((a) => a.prep).map((a) => [a.id, a]));
  const out: TimedOverlay[] = [];
  for (const p of project.proposals) {
    if (p.status !== "accepted" || !p.overlay) continue;
    const asset = assets.get(p.overlay.assetId);
    const span = asset && outputSpan(timeline, p.sourceId, p.overlay.range);
    if (!asset || !span || span[1] - span[0] <= 0) continue;
    out.push({ ...p.overlay, id: p.id, sourceId: p.sourceId, asset, start: span[0], end: span[1] });
  }
  out.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length - 1; i++) out[i]!.end = Math.min(out[i]!.end, out[i + 1]!.start);
  return out.filter((o) => o.end > o.start);
}

/** Seconds into the media at output time `t`: a video or slide plays on from its offset and holds its last frame; a picture is a picture. */
export function overlayTime(o: Pick<TimedOverlay, "asset" | "offset" | "start">, t: number): number {
  if (o.asset.kind === "image") return 0;
  return Math.max(0, Math.min(o.offset + (t - o.start), o.asset.media.duration));
}

/** The b-roll showing at output time `t`, if any. */
export function overlayAt(overlays: TimedOverlay[], t: number): TimedOverlay | null {
  return overlays.find((o) => t >= o.start && t < o.end) ?? null;
}

export type Box = { x: number; y: number; width: number; height: number; radius: number };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Where b-roll sits in a frame, in whole pixels (even sizes, for the encoder), and how round its corners are. */
export function overlayBox(o: Pick<Overlay, "placement" | "shape" | "corner" | "size">, frame: { width: number; height: number }): Box {
  const { width: W, height: H } = frame;
  if (o.placement === "full") return { x: 0, y: 0, width: W, height: H, radius: 0 };
  const short = Math.min(W, H);
  const width = o.shape === "rectangle" ? even(o.size * W) : even(o.size * short);
  const height = o.shape === "rectangle" ? even((width * 9) / 16) : width;
  const margin = Math.round(OVERLAY.margin * short);
  const x = o.corner.endsWith("left") ? margin : W - width - margin;
  const y = o.corner.startsWith("top") ? margin : H - height - margin;
  const radius = o.shape === "circle" ? width / 2 : Math.round(OVERLAY.radius * Math.min(width, height));
  return { x, y, width, height, radius };
}

/** B-roll as it first appears: the window, when it's one, in the top right, clear of the captions. */
export function defaultOverlay(range: Range, assetId: string, placement: OverlayPlacement): Overlay {
  return { range, assetId, placement, shape: "rectangle", corner: "top-right", size: 0.35, offset: 0 };
}

/** A b-roll proposal over `overlay.range` of `sourceId`. */
export function overlayProposal(fields: Pick<Proposal, "id" | "sourceId" | "wordIds" | "reason" | "confidence" | "status">, overlay: Overlay): Proposal {
  return { ...fields, type: "visual", cuts: [], keepWordIds: [], punch: null, overlay, sound: null, music: null };
}

/** The agent's answer when describing media: one sentence or two for each, by its number in the list it was shown. */
export const AgentDescriptions = z.object({
  descriptions: z.array(z.object({ media: z.number().int(), description: z.string().min(1).max(400) })).max(100),
});
export type AgentDescriptions = z.infer<typeof AgentDescriptions>;

/** Checks the descriptions against the media the agent was shown; the result maps media ids to descriptions. */
export function validateDescriptions(answer: AgentDescriptions, assets: Pick<Asset, "id">[]): { descriptions: Map<string, string>; errors: string[] } {
  const descriptions = new Map<string, string>();
  const errors: string[] = [];
  answer.descriptions.forEach((d, i) => {
    const asset = assets[d.media];
    if (!asset) errors.push(`description ${i}: media must be a number from 0 to ${assets.length - 1}`);
    else if (descriptions.has(asset.id)) errors.push(`description ${i}: media ${d.media} is described twice`);
    else descriptions.set(asset.id, d.description.trim());
  });
  const missing = assets.map((_, i) => i).filter((i) => !descriptions.has(assets[i]!.id));
  if (missing.length > 0) errors.push(`media ${missing.join(", ")}: not described`);
  return { descriptions, errors };
}
