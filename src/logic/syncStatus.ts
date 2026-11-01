import { useSyncExternalStore } from "react";

export type SyncPhase = "idle" | "pending" | "syncing" | "error" | "offline";

export interface SyncStatus {
  phase: SyncPhase;
  /** When the debounced push will fire (ms epoch); drives the countdown ring. */
  deadline: number | null;
  /** Length of the current countdown in ms. */
  duration: number;
  lastSyncedAt: number | null;
  error: string | null;
}

const initial: SyncStatus = {
  phase: "idle",
  deadline: null,
  duration: 0,
  lastSyncedAt: null,
  error: null,
};

let status = initial;
const listeners = new Set<() => void>();

export const getSyncStatus = () => status;

export function setSyncStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useSyncStatus = () =>
  useSyncExternalStore(subscribe, getSyncStatus, () => initial);
