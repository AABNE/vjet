/**
 * vJetstar brand logo — black bold wordmark + orange star
 * Matches the real Jetstar branding image provided
 */
export function VJetstarLogo({
  height = 32,
  className = "",
  light = false,
}: {
  height?: number;
  className?: string;
  /** light=true renders text in white (for dark backgrounds) */
  light?: boolean;
}) {
  const textColor = light ? "#ffffff" : "#111111";
  const width = Math.round(height * 4.4);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 440 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="vJetstar"
    >
      {/* wordmark: bold black "vJetstar" */}
      <text
        x="0"
        y="86"
        fontFamily="'Arial Black', 'Arial Bold', Arial, 'Helvetica Neue', sans-serif"
        fontWeight="900"
        fontSize="88"
        fill={textColor}
        letterSpacing="-1"
      >
        vJetstar
      </text>
      {/* Orange 5-pointed star — top right, matching logo proportions */}
      <polygon
        points="410,2 422,36 458,36 430,57 440,91 410,70 380,91 390,57 362,36 398,36"
        fill="#fb5713"
      />
    </svg>
  );
}
