import { expect, it } from "vitest";
import { objectUrl, presign, r2Config } from "./r2";

// Amazon's own worked example ("Authenticating Requests: Using Query Parameters"). If our signing
// differs by one character, this signature will not match.
it("signs exactly like Amazon's documented presigned GET example", () => {
  const url = presign({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expires: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
  });
  expect(url).toBe(
    "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
  );
});

const cfg = {
  accountId: "acc123",
  accessKeyId: "AK",
  secretAccessKey: "SECRET",
  bucket: "skola-media",
};
const at = new Date("2026-11-01T10:00:00Z");

it("builds path-style R2 links whose signature depends on the method, key and headers", () => {
  const get = objectUrl(cfg, "GET", "u/x/abc", 600, undefined, at);
  expect(
    get.startsWith(
      "https://acc123.r2.cloudflarestorage.com/skola-media/u/x/abc?"
    )
  ).toBe(true);
  expect(get).toContain("X-Amz-Expires=600");
  expect(get).toContain(
    "X-Amz-Credential=AK%2F20261101%2Fauto%2Fs3%2Faws4_request"
  );
  const sig = (u: string) => /X-Amz-Signature=([0-9a-f]{64})/.exec(u)?.[1];
  expect(sig(get)).toBeTruthy();

  const put = objectUrl(
    cfg,
    "PUT",
    "u/x/abc",
    600,
    { "Content-Type": "image/webp" },
    at
  );
  expect(put).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
  expect(sig(put)).not.toBe(sig(get));
  expect(sig(objectUrl(cfg, "GET", "u/x/other", 600, undefined, at))).not.toBe(
    sig(get)
  );
  // deterministic for the same inputs
  expect(objectUrl(cfg, "GET", "u/x/abc", 600, undefined, at)).toBe(get);
});

it("uses a custom endpoint when one is set", () => {
  const url = objectUrl(
    { ...cfg, endpoint: "http://localhost:9000" },
    "GET",
    "k",
    60,
    undefined,
    at
  );
  expect(url.startsWith("http://localhost:9000/skola-media/k?")).toBe(true);
});

it("is off until all four settings exist", () => {
  expect(r2Config({})).toBeNull();
  expect(
    r2Config({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
    } as never)
  ).toBeNull();
  expect(
    r2Config({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
    } as never)
  ).toMatchObject({ bucket: "d" });
});
