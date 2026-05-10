import { NextResponse } from "next/server";

interface PostMortemPayload {
  symbol?: string;
  position?: "LONG" | "SHORT" | "SPOT";
  entryPrice?: number;
  exitPrice?: number;
  pnlPercent?: number;
  emotion?: string;
  leverage?: number;
  margin?: number;
  marginMode?: string;
  notes?: string;
  context?: string;
  status?: "OPEN" | "CLOSED";
  image?: string; // base64 data URL
}

interface PostMortemResult {
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
  rootCause: string;
  mistakes: string[];
  strengths: string[];
  lesson: string;
  tags: string[];
}

function deriveOutcome(body: PostMortemPayload): PostMortemResult["outcome"] {
  if (body.status === "OPEN") return "OPEN";
  const pnl = body.pnlPercent;
  if (typeof pnl !== "number") return "OPEN";
  if (pnl > 0.2) return "WIN";
  if (pnl < -0.2) return "LOSS";
  return "BREAKEVEN";
}

function fallbackResult(body: PostMortemPayload): PostMortemResult {
  const outcome = deriveOutcome(body);
  const isWin = outcome === "WIN";
  const isLoss = outcome === "LOSS";
  return {
    outcome,
    rootCause: isWin
      ? "Trade aligned with the dominant trend and was respected by structure."
      : isLoss
        ? "Entry was likely chased without confirmation or invalidation was too tight."
        : "Outcome was inconclusive; structure did not give a decisive move.",
    mistakes: isLoss
      ? ["Possible FOMO or counter-trend bias", "Stop placement may have been too tight relative to volatility"]
      : isWin
        ? []
        : ["Plan lacked a clear catalyst"],
    strengths: isWin
      ? ["Trend alignment", "Disciplined execution"]
      : isLoss
        ? ["Took the trade with a defined plan"]
        : ["Protected capital"],
    lesson: isWin
      ? "Repeat: enter only when multi-timeframe consensus and pattern bias agree."
      : isLoss
        ? "Avoid entries against higher-timeframe trend; widen stops to ATR-based levels."
        : "Wait for a cleaner setup; do not force trades on low-conviction signals.",
    tags: [
      body.symbol ? `symbol:${body.symbol}` : "",
      body.position ? `pos:${body.position}` : "",
      outcome.toLowerCase(),
      body.emotion ? `emotion:${body.emotion}` : "",
    ].filter(Boolean),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostMortemPayload;
    const apiKey = process.env.OPENAI_API_KEY;
    const outcome = deriveOutcome(body);

    if (!apiKey) {
      return NextResponse.json(fallbackResult(body));
    }

    const tradeBlock = [
      `Symbol: ${body.symbol || "N/A"}`,
      `Position: ${body.position || "N/A"}`,
      `Status: ${body.status || "N/A"}`,
      `Entry Price: ${body.entryPrice ?? "N/A"}`,
      `Exit Price: ${body.exitPrice ?? "N/A"}`,
      `PnL %: ${body.pnlPercent ?? "N/A"}`,
      `Leverage: ${body.leverage ?? "N/A"}`,
      `Margin: ${body.margin ?? "N/A"}`,
      `Margin Mode: ${body.marginMode || "N/A"}`,
      `Trader Emotion: ${body.emotion || "N/A"}`,
      `Trader Notes: ${body.notes || "(none)"}`,
      `Additional Context: ${body.context || "(none)"}`,
      `Derived Outcome: ${outcome}`,
    ].join("\n");

    const instruction = `You are an elite, institutional-level trading coach and behavioral finance expert performing a post-mortem on a trade.
Analyze the trade data${body.image ? " and the attached chart/PnL screenshot" : ""}, then return ONLY valid JSON with these EXACT keys:
- "outcome": one of "WIN" | "LOSS" | "BREAKEVEN" | "OPEN"
- "rootCause": A deep, blunt technical and psychological breakdown of the core driver behind this outcome (2-3 sentences). Avoid generic reasons; analyze advanced concepts like market structure shifts, liquidity sweeps, poor risk-adjusted sizing, or behavioral biases.
- "mistakes": array of 0-4 highly specific, advanced critical errors (e.g., "Entered prematurely at local premium instead of waiting for discount sweep", "Chased momentum into a higher-timeframe supply zone"). Maximum 20 words each.
- "strengths": array of 0-4 highly specific strategic strengths. Maximum 20 words each.
- "lesson": A profound, deeply actionable takeaway focusing on advanced risk/reward theory, order flow, or trader psychology (2-3 sentences). STRICT RULE: Do NOT give basic, beginner advice like "use lower leverage", "don't fomo", or "always use a stop loss". Provide insights an elite trader would value.
- "tags": array of 3-6 lowercase short tags (e.g. "liquidity-grab", "fvg-rejection", "tilt", "sizing-error"). Use snake or kebab case, no spaces.

Be harsh, profound, and analytical. Do not hedge.
IMPORTANT: If the text data explicitly states the Status is "CLOSED" and provides an Exit Price and PnL, you MUST treat the trade as CLOSED, even if the attached screenshot shows an "OPEN" trade (it is likely an older screenshot uploaded before the trade was closed).

Trade Data:
${tradeBlock}`;

    type OpenAIContent = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
    const userContent: OpenAIContent[] = [{ type: "text", text: instruction }];
    if (body.image) {
      userContent.push({ type: "image_url", image_url: { url: body.image } });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.image ? "gpt-4o" : "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an elite trading coach. Return ONLY valid JSON, no markdown." },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      console.error("Post-mortem OpenAI error:", response.status, response.statusText);
      return NextResponse.json(fallbackResult(body));
    }

    const data = await response.json();
    const raw: string = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: PostMortemResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(fallbackResult(body));
    }

    // Validate / coerce
    const result: PostMortemResult = {
      outcome: (parsed.outcome as PostMortemResult["outcome"]) || outcome,
      rootCause: typeof parsed.rootCause === "string" ? parsed.rootCause : "",
      mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.slice(0, 6).map(String) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6).map(String) : [],
      lesson: typeof parsed.lesson === "string" ? parsed.lesson : "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8).map((tag) => String(tag).toLowerCase()) : [],
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Post-mortem error:", error);
    return NextResponse.json({ error: "Failed to generate post-mortem" }, { status: 500 });
  }
}
