/** 75.4 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The media:// URL of a prepared file, from its project-relative path ("media/<source>/proxy.mp4"). */
export function mediaUrl(projectId: string, relPath: string): string {
  const inside = relPath.replace(/^media\//, "");
  return `media://${projectId}/${inside.split("/").map(encodeURIComponent).join("/")}`;
}
