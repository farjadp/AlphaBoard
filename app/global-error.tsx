"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#eef1f4", color: "#15202b" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center", background: "#ffffff", border: "1px solid #e1e6ec", borderRadius: 14, padding: 32 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 0, marginBottom: 8 }}>AlphaBoard could not load</h1>
            <p style={{ color: "#7d8896", fontSize: 14, marginBottom: 24 }}>
              A fatal error occurred{error.digest ? ` (ref ${error.digest})` : ""}.
            </p>
            <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#15202b", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}>
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
