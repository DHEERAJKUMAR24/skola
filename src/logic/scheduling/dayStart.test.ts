import { describe, expect, it } from "vitest";
import { isValidTimeZone, logicalDateIn, logicalDayStartIn } from "./dayStart";

const AKL = "Pacific/Auckland";

describe("logicalDayStartIn / logicalDateIn", () => {
  it("Auckland 03:30 is still the previous study day", () => {
    const d = new Date("2026-11-07T14:30:00Z"); // 03:30 on 8 Nov NZDT
    expect(logicalDateIn(d, 4, AKL)).toBe("2026-11-07");
    expect(logicalDayStartIn(d, 4, AKL).toISOString()).toBe(
      "2026-11-06T15:00:00.000Z"
    );
  });

  it("Auckland 04:00 starts the new study day", () => {
    const d = new Date("2026-11-07T15:00:00Z");
    expect(logicalDateIn(d, 4, AKL)).toBe("2026-11-08");
    expect(logicalDayStartIn(d, 4, AKL).toISOString()).toBe(
      "2026-11-07T15:00:00.000Z"
    );
  });

  it("Auckland 03:59 belongs to the previous study day", () => {
    expect(logicalDateIn(new Date("2026-11-07T14:59:00Z"), 4, AKL)).toBe(
      "2026-11-07"
    );
  });

  it("UTC with hour 0 is the UTC midnight", () => {
    const d = new Date("2026-05-20T13:45:00Z");
    expect(logicalDayStartIn(d, 0, "UTC").toISOString()).toBe(
      "2026-05-20T00:00:00.000Z"
    );
    expect(logicalDateIn(d, 0, "UTC")).toBe("2026-05-20");
  });

  it("handles the New York spring-forward day", () => {
    const tz = "America/New_York";
    expect(
      logicalDayStartIn(new Date("2026-03-08T15:00:00Z"), 4, tz).toISOString()
    ).toBe("2026-03-08T08:00:00.000Z");
    expect(
      logicalDayStartIn(new Date("2026-03-07T15:00:00Z"), 4, tz).toISOString()
    ).toBe("2026-03-07T09:00:00.000Z");
  });

  it("rejects unknown time zones", () => {
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
    expect(() => logicalDayStartIn(new Date(), 4, "Mars/Base")).toThrow(
      RangeError
    );
  });
});
