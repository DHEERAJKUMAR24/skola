import { useEffect } from "react";
import { useSetting } from "../logic/settings/hooks/useSetting";

function applyThemeFromPreference(preference: "light" | "dark" | "auto") {
  const root = document.documentElement;

  if (preference === "auto") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    root.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

export function useTheme() {
  const [colorSchemePreference] = useSetting("#colorSchemePreference");

  useEffect(() => {
    applyThemeFromPreference(colorSchemePreference);

    try {
      localStorage.setItem("skola-color-scheme", colorSchemePreference);
    } catch {}

    if (colorSchemePreference === "auto") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () =>
        applyThemeFromPreference(colorSchemePreference);

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [colorSchemePreference]);

  return { colorSchemePreference };
}
