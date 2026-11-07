import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setSetting } from "./setSetting";
import { ensureTimeZone } from "./timeZone";

const stored = async () => (await db.settings.get("#timeZone"))?.value;

describe("ensureTimeZone", () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  it("writes the device zone when unset", async () => {
    await ensureTimeZone();
    expect(await stored()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });

  it("never overwrites a zone that is already set", async () => {
    await setSetting("#timeZone", "Asia/Tokyo");
    await ensureTimeZone();
    expect(await stored()).toBe("Asia/Tokyo");
  });
});
