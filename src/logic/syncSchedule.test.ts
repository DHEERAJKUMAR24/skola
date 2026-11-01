import "fake-indexeddb/auto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "./db";
import { startSync } from "./sync";

const calls: string[] = [];

// fake-indexeddb finishes on real macrotasks, which the fake clock does not drive.
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

beforeAll(() => {
  localStorage.setItem(
    "auth.tokens",
    JSON.stringify({ access: "a", refresh: "r", expiresAt: Date.now() + 3_600_000 })
  );
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return Response.json(url.includes("/push") ? { seq: 1 } : { rows: [], seq: 0, more: false });
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("makes one pull on start, stays quiet while idle, and pushes once after an edit", async () => {
  startSync("/api");
  await advance(100);
  expect(calls).toEqual(["/api/sync/pull?since=0"]);

  // 9 idle minutes: no calls at all (the old 30 s timer would have made 18).
  await advance(9 * 60_000);
  expect(calls).toHaveLength(1);

  // Edits made in quick succession become a single push-only request.
  await db.cards.add({ id: "c1", deck: "d" } as never);
  await db.cards.add({ id: "c2", deck: "d" } as never);
  await advance(6_000);
  expect(calls.slice(1)).toEqual(["/api/sync/push"]);

  // The 10-minute poll pulls once.
  await advance(10 * 60_000);
  expect(calls.filter((c) => c.includes("/pull"))).toHaveLength(2);
});
