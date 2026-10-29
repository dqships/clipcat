// The thumbnail as the exported video's cover art: drawn off screen the same
// way the Thumbnail panel draws it, and handed to the export as a PNG.

import type { Project } from "@clipcat/core";
import { mediaUrl } from "../format";
import { THUMBNAIL, drawThumbnail, loadThumbnailFont } from "./thumbnail";

/** Loads a picture from the project's media so a canvas can draw it and still be saved. */
function picture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}

/** The project's thumbnail as a base64 PNG, or null when it has none or it can't be drawn here. */
export async function coverPng(project: Project): Promise<string | null> {
  const t = project.thumbnail;
  if (!t) return null;
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL.width;
  canvas.height = THUMBNAIL.height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const [frame, subject] = await Promise.all([picture(mediaUrl(project.id, t.frame)), t.subject ? picture(mediaUrl(project.id, t.subject)) : null, loadThumbnailFont()]);
  drawThumbnail(g, { frame, subject }, t, t.text || project.suggestedTitle);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}
