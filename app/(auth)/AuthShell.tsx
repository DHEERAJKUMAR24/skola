"use client";

import { type ReactNode, useEffect } from "react";

/** Centers the card and applies the same light/dark theme the app uses. */
export default function AuthShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    let pref = "auto";
    try {
      pref = JSON.parse(localStorage.getItem("mantine-color-scheme-value") ?? '"auto"');
    } catch {}
    const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, []);

  return (
    <main style={{ maxWidth: 380, margin: "10vh auto", padding: "0 16px", height: "auto" }}>
      <h1 style={{ marginBottom: 24 }}>Skola</h1>
      {children}
    </main>
  );
}
