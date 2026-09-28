/**
 * Closed JSON Schemas for schema-constrained output (Anthropic output_config.format).
 * Every key is required; "not applicable" is expressed as null. The zod schemas in ./schemas.ts
 * remain the final validator for every provider. Consistency is tested in jsonSchemas.test.ts.
 */
type Schema = Record<string, unknown>;

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
const nullable = (t: "string" | "number" | "boolean") => ({ type: [t, "null"] });
const strList = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableObj = (o: Schema) => ({ anyOf: [o, { type: "null" }] });
const signal = { type: "string", enum: ["BUY", "SELL", "HOLD"] };
const bias = { type: "string", enum: ["Bullish", "Bearish", "Neutral"] };

const analysis = obj({
  signal,
  confidence: num,
  timeframe: str,
  tradeStyle: { type: "string", enum: ["Scalp", "Day Trade", "Swing"] },
  entry: num,
  stopLoss: num,
  takeProfit: num,
  risk_management: obj({
    leverage: str, leverageReasoning: str, positionSize: str, sizeReasoning: str, riskRewardRatio: str, distanceToTarget: str,
  }),
  supportResistance: obj({ support: { type: "array", items: num }, resistance: { type: "array", items: num } }),
  safeEntries: { type: "array", items: obj({ price: num, reasoning: str }) },
  reasoning: str,
  indicators_breakdown: { type: "array", items: obj({ name: str, value: str, signal: bias, explanation: str }) },
});

const tradeScreenshot = obj({
  symbol: nullable("string"),
  position: { type: ["string", "null"], enum: ["LONG", "SHORT", null] },
  entryPrice: nullable("number"),
  exitPrice: nullable("number"),
  leverage: nullable("number"),
  margin: nullable("number"),
  marginMode: { type: ["string", "null"], enum: ["Cross", "Isolated", null] },
  pnlPercent: nullable("number"),
  pnlUsd: nullable("number"),
});

const postMortem = obj({
  outcome: { type: "string", enum: ["WIN", "LOSS", "BREAKEVEN", "OPEN"] },
  rootCause: str,
  mistakes: strList,
  strengths: strList,
  lesson: str,
  tags: strList,
});

const n = nullable("number");
const annotation = obj({
  type: { type: "string", enum: ["hline", "line", "zone", "arrow_up", "arrow_down", "marker", "channel", "fib", "label"] },
  category: { type: ["string", "null"], enum: ["support", "resistance", "ob_bull", "ob_bear", "fvg_bull", "fvg_bear", "entry", "sl", "tp", "trendline", "bos", "choch", "pattern", "candlestick", "ema", "liquidity", "other", null] },
  color: str,
  label: nullable("string"),
  priority: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
  note: nullable("string"),
  y: n, x1: n, y1: n, x2: n, y2: n,
  zx: n, zy: n, zw: n, zh: n,
  mx: n, my: n,
  cy1a: n, cy1b: n, cy2a: n, cy2b: n,
  dashed: nullable("boolean"),
  thickness: n,
  fillOpacity: n,
});

const chartAcademy = obj({
  overallSignal: signal,
  confluenceScore: num,
  summary: str,
  lesson: str,
  patterns: strList,
  tags: strList,
  mistakes: strList,
  strengths: strList,
  timeframes: {
    type: "array",
    items: obj({
      timeframe: str,
      signal,
      bias: str,
      reasoning: str,
      candlestickPattern: nullableObj(obj({ name: str, location: str, x: num, y: num, bullish: bool })),
      chartPattern: nullableObj(obj({ name: str, description: str })),
      keyLevels: { type: "array", items: obj({ type: str, price: str, y_pct: num, description: str }) },
      entryPlan: obj({ entry_y: num, sl_y: num, tp1_y: num, tp2_y: n, rrr: str }),
      annotations: { type: "array", items: annotation },
    }),
  },
});

export const JSON_SCHEMAS = { analysis, tradeScreenshot, postMortem, chartAcademy } as const;
