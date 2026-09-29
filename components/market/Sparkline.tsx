interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

/** Tiny close-price line; colour comes from the parent via `currentColor`. */
export default function Sparkline({ values, width = 56, height = 24, className }: SparklineProps) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i * width) / (values.length - 1)).toFixed(1)} ${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
