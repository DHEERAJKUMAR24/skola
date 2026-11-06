import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotSignedIn } from "./auth";
import { ServerApiError, serverCall } from "./serverApi";

const auth = vi.hoisted(() => ({
  isSignedIn: vi.fn(),
  authFetch: vi.fn(),
}));
vi.mock("./auth", async (orig) => ({
  ...(await orig<typeof import("./auth")>()),
  ...auth,
}));

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("serverCall", () => {
  beforeEach(() => {
    auth.isSignedIn.mockReturnValue(true);
  });

  it("says history needs sign-in when signed out, without a request", async () => {
    auth.isSignedIn.mockReturnValue(false);
    await expect(serverCall("/api/history", {}, "History")).rejects.toThrow(
      "History needs sign-in and a connection."
    );
    expect(auth.authFetch).not.toHaveBeenCalled();
  });

  it("gives the same message offline and when the session cannot be refreshed", async () => {
    auth.authFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(serverCall("/api/history", {}, "History")).rejects.toThrow(
      "History needs sign-in and a connection."
    );
    auth.authFetch.mockRejectedValueOnce(new NotSignedIn());
    await expect(
      serverCall("/api/objectives", {}, "Objectives")
    ).rejects.toThrow("Objectives needs sign-in and a connection.");
  });

  it("returns the body, and turns an error body into a ServerApiError with its code", async () => {
    auth.authFetch.mockResolvedValueOnce(json({ ok: true }));
    expect(await serverCall("/api/x", { a: 1 }, "X")).toEqual({ ok: true });
    auth.authFetch.mockResolvedValueOnce(
      json({ error: "nothing to change", code: "nothing_to_change" }, 400)
    );
    const err = await serverCall("/api/x", {}, "X").catch((e) => e);
    expect(err).toBeInstanceOf(ServerApiError);
    expect(err).toMatchObject({
      message: "nothing to change",
      code: "nothing_to_change",
      status: 400,
    });
  });
});
