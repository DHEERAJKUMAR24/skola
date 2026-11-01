import App from "@/App";
import DeckView from "@/app/deck/DeckView";
import NewNotesView from "@/app/editor/NewNotesView";
import NoteExplorerView from "@/app/explorer/NoteExplorerView";
import HomeView from "@/app/home/HomeView";
import LearnView from "@/app/learn/LearnView/LearnView";
import SettingsView from "@/app/settings/SettingsView";
import StatsView from "@/app/statistics/StatsView";
import { ensureDefaultPreset } from "@/logic/deck/presets";
import { useEffect } from "react";
import { Navigate, RouterProvider, createHashRouter } from "react-router-dom";
import { syncUrl } from "./logic/auth";
import { startSync } from "./logic/syncScheduler";

const router = createHashRouter(
  [
    {
      element: <App />,
      children: [
        {
          index: true,
          element: <Navigate to="/home" replace={true} />,
        },
        {
          path: "/home",
          element: <HomeView />,
        },
        {
          path: "/settings/:section?",
          element: <SettingsView />,
        },
        {
          path: "/deck/:deckId",
          element: <DeckView />,
        },
        {
          path: "/deck/:deckId/:params",
          element: <DeckView />,
        },
        {
          path: "/new/:deckId?",
          element: <NewNotesView />,
        },
        {
          path: "/learn/:deckId/:params?",
          element: <LearnView />,
        },
        {
          path: "/notes",
          element: <NoteExplorerView />,
        },
        {
          path: "/stats/:deckId?",
          element: <StatsView />,
        },
      ],
    },
  ],
  { basename: "/" }
);

export default function ClientRoot() {
  useEffect(() => {
    if (syncUrl) startSync();
    ensurePersistentStorage();
    void ensureDefaultPreset();
  }, []);

  return <RouterProvider router={router} />;
}

async function ensurePersistentStorage() {
  if (!navigator.storage?.persisted || (await navigator.storage.persisted()))
    return;
  console.warn("Storage is not persistant. Trying to make it persistant...");
  if (await navigator.storage.persist?.()) {
    console.log("Successfully made storage persisted");
  } else {
    console.warn("Failed to make storage persisted");
    navigator.userAgent.includes("Safari") &&
      console.info(
        "You are using Safari, storage may be cleared after 7 days of inactivity: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/"
      );
  }
}
