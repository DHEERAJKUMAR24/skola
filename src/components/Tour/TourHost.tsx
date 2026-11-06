import { db } from "@/logic/db";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { setSetting } from "@/logic/settings/setSetting";
import { driver } from "driver.js";
import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import "./Tour.css";
import { type TourDef, tourForRoute } from "./tours";

const START_EVENT = "skola:start-tour";

/** Replays the tour of the page that is open (used by the profile menu). */
export const startTourHere = () =>
  window.dispatchEvent(new CustomEvent(START_EVENT));

export const resetTours = () => setSetting("#toursSeen", []);

async function markSeen(id: string) {
  const current = ((await db.settings.get("#toursSeen"))?.value ??
    []) as string[];
  if (!current.includes(id)) await setSetting("#toursSeen", [...current, id]);
}

/** Shows each page's tour once, then remembers it in a synced setting. Mount once inside the router. */
export default function TourHost() {
  const { pathname } = useLocation();
  const [seen, loaded] = useSetting("#toursSeen");
  const active = useRef<ReturnType<typeof driver> | undefined>(undefined);

  const run = useCallback((tour: TourDef) => {
    import("driver.js/dist/driver.css").catch(() => {});
    active.current?.destroy();
    // Steps whose element is not on screen are dropped so a tour never points at nothing.
    const steps = tour.steps
      .filter((s) => !s.el || document.querySelector(s.el))
      .map((s) => ({
        element: s.el,
        popover: { title: s.title, description: s.text },
      }));
    if (!steps.length) return;
    const d = driver({
      animate: true,
      smoothScroll: true,
      showProgress: true,
      allowClose: true,
      popoverClass: "skola-tour",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      steps,
      onDestroyed: () => {
        void markSeen(tour.id);
      },
    });
    active.current = d;
    d.drive();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const tour = tourForRoute(pathname);
    if (!tour || seen.includes(tour.id)) return;
    // Give the page a moment to render the elements the tour points at.
    const timer = setTimeout(() => run(tour), 900);
    return () => clearTimeout(timer);
  }, [pathname, loaded, seen, run]);

  useEffect(() => {
    const onStart = () => {
      const tour = tourForRoute(window.location.hash.replace(/^#/, ""));
      if (tour) run(tour);
    };
    window.addEventListener(START_EVENT, onStart);
    return () => {
      window.removeEventListener(START_EVENT, onStart);
      active.current?.destroy();
    };
  }, [run]);

  return null;
}
