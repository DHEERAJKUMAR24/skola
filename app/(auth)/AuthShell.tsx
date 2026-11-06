"use client";

import { type ReactNode, useEffect } from "react";
import "./auth.css";

/** Centred card with logo + app name. Applies the same light/dark theme as the app. */
export default function AuthShell({ children }: { children: ReactNode }) {
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
    <main className="auth-shell">
      <div className="auth-shell__card">
        <div className="auth-shell__brand">
          <img src="/logo.svg" alt="" className="auth-shell__logo" />
          <span className="auth-shell__app-name">Skola++</span>
        </div>
        <div className="auth-shell__body">{children}</div>
      </div>
    </main>
  );
}
