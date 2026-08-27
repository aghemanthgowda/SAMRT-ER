/**
 * The SMART-ER mark: an angular S inside a hexagon.
 *
 * Drawn rather than imported so it stays crisp at every size, inherits the
 * surrounding colour, and costs nothing to load on the sign-in screen — which
 * is the one screen that must render before any asset has arrived.
 */
export function SmartErMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="SMART-ER">
      <path d="M24 1.5 43.6 12.75v22.5L24 46.5 4.4 35.25v-22.5z" fill="currentColor" />
      <path
        d="M31.5 16.25H20.25v6.5h7.5v8.5H16.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth={4.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** Wordmark: "SMART" in ink, "-ER" in brand blue, as on the sign-in screen. */
export function SmartErWordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-ink-900">SMART</span>
      <span className="text-brand-600">-ER</span>
    </span>
  );
}
