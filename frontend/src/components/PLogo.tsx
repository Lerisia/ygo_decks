/** Circular "P" badge — represents the site's point currency.
 * Used in the Navbar (next to the user's balance) and as a corner badge
 * on game tiles where points can be earned. SVG implementation so the
 * glyph sits visually centered (the unicode "P" otherwise renders skewed
 * toward the top-left in a flex-centered span). */
export default function PLogo({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label="포인트"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={className}
    >
      <circle cx="10" cy="10" r="10" fill="#2563eb" />
      {/* baseline placement is more reliable than dominantBaseline across
          fonts/browsers — caps sit ~70% of fontSize above the baseline,
          so put the baseline a bit below the geometric center. */}
      <text
        x="10"
        y="14.5"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
        fill="white"
      >
        P
      </text>
    </svg>
  );
}
