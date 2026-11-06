import { useSyncExternalStore } from "react";

export type SyncPhase = "idle" | "pending" | "syncing" | "error" | "offline";

export interface SyncStatus {
  phase: SyncPhase;
  /** When the debounced push will fire (ms epoch); drives the countdown ring. */
  deadline: number | null;
  /** Length of the current countdown in ms. */
  duration: number;
  /** Wall-clock ms when the last successful sync completed. Persisted across reloads. */
  lastSyncedAt: number | null;
  error: string | null;
}

const LAST_SYNCED_KEY = "sync.lastSyncedAt";

function readPersistedSyncedAt(): number | null {
  const v = localStorage.getItem(LAST_SYNCED_KEY);
  const n = v ? Number(v) : 0;
  return n > 0 ? n : null;
}

const initial: SyncStatus = {
  phase: "idle",
  deadline: null,
  duration: 0,
  lastSyncedAt: typeof window !== "undefined" ? readPersistedSyncedAt() : null,
  error: null,
};

let status = initial;
const listeners = new Set<() => void>();

export const getSyncStatus = () => status;

export function setSyncStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  if (patch.lastSyncedAt != null)
    localStorage.setItem(LAST_SYNCED_KEY, String(patch.lastSyncedAt));
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useSyncStatus = () =>
  useSyncExternalStore(subscribe, getSyncStatus, () => initial);
