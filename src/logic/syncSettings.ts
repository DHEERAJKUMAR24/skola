import { useSyncExternalStore } from "react";

export const MIN_PUSH_DELAY_MS = 5_000;
export const MAX_PUSH_DELAY_MS = 15 * 60_000;
export const DEFAULT_PUSH_DELAY_MS = 10_000;

const KEY = "sync.pushDelayMs";
const EVENT = "sync-settings-changed";

export const clampPushDelay = (ms: number) =>
  Math.min(MAX_PUSH_DELAY_MS, Math.max(MIN_PUSH_DELAY_MS, Math.round(ms)));

/** Quiet time after the last edit before pushing. A per-device preference, so it stays in localStorage. */
export function getPushDelayMs() {
  const v = Number(localStorage.getItem(KEY));
  return Number.isFinite(v) && v > 0
    ? clampPushDelay(v)
    : DEFAULT_PUSH_DELAY_MS;
}

export function setPushDelayMs(ms: number) {
  localStorage.setItem(KEY, String(clampPushDelay(ms)));
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (l: () => void) => {
  window.addEventListener(EVENT, l);
  window.addEventListener("storage", l);
  return () => {
    window.removeEventListener(EVENT, l);
    window.removeEventListener("storage", l);
  };
};

export const usePushDelayMs = () =>
  useSyncExternalStore(subscribe, getPushDelayMs, () => DEFAULT_PUSH_DELAY_MS);
