import "fake-indexeddb/auto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "./db";
import { startSync } from "./syncScheduler";
import { DEFAULT_PUSH_DELAY_MS, setPushDelayMs } from "./syncSettings";
import { getSyncStatus } from "./syncStatus";

const calls: string[] = [];
const pushes = () => calls.filter((c) => c.includes("/push")).length;
const pulls = () => calls.filter((c) => c.includes("/pull")).length;

// fake-indexeddb finishes on real macrotasks, which the fake clock does not drive.
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

beforeAll(() => {
  localStorage.setItem(
    "auth.tokens",
    JSON.stringify({
      access: "a",
      refresh: "r",
      expiresAt: Date.now() + 3_600_000,
    })
  );
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return Response.json(
      url.includes("/push")
        ? { seq: 1, applied: 1 }
        : { rows: [], seq: 0, more: false }
    );
  });
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("pulls once on start and makes no requests while idle", async () => {
  startSync();
  startSync(); // a second start must not double the listeners
  await advance(100);
  expect(calls).toEqual(["/api/sync/pull?since=0"]);

  await advance(14 * 60_000);
  expect(calls).toHaveLength(1);
  expect(getSyncStatus().phase).toBe("idle");
});

it("restarts the countdown on every edit and sends one push-only request", async () => {
  await db.cards.add({ id: "c1", deck: "d" } as never);
  expect(getSyncStatus().phase).toBe("pending");
  const first = getSyncStatus().deadline as number;
  expect(first - Date.now()).toBe(DEFAULT_PUSH_DELAY_MS);

  await advance(6_000);
  await db.cards.add({ id: "c2", deck: "d" } as never);
  expect(getSyncStatus().deadline as number).toBeGreaterThan(first);

  await advance(DEFAULT_PUSH_DELAY_MS - 1_000); // 9 s after the last edit: still waiting
  expect(pushes()).toBe(0);

  await advance(2_000);
  expect(pushes()).toBe(1);
  expect(pulls()).toBe(1); // push-only: no extra pull
  expect(getSyncStatus().phase).toBe("idle");
  expect(getSyncStatus().lastSyncedAt).not.toBeNull();
});

it("pulls on the 15 minute poll", async () => {
  await advance(15 * 60_000);
  expect(pulls()).toBe(2);
});

it("still pushes within a minute when edits never stop", async () => {
  const before = pushes();
  for (let i = 0; i < 9; i++) {
    await db.cards.add({ id: `busy-${i}`, deck: "d" } as never);
    await advance(8_000); // each edit lands before the 10 s debounce fires
  }
  expect(pushes()).toBeGreaterThan(before);
});

it("uses the push delay from settings, clamped to 5 s to 15 min", async () => {
  setPushDelayMs(5 * 60_000);
  await db.cards.add({ id: "slow1", deck: "d" } as never);
  expect((getSyncStatus().deadline as number) - Date.now()).toBe(5 * 60_000);

  const before = pushes();
  await advance(4 * 60_000);
  expect(pushes()).toBe(before); // still inside the 5 minute wait
  await advance(61_000);
  expect(pushes()).toBe(before + 1);

  setPushDelayMs(1_000); // below the minimum
  await db.cards.add({ id: "fast1", deck: "d" } as never);
  expect((getSyncStatus().deadline as number) - Date.now()).toBe(5_000);

  setPushDelayMs(99 * 60_000); // above the maximum
  await db.cards.add({ id: "fast2", deck: "d" } as never);
  expect((getSyncStatus().deadline as number) - Date.now()).toBe(15 * 60_000);
});
