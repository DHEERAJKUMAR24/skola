import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotSignedIn } from "./auth";
import { db } from "./db";
import { syncOnce } from "./sync";

const signIn = (expiresAt = Date.now() + 3600_000) =>
  localStorage.setItem(
    "auth.tokens",
    JSON.stringify({ access: "a", refresh: "r", expiresAt })
  );
beforeEach(() => signIn());
afterEach(() => vi.unstubAllGlobals());

it("pushes local rows with Dates tagged, and applies pulled rows with Dates restored", async () => {
  const due = new Date("2026-02-03T00:00:00Z");
  await db.cards.add({ id: "c1", deck: "d", model: { due } } as never);

  const calls: { url: string; body?: string }[] = [];
  const pulled = {
    rows: [
      {
        tbl: "cards",
        id: "c2",
        updatedAt: 500,
        seq: 1,
        deleted: false,
        data: {
          id: "c2",
          updatedAt: 500,
          model: { due: { $d: due.getTime() } },
        },
      },
    ],
    seq: 1,
    more: false,
  };
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body });
    return Response.json(url.includes("/push") ? { seq: 1 } : pulled);
  });

  await syncOnce("http://x");

  const pushed = JSON.parse(calls[0].body as string).rows.find(
    (r: { id: string }) => r.id === "c1"
  );
  expect(pushed.data.model.due).toEqual({ $d: due.getTime() });

  const c2 = (await db.cards.get("c2")) as unknown as {
    model: { due: Date };
    updatedAt: number;
  };
  expect(c2.model.due).toBeInstanceOf(Date);
  expect(c2.updatedAt).toBe(500);
});

it("does not overwrite a newer local row with an older pulled one", async () => {
  await db.cards.add({ id: "c3", deck: "d" } as never); // updatedAt = now
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.includes("/push")
        ? { seq: 1 }
        : {
            rows: [
              {
                tbl: "cards",
                id: "c3",
                updatedAt: 1,
                seq: 2,
                data: { id: "c3", deck: "OLD", updatedAt: 1 },
              },
            ],
            seq: 2,
            more: false,
          }
    )
  );
  await syncOnce("http://x");
  expect(((await db.cards.get("c3")) as unknown as { deck: string }).deck).toBe(
    "d"
  );
});

it("does nothing without tokens", async () => {
  const fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.removeItem("auth.tokens");
  await syncOnce("http://x");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refreshes an expired access token, then signs out if the refresh is rejected", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response("{}", {
      status: url.includes("/oauth/token") ? 400 : 401,
    });
  });
  signIn(Date.now() - 1000);
  await db.cards.add({ id: "c9", deck: "d" } as never);
  await expect(syncOnce("http://x")).rejects.toBeInstanceOf(NotSignedIn);
  expect(calls).toEqual(["/oauth/token"]);
  expect(localStorage.getItem("auth.tokens")).toBeNull();
});

it("retries once with a refreshed token after a 401", async () => {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/oauth/token"))
        return Response.json({
          access_token: "new",
          refresh_token: "r2",
          expires_in: 3600,
        });
      seen.push(init?.headers?.authorization ?? "");
      if (init?.headers?.authorization === "Bearer a")
        return new Response("{}", { status: 401 });
      return Response.json({ rows: [], seq: 0, more: false });
    }
  );
  await syncOnce("http://x");
  expect(seen[0]).toBe("Bearer a");
  expect(seen.length).toBeGreaterThan(1);
  expect(seen.slice(1).every((h) => h === "Bearer new")).toBe(true);
  expect(
    JSON.parse(localStorage.getItem("auth.tokens") as string).refresh
  ).toBe("r2");
});

it("skips a malformed pulled row instead of failing the whole pull", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.includes("/push")
        ? { seq: 1 }
        : {
            rows: [
              { tbl: "cards", id: "bad", updatedAt: 5, seq: 1, data: null },
              {
                tbl: "cards",
                id: "good",
                updatedAt: 5,
                seq: 2,
                data: { deck: "d" },
              },
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
