import type { QueryTimeInterval } from "@azure/monitor-query-logs";

// ISO 8601 duration: P1D, PT12H, P1DT6H, P2W. "P", "PT" and a dangling "T" are rejected.
const duration = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

// A date (UTC midnight) or a date-time with an explicit zone. A zone-less time would be
// read in the server's local time zone, so it is rejected rather than guessed.
const dateTime = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

const usage =
  "Use an ISO 8601 duration back from now (P7D, PT12H) or an interval: start/end (2026-10-01T00:00:00Z/2026-10-02T00:00:00Z), start/duration (2026-10-01T08:00:00Z/PT6H) or duration/end.";

function parseDateTime(value: string): Date | undefined {
  if (!dateTime.test(value)) {
    return undefined;
  }
  // Date rolls an impossible day such as 2026-02-30 into March, so check the calendar date as written.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function isDuration(value: string): boolean {
  return duration.test(value.trim());
}

/** Parses a tool's timespan argument into the query client's interval form. */
export function parseTimespan(value: string): QueryTimeInterval {
  const trimmed = value.trim();
  if (duration.test(trimmed)) {
    return { duration: trimmed };
  }

  const parts = trimmed.split("/");
  if (parts.length === 2) {
    const [first = "", second = ""] = parts;
    const start = parseDateTime(first);
    const end = parseDateTime(second);
    if (start && end) {
      if (start.getTime() >= end.getTime()) {
        throw new Error(`Timespan '${trimmed}' starts at or after its end.`);
      }
      return { startTime: start, endTime: end };
    }
    if (start && duration.test(second)) {
      return { startTime: start, duration: second };
    }
    if (end && duration.test(first)) {
      return { duration: first, endTime: end };
    }
  }

  throw new Error(`Timespan '${trimmed}' is not valid. ${usage}`);
}
