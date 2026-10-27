/**
 * The library's empty state, drawn in code: three film frames on a strip,
 * the middle one trimmed by a wedge and held by a piece of splice tape.
 * Colors come from tokens through CSS classes, so it follows light and dark.
 */
export function EmptyStrip() {
  return (
    <svg className="strip" viewBox="0 0 240 96" role="img" aria-label="An empty film strip with one frame trimmed">
      <rect className="strip__film" x="0" y="16" width="240" height="64" />
      {[8, 28, 48, 68, 88, 108, 128, 148, 168, 188, 208, 228].map((x) => (
        <g key={x}>
          <rect className="strip__hole" x={x - 4} y="22" width="8" height="6" />
          <rect className="strip__hole" x={x - 4} y="68" width="8" height="6" />
        </g>
      ))}
      <rect className="strip__frame" x="12" y="34" width="64" height="28" />
      <path className="strip__frame" d="M88 34H152L132 48L152 62H88Z" />
      <rect className="strip__frame" x="164" y="34" width="64" height="28" />
      <rect className="strip__tape" x="104" y="8" width="16" height="80" />
    </svg>
  );
}
