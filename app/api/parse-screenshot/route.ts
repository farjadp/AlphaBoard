import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { image } = body;

    if (!image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key missing" }, { status: 500 });
    }

    const payload = {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert crypto trading assistant. Extract EXACT trade details from exchange screenshots. Return ONLY valid JSON, no markdown, no prose."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract trade details from this crypto exchange screenshot. This may be a position record, order history, open positions page, or a "Share My PnL" card.

PRIORITY RULES (most important):
1. If the screenshot is a "Share PnL" card (has big % number, entry price, avg close price), extract from THAT card, not any surrounding UI.
2. Prefer labels like "Avg Entry Price", "Avg Close Price", "Entry Price", "Exit Price", "Close Price" — these are the source of truth.
3. Leverage is often shown as "10x", "6X", "50X", or in a tag like "Perp | Long | 6X". Extract the pure number (e.g. 6, not "6x").
4. For position side, look for "Long" / "Short" labels. Green number usually = profit. Red = loss. Do NOT infer side from color alone; use the explicit label.
5. Margin/Size: "Margin" is the collateral used (small number). "Size" or "Position Size" is margin × leverage (bigger). Prefer "Margin" for the margin field.
6. If a field is missing or ambiguous, return null — do NOT guess.

Return ONLY a JSON object with these EXACT keys:
- "symbol": string like "BTC/USDT" or "SOL/USDT" (keep the slash if present, otherwise add it: "BTCUSDT" -> "BTC/USDT")
- "position": "LONG" | "SHORT" | null
- "entryPrice": number | null  (exact value shown next to "Entry" or "Avg Entry Price")
- "exitPrice": number | null  (exact value shown next to "Exit", "Close Price", or "Avg Close Price"; null if position is still open)
- "leverage": number | null  (just the integer multiplier, e.g. 6 for "6X")
- "margin": number | null  (collateral in USD)
- "marginMode": "Cross" | "Isolated" | null
- "pnlPercent": number | null  (signed, e.g. 4.14 for "+4.14%", -2.24 for "-2.24%")
- "pnlUsd": number | null  (signed, e.g. 0.07 for "+0.07 USDT")

Do not include markdown, code fences, or explanations.`
            },
            {
              type: "image_url",
              image_url: {
                url: image
              }
            }
          ]
        }
      ],
      max_tokens: 400,
      response_format: { type: "json_object" },
      temperature: 0,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    let messageContent = data.choices[0].message.content.trim();
    
    // Clean up potential markdown formatting
    if (messageContent.startsWith("```json")) {
      messageContent = messageContent.replace(/```json/g, "").replace(/```/g, "").trim();
    } else if (messageContent.startsWith("```")) {
      messageContent = messageContent.replace(/```/g, "").trim();
    }

    const parsedData = JSON.parse(messageContent);
    return NextResponse.json(parsedData);

  } catch (error) {
    console.error("Screenshot parsing error:", error);
    return NextResponse.json({ error: "Failed to parse screenshot" }, { status: 500 });
  }
}
