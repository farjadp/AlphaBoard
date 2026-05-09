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
          content: "You are an expert crypto trading assistant. Extract trade details from the provided exchange screenshot. Return ONLY valid JSON."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract the following details from this crypto exchange screenshot.
              Return ONLY a JSON object with these exact keys:
              - "symbol": (string, e.g. "BTC/USDT" or "BTCUSDT")
              - "position": (string, either "LONG" or "SHORT")
              - "entryPrice": (number)
              - "margin": (number, the margin/size in USD, do not include symbols)
              - "leverage": (number, just the multiplier, e.g. 50)
              - "marginMode": (string, either "Cross" or "Isolated")
              
              If any field cannot be found, return null for that field. Do not include markdown formatting or backticks.`
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
      max_tokens: 300,
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
