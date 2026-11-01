"use client";

import { type ReactNode, useEffect } from "react";

/** A readable column that follows the same light/dark choice as the app. */
export default function SiteShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    let pref = "auto";
    try {
      pref = JSON.parse(
        localStorage.getItem("mantine-color-scheme-value") ?? '"auto"'
      );
    } catch {}
    const dark =
      pref === "dark" ||
      (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute(
      "data-theme",
      dark ? "dark" : "light"
    );
  }, []);

  return (
    <main
      style={{
        maxWidth: 820,
        margin: "6vh auto",
        padding: "0 16px 64px",
        height: "auto",
        lineHeight: 1.55,
      }}
    >
      {children}
    </main>
  );
}
