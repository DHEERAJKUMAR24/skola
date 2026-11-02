import type { Metadata } from "next";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Offline | Skola++" };

// Plain markup and inline styles on purpose: this page is precached and must render with nothing else.
export default function OfflinePage() {
  return (
    <main
      style={{
        maxWidth: 420,
        margin: "18vh auto",
        padding: "0 16px",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.5,
      }}
    >
      <h1>You are offline</h1>
      <p>
        This page needs a connection. Your decks and studying still work
        offline, and changes sync when you are back online.
      </p>
      <p>
        <a href="/">Open Skola++</a>
      </p>
    </main>
  );
}
