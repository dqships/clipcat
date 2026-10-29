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

/** A position in the edit to the hundredth: 75.426 → "1:15.42", 3725 → "1:02:05.00". */
export function formatTimecode(seconds: number): string {
  const cs = Math.max(0, Math.floor(seconds * 100 + 1e-6));
  const whole = Math.floor(cs / 100);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const rest = `${String(whole % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}
