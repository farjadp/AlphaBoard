import { NextResponse } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  type: "hline" | "line" | "zone" | "arrow_up" | "arrow_down" | "marker" | "channel" | "fib" | "label";
  category: "support" | "resistance" | "ob_bull" | "ob_bear" | "fvg_bull" | "fvg_bear" | "entry" | "sl" | "tp" | "trendline" | "bos" | "choch" | "pattern" | "candlestick" | "ema" | "liquidity" | "other";
  color: string;
  label: string;
  priority: "high" | "medium" | "low";
  // hline: full-width horizontal line
  y?: number;
  // line / trendline: two points
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  // zone / rectangle: bounding box
  zx?: number; zy?: number; zw?: number; zh?: number;
  // marker / arrow: single point
  mx?: number; my?: number;
  // channel: two parallel lines (y values at x1 and x2)
  cy1a?: number; cy1b?: number; cy2a?: number; cy2b?: number;
  // style
  dashed?: boolean;
  thickness?: number;
  fillOpacity?: number;
  // extra info
  note?: string;
}

interface TimeframeAnalysis {
  timeframe: string;
  signal: "BUY" | "SELL" | "HOLD";
  bias: string;
  annotations: Annotation[];
  candlestickPattern: { name: string; location: string; x: number; y: number; bullish: boolean } | null;
  chartPattern: { name: string; description: string } | null;
  keyLevels: { type: string; price: string; y_pct: number; description: string }[];
  entryPlan: { entry_y: number; sl_y: number; tp1_y: number; tp2_y?: number; rrr: string };
  reasoning: string;
}

interface ChartAcademyResponse {
  overallSignal: "BUY" | "SELL" | "HOLD";
  confluenceScore: number;
  summary: string;
  lesson: string;
  patterns: string[];
  tags: string[];
  mistakes: string[];
  strengths: string[];
  timeframes: TimeframeAnalysis[];
}

// ─── Precision Prompt ─────────────────────────────────────────────────────────

