import assert from "node:assert/strict";
import test from "node:test";

import { isDuration, parseTimespan } from "../src/timespan.js";

test("accepts ISO 8601 durations", () => {
  for (const value of ["P7D", "PT12H", "PT30M", "P1DT6H", "P2W", "PT1.5S", "P1Y"]) {
    assert.deepEqual(parseTimespan(value), { duration: value }, value);
    assert.ok(isDuration(value));
  }
});

test("rejects malformed durations", () => {
  for (const value of ["P", "PT", "P1DT", "P1H", "7D", "P-1D", "P1D garbage"]) {
    assert.throws(() => parseTimespan(value), /^Error: Timespan '.*' is not valid/, value);
  }
});

test("accepts start/end, start/duration and duration/end intervals", () => {
  assert.deepEqual(parseTimespan("2026-10-01T00:00:00Z/2026-10-02T00:00:00Z"), {
    startTime: new Date("2026-10-01T00:00:00Z"),
    endTime: new Date("2026-10-02T00:00:00Z"),
  });
  assert.deepEqual(parseTimespan("2026-10-01T08:00:00+02:00/PT6H"), { startTime: new Date("2026-10-01T06:00:00Z"), duration: "PT6H" });
  assert.deepEqual(parseTimespan("P1D/2026-10-02T00:00Z"), { duration: "P1D", endTime: new Date("2026-10-02T00:00:00Z") });
  assert.deepEqual(parseTimespan("2026-10-01/2026-10-03"), { startTime: new Date("2026-10-01T00:00:00Z"), endTime: new Date("2026-10-03T00:00:00Z") });
  assert.equal(isDuration("2026-10-01T08:00:00Z/PT6H"), false);
});

test("rejects intervals that are ambiguous, impossible or backwards", () => {
  for (const value of [
    "2026-10-01T08:00:00/PT6H", // no zone: would depend on the server's local time
    "2026-02-30T00:00:00Z/P1D", // no such day
    "2026-13-01/P1D",
    "P1D/PT6H",
    "2026-10-01T00:00:00Z/2026-10-02T00:00:00Z/P1D",
  ]) {
    assert.throws(() => parseTimespan(value), /^Error: Timespan '.*' is not valid/, value);
  }
  assert.throws(() => parseTimespan("2026-10-02T00:00:00Z/2026-10-01T00:00:00Z"), /starts at or after its end/);
});
