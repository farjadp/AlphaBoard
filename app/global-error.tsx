"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#030712", color: "#f3f4f6" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>AlphaBoard could not load</h1>
            <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 24 }}>
              A fatal error occurred{error.digest ? ` (ref ${error.digest})` : ""}.
            </p>
            <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#f3f4f6", color: "#111827", fontWeight: 600, cursor: "pointer" }}>
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
