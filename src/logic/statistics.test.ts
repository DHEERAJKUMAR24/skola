import "fake-indexeddb/auto";
import { State } from "ts-fsrs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import {
  type DeckStatistics,
  getStatistics,
  newStatistics,
  totalsByDay,
  writeStatistics,
} from "./statistics";
import { syncOnce } from "./sync";

const session = (
  deck: string,
  day: string,
  reps: number,
  seconds: number
): DeckStatistics => ({
  ...newStatistics(),
  deck,
  day,
  time: { total: seconds, forNew: 0, forReview: seconds, forLearning: 0 },
  cards: {
    [State.New]: 0,
    [State.Review]: reps,
    [State.Learning]: 0,
    [State.Relearning]: 0,
  },
  ratingsList: Array(reps).fill(3),
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.setItem(
    "auth.tokens",
    JSON.stringify({ access: "a", refresh: "r", expiresAt: Date.now() + 3.6e6 })
  );
});
afterEach(() => vi.unstubAllGlobals());

it("adds sessions of the same deck and day into one total, and keeps days apart", async () => {
  await writeStatistics(session("d1", "2026-11-01", 3, 60));
  await writeStatistics(session("d1", "2026-11-01", 2, 30));
  await writeStatistics(session("d1", "2026-11-02", 5, 10));

  expect(await getStatistics("d1", "2026-11-01")).toMatchObject({
    time: { total: 90 },
    cards: { [State.Review]: 5 },
  });
  expect((await getStatistics("d1")) as DeckStatistics[]).toHaveLength(2);
  expect(((await getStatistics()) as DeckStatistics[]).length).toBe(2);
  expect(await getStatistics("d1", "1999-01-01")).toBeUndefined();
});

it("ignores a session with no answers", async () => {
  await writeStatistics(newStatistics());
  expect(await db.studySessions.count()).toBe(0);
});

it("totalsByDay does not change its input", () => {
  const a = session("d", "2026-11-01", 1, 5);
  totalsByDay([a, session("d", "2026-11-01", 1, 5)]);
  expect(a.time.total).toBe(5);
  expect(a.ratingsList).toHaveLength(1);
});

it("syncs sessions as separate rows, so two devices on the same day add up", async () => {
  await writeStatistics(session("d1", "2026-11-01", 3, 60));

  const sent: { tbl: string; id: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    if (url.includes("/push")) {
      sent.push(...JSON.parse(init?.body as string).rows);
      return Response.json({ seq: 1 });
    }
    // The other device studied the same deck the same day.
    return Response.json({
      rows: [
        {
          tbl: "studySessions",
          id: "other-device-session",
          updatedAt: Date.now(),
          seq: 7,
          data: {
            ...session("d1", "2026-11-01", 4, 100),
            id: "other-device-session",
          },
        },
      ],
      seq: 7,
      more: false,
    });
  });
  await syncOnce("http://x");

  expect(sent.filter((r) => r.tbl === "studySessions")).toHaveLength(1);
  expect(await db.studySessions.count()).toBe(2);
  expect(await getStatistics("d1", "2026-11-01")).toMatchObject({
    time: { total: 160 },
    cards: { [State.Review]: 7 },
  });
});
