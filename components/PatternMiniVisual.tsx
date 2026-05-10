import type { CandlestickPatternMatch } from "@/lib/candlestickPatterns";
import type { ChartPatternMatch } from "@/lib/chartPatterns";

type VisualPattern = Pick<CandlestickPatternMatch, "key" | "bias"> | Pick<ChartPatternMatch, "key" | "bias">;

interface PatternMiniVisualProps {
  pattern?: VisualPattern | null;
  variant?: "candlestick" | "chart";
  className?: string;
}

const bullishCandle = "#34d399";
const bearishCandle = "#f87171";
const neutralCandle = "#94a3b8";
const lineColor = "#7dd3fc";
const supportColor = "#60a5fa";
const resistanceColor = "#f59e0b";

export default function PatternMiniVisual({ pattern, variant = "candlestick", className }: PatternMiniVisualProps) {
  if (!pattern) {
    return (
      <div className={className}>
        <svg viewBox="0 0 80 48" className="w-full h-full">
          <rect x="0" y="0" width="80" height="48" rx="12" fill="rgba(255,255,255,0.03)" />
          <path d="M12 34 C24 18, 38 30, 50 20 S68 18, 70 12" stroke={neutralCandle} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className={className}>
      {variant === "chart" ? <ChartPatternVisual pattern={pattern} /> : <CandlestickPatternVisual pattern={pattern} />}
    </div>
  );
}

function CandlestickPatternVisual({ pattern }: { pattern: VisualPattern }) {
  const key = pattern.key;
  const bullish = pattern.bias === "Bullish";
  const fill = bullish ? bullishCandle : pattern.bias === "Bearish" ? bearishCandle : neutralCandle;

  if (key.includes("engulfing") || key.includes("harami") || key.includes("tweezer") || key.includes("piercing") || key.includes("dark_cloud")) {
    return (
      <svg viewBox="0 0 80 48" className="w-full h-full">
        <BasePanel />
        <Candle x={22} openY={14} closeY={31} highY={9} lowY={36} fill={key.includes("bullish") ? bearishCandle : bullishCandle} width={9} />
        <Candle x={48} openY={34} closeY={13} highY={8} lowY={38} fill={fill} width={12} />
      </svg>
    );
  }

  if (key.includes("morning") || key.includes("evening") || key.includes("three_")) {
    return (
      <svg viewBox="0 0 80 48" className="w-full h-full">
        <BasePanel />
        <Candle x={18} openY={14} closeY={30} highY={10} lowY={35} fill={key.includes("morning") || key.includes("three_inside_up") || key.includes("three_outside_up") ? bearishCandle : bullishCandle} width={8} />
        <Candle x={38} openY={24} closeY={20} highY={16} lowY={30} fill={neutralCandle} width={7} />
        <Candle x={58} openY={31} closeY={13} highY={9} lowY={35} fill={fill} width={10} />
      </svg>
    );
  }

  if (key.includes("shooting") || key.includes("gravestone") || key.includes("inverted")) {
    return (
      <svg viewBox="0 0 80 48" className="w-full h-full">
        <BasePanel />
        <Candle x={40} openY={28} closeY={16} highY={5} lowY={33} fill={fill} width={12} />
      </svg>
    );
  }

  if (key.includes("hammer") || key.includes("dragonfly") || key.includes("hanging")) {
    return (
      <svg viewBox="0 0 80 48" className="w-full h-full">
        <BasePanel />
        <Candle x={40} openY={16} closeY={27} highY={12} lowY={42} fill={fill} width={12} />
      </svg>
    );
  }

  if (key.includes("spinning") || key.includes("doji")) {
    return (
      <svg viewBox="0 0 80 48" className="w-full h-full">
        <BasePanel />
        <Candle x={40} openY={20} closeY={24} highY={8} lowY={38} fill={fill} width={10} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 80 48" className="w-full h-full">
      <BasePanel />
      <Candle x={40} openY={28} closeY={12} highY={8} lowY={33} fill={fill} width={12} />
    </svg>
  );
}

function ChartPatternVisual({ pattern }: { pattern: VisualPattern }) {
  const key = pattern.key;

  return (
    <svg viewBox="0 0 80 48" className="w-full h-full">
      <BasePanel />
      {key.includes("flag") && (
        <>
          <path d="M12 36 L24 12" stroke={bullishCandle} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M28 18 L64 13" stroke={resistanceColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M28 30 L64 25" stroke={supportColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M30 28 L37 20 L44 26 L51 18 L58 22" stroke={lineColor} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {key.includes("triangle") && (
        <>
          <path d="M18 34 L56 14" stroke={resistanceColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M18 18 L56 34" stroke={supportColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M22 28 L28 22 L34 29 L40 23 L46 27 L52 24" stroke={lineColor} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {key.includes("wedge") && (
        <>
          <path d="M18 14 L58 24" stroke={resistanceColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M18 34 L58 28" stroke={supportColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M20 28 L27 22 L34 29 L41 23 L48 27 L55 24" stroke={lineColor} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {key.includes("channel") && (
        <>
          <path d="M16 33 L62 16" stroke={resistanceColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M16 24 L62 7" stroke={supportColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M18 29 L26 23 L34 26 L42 18 L50 20 L58 12" stroke={lineColor} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function BasePanel() {
  return <rect x="0.5" y="0.5" width="79" height="47" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />;
}

function Candle({ x, openY, closeY, highY, lowY, fill, width }: { x: number; openY: number; closeY: number; highY: number; lowY: number; fill: string; width: number }) {
  const top = Math.min(openY, closeY);
  const height = Math.max(Math.abs(openY - closeY), 3);

  return (
    <>
      <line x1={x} x2={x} y1={highY} y2={lowY} stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x={x - width / 2} y={top} width={width} height={height} rx="2" fill={fill} />
    </>
  );
}