function buildPrompt(timeframeLabels: string[]): string {
  return `You are an elite professional chart analyst combining ICT (Inner Circle Trader), Smart Money Concepts (SMC), classical technical analysis, and candlestick pattern expertise.

You will receive ${timeframeLabels.length} trading chart screenshot(s) for timeframes: ${timeframeLabels.join(", ")}.
Analyze them top-down (HTF to LTF) and return a structured JSON with PRECISE canvas annotations.

━━━ COORDINATE SYSTEM (CRITICAL — READ CAREFULLY) ━━━

ALL coordinates are PERCENTAGES (0.0–100.0) of the chart image dimensions.

AXES:
• X-axis: 0 = leftmost bar, 100 = rightmost bar (most recent price action)
• Y-axis: 0 = TOP of image (highest price visible), 100 = BOTTOM of image (lowest price visible)

CRITICAL RULES FOR ACCURACY:
1. LOOK at where price is currently on screen — if price is at the center, current price ≈ y=50
2. Levels ABOVE current price have LOWER y values (closer to 0 = top)
3. Levels BELOW current price have HIGHER y values (closer to 100 = bottom)
4. Recent candles are near x=85–100; older candles near x=0–30
5. Candlestick patterns (Doji, Hammer, Engulfing etc.) appear on RECENT candles → x should be 70–100
6. For zones: measure the TOP of the zone (zy) and height (zh) carefully
7. Support = BELOW price → y > current_price_y
8. Resistance = ABOVE price → y < current_price_y

━━━ WHAT TO IDENTIFY AND HOW TO ANNOTATE ━━━

**1. CANDLESTICK PATTERNS** (look at last 20 candles — near right side x=60–100)
Detect: Doji, Hammer, Inverted Hammer, Hanging Man, Shooting Star, Bullish/Bearish Engulfing, Morning/Evening Star, Harami, Pinbar, Marubozu, Three White Soldiers, Three Black Crows, Dark Cloud Cover, Piercing Line, Spinning Top, Tweezer Top/Bottom.
• Use type "marker" with mx (x position of candle) and my (y position of candle body center)
• category: "candlestick"
• Use arrow_up for bullish patterns, arrow_down for bearish patterns

**2. SUPPORT & RESISTANCE LEVELS**
Detect: historical swing highs/lows, round numbers, order flow levels.
• Use type "hline" with y = percentage from top
• priority "high" = tested 3+ times, "medium" = tested 2x, "low" = structural
• label must include price approximate (e.g., "Support ~42,500")

**3. ORDER BLOCKS (OB)**
Bullish OB = last bearish candle before a strong bullish impulse (demand zone)
Bearish OB = last bullish candle before a strong bearish impulse (supply zone)
• Use type "zone" with zx, zy (top of zone), zw=85, zh (height of zone)
• category: "ob_bull" or "ob_bear"
• fillOpacity: 0.2 for active, 0.1 for distant
• Measure zone from the open of the OB candle to its low (bullish) or high (bearish)

**4. FAIR VALUE GAPS (FVG)**
FVG = price gap between candle 1 high and candle 3 low (bullish) or vice versa.
• Use type "zone", category "fvg_bull" or "fvg_bear"
• Color: "#a78bfa" (purple)
• fillOpacity: 0.15
• FVGs are typically NARROW (zh = 2–5%)

**5. TREND LINES**
Connect at least 2 swing points.
• Use type "line" with x1,y1 (older point) → x2,y2 (recent point)
• Bullish trendline: connects higher lows → x1 near left, y1 higher y value; x2 near right, y2 lower y value
• Bearish trendline: connects lower highs

**6. CHART PATTERNS**
Detect: Triangle (ascending/descending/symmetrical), Wedge (rising/falling), Head & Shoulders, Double Top/Bottom, Cup & Handle, Flag/Pennant, Rectangle/Channel.
• Use type "zone" or multiple "line" annotations to show pattern boundaries
• category: "pattern"
• Add "channel" type for parallel channels

**7. BREAK OF STRUCTURE (BOS) / CHANGE OF CHARACTER (ChoCH)**
BOS = structural break in trend continuation direction
ChoCH = structural break signaling trend reversal
• Use type "hline" at the broken level
• category: "bos" or "choch"
• color: "#e879f9" (pink)

**8. LIQUIDITY LEVELS**
Equal highs (buy-side liquidity) or equal lows (sell-side liquidity).
• Use type "hline", category "liquidity"
• color: "#fb923c" (orange), dashed: true

**9. FIBONACCI LEVELS** (if clear swing visible)
Use type "fib" — draw as horizontal lines at key fib levels (0.382, 0.5, 0.618, 0.786)
Use the swing high and low visible on chart.

**10. ENTRY / SL / TP PLAN**
Always provide a trade plan using entryPlan with y coordinates:
• entry_y: where price should enter
• sl_y: stop loss (below entry for long, above for short)  
• tp1_y: first target, tp2_y: second target (optional)
• rrr: risk-reward ratio as string (e.g., "1:2.5")

━━━ COLOR LEGEND ━━━
"#34d399" = bullish/support/green
"#f87171" = bearish/resistance/red  
"#a78bfa" = FVG/purple
"#60a5fa" = entry/info/blue
"#fbbf24" = structure/yellow
"#e879f9" = BOS/ChoCH/pink
"#fb923c" = liquidity/orange
"#22d3ee" = EMA/trend/cyan

━━━ RESPONSE FORMAT ━━━

Return ONLY valid JSON (no markdown, no code blocks):

{
  "overallSignal": "BUY"|"SELL"|"HOLD",
  "confluenceScore": <0-100>,
  "summary": "<3 sentence professional summary>",
  "lesson": "<2-3 sentence EDUCATIONAL takeaway — WHY does this setup work>",
  "patterns": ["<pattern name>"],
  "tags": ["SMC", "Bullish", etc.],
  "mistakes": ["<what NOT to do in this setup>"],
  "strengths": ["<what VALIDATES this setup>"],
  "timeframes": [
    {
      "timeframe": "<e.g. 4H>",
      "signal": "BUY"|"SELL"|"HOLD",
      "bias": "<1 concise sentence>",
      "reasoning": "<3 sentences explaining all key observations>",
      "candlestickPattern": {
        "name": "<pattern name or null>",
        "location": "<e.g. 'top of rally' or 'bottom of pullback'>",
        "x": <x% of candle in chart>,
        "y": <y% of candle body center>,
        "bullish": true|false
      },
      "chartPattern": {
        "name": "<pattern name or null>",
        "description": "<1 sentence>"
      },
      "keyLevels": [
        {
          "type": "Support"|"Resistance"|"OB"|"FVG"|"BOS"|"Liquidity",
          "price": "<readable price if visible>",
          "y_pct": <y coordinate 0-100>,
          "description": "<why this level matters>"
        }
      ],
      "entryPlan": {
        "entry_y": <y%>,
        "sl_y": <y%>,
        "tp1_y": <y%>,
        "tp2_y": <y% or omit>,
        "rrr": "<e.g. 1:2.5>"
      },
      "annotations": [
        {
          "type": "hline"|"line"|"zone"|"arrow_up"|"arrow_down"|"marker"|"channel"|"label",
          "category": "<category>",
          "color": "<hex>",
          "label": "<short descriptive label>",
          "priority": "high"|"medium"|"low",
          "note": "<optional tooltip text>",
          ... (coordinates per type rules above)
        }
      ]
    }
  ]
}`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;
    const charts = Array.isArray(body.charts)
      ? (body.charts as { timeframe: string; imageDataUrl: string }[])
      : [];

    if (charts.length === 0) return NextResponse.json({ error: "No charts provided" }, { status: 400 });
    if (charts.length > 3) return NextResponse.json({ error: "Maximum 3 charts allowed" }, { status: 400 });

    const timeframeLabels = charts.map((c) => c.timeframe);

    // ── Mock (no API key) ──
    if (!apiKey) {
      const mock: ChartAcademyResponse = {
        overallSignal: "BUY", confluenceScore: 74,
        summary: "MOCK: Add OPENAI_API_KEY to .env.local for real AI analysis. Multi-timeframe structure shows bullish OB respected on the 4H with a clean FVG unfilled above. LTF confirms momentum.",
        lesson: "Order Blocks form when institutional orders drive a strong impulse move. The last opposing candle before that impulse marks the zone where institutions placed their orders — this is where price tends to return for liquidity before continuing.",
        patterns: ["Bullish Order Block", "Fair Value Gap", "BOS"],
        tags: ["SMC", "ICT", "Bullish", "OB"],
        mistakes: ["Entering before OB is retested", "Ignoring HTF bias"],
        strengths: ["4H OB intact", "FVG above acts as magnet", "BOS confirmed on LTF"],
        timeframes: timeframeLabels.map((tf, i) => ({
          timeframe: tf,
          signal: (["BUY", "BUY", "HOLD"] as const)[i] ?? "HOLD",
          bias: `${tf}: Bullish structure intact, price pulling back to OB demand zone.`,
          reasoning: `Price has broken above the previous swing high (BOS) and is now retracing into the ${tf} Order Block at the 61.8% fib level. A bullish engulfing on this zone would confirm continuation.`,
          candlestickPattern: i === 2 ? { name: "Bullish Engulfing", location: "At OB support", x: 88, y: 62, bullish: true } : null,
          chartPattern: i === 0 ? { name: "Bull Flag", description: "Tight consolidation after impulse, expecting breakout continuation." } : null,
          keyLevels: [
            { type: "Support", price: "~OB low", y_pct: 68, description: "Bullish OB base — institutional demand" },
            { type: "Resistance", price: "~swing high", y_pct: 22, description: "Previous swing high / liquidity pool" },
            { type: "FVG", price: "~midway", y_pct: 40, description: "Unfilled Fair Value Gap — price magnet" },
          ],
          entryPlan: { entry_y: 62, sl_y: 75, tp1_y: 40, tp2_y: 22, rrr: "1:2.8" },
          annotations: [
            { type: "zone", category: "ob_bull", color: "#34d399", label: "Bullish OB 🟢", priority: "high", zx: 5, zy: 62, zw: 90, zh: 9, fillOpacity: 0.2, dashed: false, note: "Last bearish candle before strong impulse — institutional demand zone" },
            { type: "zone", category: "fvg_bull", color: "#a78bfa", label: "FVG ↑", priority: "medium", zx: 5, zy: 37, zw: 90, zh: 5, fillOpacity: 0.15, note: "Unfilled bullish imbalance — price likely to fill before continuing" },
            { type: "hline", category: "resistance", color: "#f87171", label: "Resistance / Liquidity", priority: "high", y: 20, dashed: false, thickness: 1.5, note: "Equal highs — BSL target" },
            { type: "hline", category: "support", color: "#34d399", label: "Support (OB Base)", priority: "high", y: 71, dashed: false, thickness: 2 },
            { type: "hline", category: "bos", color: "#e879f9", label: "BOS →", priority: "high", y: 45, dashed: true, thickness: 1.5, note: "Break of Structure — confirms bullish continuation" },
            { type: "hline", category: "liquidity", color: "#fb923c", label: "Equal Highs (BSL)", priority: "medium", y: 22, dashed: true, thickness: 1 },
            { type: "hline", category: "entry", color: "#60a5fa", label: "Entry", priority: "high", y: 62, dashed: false, thickness: 2 },
            { type: "hline", category: "sl", color: "#f87171", label: "SL", priority: "high", y: 75, dashed: true, thickness: 1 },
            { type: "hline", category: "tp", color: "#34d399", label: "TP1", priority: "high", y: 40, dashed: true, thickness: 1 },
            { type: "hline", category: "tp", color: "#34d399", label: "TP2", priority: "medium", y: 22, dashed: true, thickness: 1 },
            ...(i === 2 ? [{ type: "arrow_up" as const, category: "candlestick" as const, color: "#34d399", label: "Bullish Engulfing", priority: "high" as const, mx: 88, my: 55 }] : []),
          ],
        })),
      };
      return NextResponse.json(mock);
    }

    // ── Real GPT-4o Vision ──
    const prompt = buildPrompt(timeframeLabels);

    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" } };

    const contentParts: ContentPart[] = [{ type: "text", text: prompt }];
    for (const chart of charts) {
      contentParts.push({ type: "text", text: `\n\n=== CHART IMAGE: ${chart.timeframe} TIMEFRAME ===\nAnalyze this chart carefully. Remember: y=0 is top of image (highest price), y=100 is bottom (lowest price). Current price is approximately where the rightmost candle body is.` });
      contentParts.push({ type: "image_url", image_url: { url: chart.imageDataUrl, detail: "high" } });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: contentParts }],
        response_format: { type: "json_object" },
        max_tokens: 6000,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const e = await response.text();
      throw new Error(`OpenAI: ${response.statusText} — ${e}`);
    }

    const data = await response.json();
    const result: ChartAcademyResponse = JSON.parse(data.choices[0].message.content);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Chart Academy Error:", error);
    return NextResponse.json({ error: "Failed to analyze charts" }, { status: 500 });
  }
}
