import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import { syncOnce } from "./sync";

beforeEach(() => localStorage.setItem("auth.token", "t"));
afterEach(() => vi.unstubAllGlobals());

it("pushes local rows with Dates tagged, and applies pulled rows with Dates restored", async () => {
  const due = new Date("2026-02-03T00:00:00Z");
  await db.cards.add({ id: "c1", deck: "d", model: { due } } as never);

  const calls: { url: string; body?: string }[] = [];
  const pulled = {
    rows: [
      { tbl: "cards", id: "c2", updatedAt: 500, seq: 1, deleted: false,
        data: { id: "c2", updatedAt: 500, model: { due: { $d: due.getTime() } } } },
    ],
    seq: 1,
    more: false,
  };
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body });
    return Response.json(url.includes("/push") ? { seq: 1 } : pulled);
  });

  await syncOnce("http://x");

  const pushed = JSON.parse(calls[0].body as string).rows.find((r: { id: string }) => r.id === "c1");
  expect(pushed.data.model.due).toEqual({ $d: due.getTime() });

  const c2 = (await db.cards.get("c2")) as unknown as { model: { due: Date }; updatedAt: number };
  expect(c2.model.due).toBeInstanceOf(Date);
  expect(c2.updatedAt).toBe(500);
});

it("does not overwrite a newer local row with an older pulled one", async () => {
  await db.cards.add({ id: "c3", deck: "d" } as never); // updatedAt = now
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.includes("/push")
        ? { seq: 1 }
        : { rows: [{ tbl: "cards", id: "c3", updatedAt: 1, seq: 2, data: { id: "c3", deck: "OLD", updatedAt: 1 } }], seq: 2, more: false }
    )
  );
  await syncOnce("http://x");
  expect(((await db.cards.get("c3")) as unknown as { deck: string }).deck).toBe("d");
});

it("does nothing without a token, and signs out on 401", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);

  localStorage.removeItem("auth.token");
  await syncOnce("http://x");
  expect(fetchMock).not.toHaveBeenCalled();

  localStorage.setItem("auth.token", "stale");
  await db.cards.add({ id: "c9", deck: "d" } as never);
  await expect(syncOnce("http://x")).rejects.toThrow("Signed out");
  expect(localStorage.getItem("auth.token")).toBeNull();
});

it("skips a malformed pulled row instead of failing the whole pull", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.includes("/push")
        ? { seq: 1 }
        : {
            rows: [
              { tbl: "cards", id: "bad", updatedAt: 5, seq: 1, data: null },
              { tbl: "cards", id: "good", updatedAt: 5, seq: 2, data: { deck: "d" } },
            ],
            seq: 2,
            more: false,
          }
    )
  );
  await syncOnce("http://x");
  expect(await db.cards.get("good")).toMatchObject({ id: "good", deck: "d" });
  expect(localStorage.getItem("sync.lastSeq")).toBe("2");
});
