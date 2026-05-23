/**
 * WaveDivider -- a tasteful nautical accent shared by the public newsroom and
 * the client hub so both read as the same luxury, maritime world (not generic
 * SaaS). Pure inline SVG, no dependencies, server-render safe.
 *
 * Uses `currentColor`, so set the tone via a Tailwind text color on the wrapper
 * (e.g. text-brand for the gold horizon line). Two offset strokes suggest a calm
 * horizon swell; understated by design.
 */
export default function WaveDivider({
  className = '',
  width = 132
}: {
  className?: string;
  width?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={14}
      viewBox="0 0 132 14"
      fill="none"
      className={className}
      style={{ color: 'var(--brand)' }}
    >
      <path
        d="M1 9c8.5 0 8.5-5 17-5s8.5 5 17 5 8.5-5 17-5 8.5 5 17 5 8.5-5 17-5 8.5 5 17 5 8.5-5 17-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M1 13c8.5 0 8.5-5 17-5s8.5 5 17 5 8.5-5 17-5 8.5 5 17 5 8.5-5 17-5 8.5 5 17 5 8.5-5 17-5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}
