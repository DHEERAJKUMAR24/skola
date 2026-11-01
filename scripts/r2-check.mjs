// Checks a real R2 setup end to end with your own settings: pnpm r2:check
// Reads R2_* and APP_URL from .env.local, uses one tiny test object, and deletes it again.
// Nothing is printed except what passed or failed; secrets are never shown.
import { objectUrl, r2Config } from "../src/server/r2.ts";

const cfg = r2Config();
const missing = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
].filter((k) => !process.env[k]);
if (!cfg) {
  console.log(`FAIL settings: missing ${missing.join(", ")} in .env.local`);
  process.exit(1);
}

const origin = (process.env.APP_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);
const key = `check/${Date.now()}`;
const bytes = new TextEncoder().encode("skola r2 check");
let failed = false;
const step = async (name, fn) => {
  try {
    const note = await fn();
    console.log(`PASS ${name}${note ? ` (${note})` : ""}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
const expect = (res, status, what) => {
  if (res.status !== status)
    throw new Error(`${what} answered ${res.status}, expected ${status}`);
};

await step("sign and upload an object (PUT)", async () => {
  const res = await fetch(
    objectUrl(cfg, "PUT", key, 120, { "content-type": "image/webp" }),
    {
      method: "PUT",
      headers: { "content-type": "image/webp" },
      body: bytes,
    }
  );
  if (res.status === 403)
    throw new Error(
      "403: the Access Key ID/Secret or Account ID is wrong, or the token has no write access to this bucket"
    );
  if (res.status === 404) throw new Error("404: the bucket name is wrong");
  expect(res, 200, "PUT");
});

if (failed) {
  // Nothing else can work until uploading does.
  console.log(
    "\nR2 is NOT ready: fix the FAIL line above, then run this again."
  );
  process.exit(1);
}

await step("check the object (HEAD) and its size", async () => {
  const res = await fetch(objectUrl(cfg, "HEAD", key, 60), { method: "HEAD" });
  expect(res, 200, "HEAD");
  const size = Number(res.headers.get("content-length"));
  if (size !== bytes.length)
    throw new Error(`size ${size}, expected ${bytes.length}`);
  return `${size} bytes`;
});

await step("download it (GET) and compare", async () => {
  const res = await fetch(objectUrl(cfg, "GET", key, 60));
  expect(res, 200, "GET");
  if (new TextDecoder().decode(await res.arrayBuffer()) !== "skola r2 check")
    throw new Error("the downloaded bytes differ");
});

await step(`browser access from ${origin} (CORS)`, async () => {
  const asks = [
    ["PUT", "content-type"],
    ["GET", undefined],
  ];
  for (const [method, headers] of asks) {
    const res = await fetch(
      objectUrl(
        cfg,
        method,
        key,
        60,
        headers ? { "content-type": "image/webp" } : undefined
      ),
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": method,
          ...(headers ? { "access-control-request-headers": headers } : {}),
        },
      }
    );
    const allowed = res.headers.get("access-control-allow-origin");
    if (!allowed || (allowed !== "*" && allowed !== origin))
      throw new Error(
        `${method} from ${origin} is not allowed by the bucket's CORS rule (got "${allowed ?? "nothing"}"). Add the rule from docs/dev-guide.md with this origin`
      );
  }
});

await step("delete the test object", async () => {
  const res = await fetch(objectUrl(cfg, "DELETE", key, 60), {
    method: "DELETE",
  });
  if (res.status !== 204 && res.status !== 200)
    throw new Error(`DELETE answered ${res.status}`);
  const gone = await fetch(objectUrl(cfg, "HEAD", key, 60), { method: "HEAD" });
  expect(gone, 404, "HEAD after delete");
});

console.log(
  failed ? "\nR2 is NOT ready: fix the FAIL lines above." : "\nR2 is ready."
);
process.exit(failed ? 1 : 0);
