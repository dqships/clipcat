/** The ClipCat mark: a C with a wedge trimmed out and two ears. Geometry from brand/scripts; never redrawn. */
export function Mark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="16 7 65.137 85" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path
        fill="currentColor"
        d="M60.725 49.001 L79.137 33.551 L76.000 9.000 L65.023 29.746 A32 32 0 0 0 34.977 29.746 L24.000 9.000 L18.258 53.945 A32 32 0 0 0 74.513 78.569 L60.725 66.999 A14 14 0 1 1 60.725 49.001 Z"
      />
    </svg>
  );
}

/** Lucide "download", at the design system's stroke. */
export function DownloadIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
