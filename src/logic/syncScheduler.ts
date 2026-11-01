import { NotSignedIn, isSignedIn, syncUrl } from "./auth";
import { migrateInlineImages, uploadPending } from "./media/media";
import { syncOnce } from "./sync";
import { getPushDelayMs } from "./syncSettings";
import { getSyncStatus, setSyncStatus } from "./syncStatus";
import { LOCAL_CHANGE_EVENT } from "./syncTracking";

// Tuned to make as few requests as possible (Vercel free tier).
/** Smallest cap on how long an unsent edit may wait, so constant editing still gets saved. */
const MIN_MAX_WAIT_MS = 60_000;
const MIN_PULL_GAP_MS = 2 * 60_000;
const POLL_MS = 15 * 60_000;

let started = false;
let inlineChecked = false;
let running = false;
let lastPull = 0;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
/** When the oldest unsent edit happened; null when nothing is waiting. */
let firstChangeAt: number | null = null;

async function run(opts: { keepalive?: boolean; pull?: boolean } = {}) {
  const { keepalive = false, pull = true } = opts;
  if (!syncUrl || !isSignedIn()) {
    setSyncStatus({ phase: "idle", deadline: null });
    return;
  }
  if (!navigator.onLine) {
    setSyncStatus({ phase: "offline" });
    return;
  }
  if (running && !keepalive) return;
  running = true;
  if (!keepalive) {
    // This run sends everything that is waiting, so the countdown is done.
    clearTimeout(pushTimer);
    firstChangeAt = null;
    setSyncStatus({ phase: "syncing", deadline: null, error: null });
  }
  try {
    await syncOnce(syncUrl, keepalive, pull);
    if (!keepalive) {
      // Pictures made on this device go to R2. Both calls do nothing, and ask the server nothing,
      // unless there is something waiting. Moving old inline pictures is tried once per session.
      void uploadPending();
      if (!inlineChecked) {
        inlineChecked = true;
        void migrateInlineImages();
      }
    }
    if (pull && !keepalive) lastPull = Date.now();
    if (!keepalive)
      setSyncStatus({
        // Edits made while this run was in flight keep their countdown.
        phase: firstChangeAt === null ? "idle" : "pending",
        lastSyncedAt: Date.now(),
      });
  } catch (e) {
    if (e instanceof NotSignedIn) setSyncStatus({ phase: "idle" });
    else {
      console.warn("sync failed", e);
      setSyncStatus({
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    running = false;
  }
}

function onLocalChange() {
  if (!isSignedIn()) return;
  const now = Date.now();
  firstChangeAt ??= now;
  // Quiet time after the last edit (a setting); every edit restarts it, but never past the cap.
  const debounce = getPushDelayMs();
  const maxWait = Math.max(MIN_MAX_WAIT_MS, debounce * 2);
  const delay = Math.min(debounce, firstChangeAt + maxWait - now);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run({ pull: false }), delay);
  setSyncStatus({ phase: "pending", deadline: now + delay, duration: delay });
}

function pullIfStale() {
  if (
    document.visibilityState === "visible" &&
    navigator.onLine &&
    Date.now() - lastPull > MIN_PULL_GAP_MS
  )
    run();
}

/** Manual sync from the UI. Throws on failure so the caller can show it. */
export async function syncNow() {
  await run();
  const s = getSyncStatus();
  if (s.phase === "error") throw new Error(s.error ?? "Sync failed");
}

/**
 * Starts the sync loop once. Requests happen only when needed:
 * - pull on start, sign-in and reconnect;
 * - push (no pull) after the configured quiet time (5 s to 15 min, default 10 s), at most
 *   twice that (min 60 s) after the first unsent edit;
 * - pull when the tab regains focus (at most every 2 min) and every 15 min while visible;
 * - one keepalive push when the page hides.
 * Idle, hidden or offline tabs make no requests.
 */
export function startSync() {
  if (started) return; // React StrictMode runs effects twice in dev
  started = true;

  window.addEventListener(LOCAL_CHANGE_EVENT, onLocalChange);
  window.addEventListener("online", () => run());
  window.addEventListener("offline", () => setSyncStatus({ phase: "offline" }));
  window.addEventListener("auth-changed", () => {
    if (!isSignedIn()) {
      clearTimeout(pushTimer);
      firstChangeAt = null;
    }
    run();
  });
  window.addEventListener("focus", pullIfStale);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") run({ keepalive: true });
    else pullIfStale();
  });
  setInterval(pullIfStale, POLL_MS);
  run();
}
