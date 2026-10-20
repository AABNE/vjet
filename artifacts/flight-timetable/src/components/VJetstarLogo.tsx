/**
 * vJetstar brand logo — real wordmark + orange star (transparent PNG).
 * `light` renders the white-text variant for dark backgrounds.
 * `mark` renders the compact 1:1 "vJet★" mark instead of the full wordmark.
 */
const BASE = import.meta.env.BASE_URL;

export function VJetstarLogo({
  height = 32,
  className = "",
  light = false,
  mark = false,
}: {
  height?: number;
  className?: string;
  light?: boolean;
  mark?: boolean;
}) {
  const file = mark
    ? (light ? "vjet-mark-light.png" : "vjet-mark.png")
    : (light ? "vjetstar-wide-light.png" : "vjetstar-wide.png");
  return (
    <img
      src={`${BASE}brand/${file}`}
      alt="vJetstar"
      height={height}
      style={{ height, width: "auto" }}
      className={className}
      draggable={false}
    />
  );
}
