"use client"

// Replaces the root layout when the error happens above it, so it must render
// its own <html>/<body> and can't rely on globals.css, inline styles only.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "Georgia, 'Times New Roman', serif",
          background: "#f4f0e6",
          color: "#2b2622",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#8a6a2f" }}>
            Error
          </p>
          <h1 style={{ fontSize: 32, margin: "0.5rem 0 0.75rem" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#57534e" }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#8a8580", fontFamily: "monospace" }}>ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "0.5rem 1.25rem",
              border: "1px solid #2b2622",
              background: "transparent",
              color: "#2b2622",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
